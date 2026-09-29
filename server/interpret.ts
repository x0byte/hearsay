import type { CanvasCommand } from '../src/canvas/commands.ts'
import type { InterpretRequest, TranscriptSegment } from '../src/interpret/protocol.ts'
import { assignIds, type DraftCommand } from '../src/canvas/assignIds.ts'
import { dropNoOps, type NoOpResult } from '../src/canvas/dropNoOps.ts'
import { commandTools, draftFromToolCall } from './commandTools.ts'
import {
  buildJevBody,
  DEFAULT_THRESHOLDS,
  routeJev,
  type JevAnswers,
  type JevDecide,
  type JevThresholds,
  type Route,
} from './jev.ts'
import type { ChatCompletion, ChatResponse } from './openrouter.ts'

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it'

// The OpenRouter provider each supported model is pinned to. Both support tool
// calling. Paid: DeepInfra fp8 ($0.07 / $0.34 per 1M tokens). Free: the only
// provider, with a shared rate limit.
export const PROVIDER_FOR_MODEL: Record<string, string> = {
  'google/gemma-4-26b-a4b-it': 'deepinfra/fp8',
  'google/gemma-4-26b-a4b-it:free': 'google-ai-studio',
}

// Where the server sends Gemma if the pinned provider is still rate-limited
// after one retry (the eval stays pinned). Tool-calling support checked on
// OpenRouter's endpoint list.
export const FALLBACK_PROVIDER_FOR_MODEL: Record<string, string> = {
  'google/gemma-4-26b-a4b-it': 'novita/bf16',
}

export type ModelConfig = { model: string; provider: string; fallbackProvider?: string }

// HEARSAY_MODEL picks the model and HEARSAY_PROVIDER overrides its pinned
// provider. An unknown model needs an explicit provider.
export function resolveModelConfig(env: Record<string, string | undefined>): ModelConfig {
  const model = env.HEARSAY_MODEL ?? DEFAULT_MODEL
  const provider = env.HEARSAY_PROVIDER ?? PROVIDER_FOR_MODEL[model]
  if (!provider) throw new Error(`No provider pinned for ${model}; set HEARSAY_PROVIDER`)
  const fallbackProvider = FALLBACK_PROVIDER_FOR_MODEL[model]
  return { model, provider, ...(fallbackProvider && fallbackProvider !== provider && { fallbackProvider }) }
}

// The server decides how much transcript the model sees, whatever the client
// sends: segments from the last WINDOW_MS before the newest, at most MAX_SEGMENTS.
export const WINDOW_MS = 30_000
export const MAX_SEGMENTS = 20

// Checks the shape of an incoming request body and trims its transcript
// window; returns undefined if invalid.
export function parseInterpretRequest(body: unknown): InterpretRequest | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { segments, objects } = body as Record<string, unknown>
  if (!Array.isArray(objects) || !Array.isArray(segments) || !segments.every(isSegment)) {
    return undefined
  }
  const newest = segments.at(-1)
  if (!newest || newest.text.trim() === '') return undefined
  const window = segments
    .filter((segment) => segment.at >= newest.at - WINDOW_MS)
    .slice(-MAX_SEGMENTS)
  return { segments: window, objects: objects as InterpretRequest['objects'] }
}

function isSegment(value: unknown): value is TranscriptSegment {
  if (typeof value !== 'object' || value === null) return false
  const { text, at } = value as Record<string, unknown>
  return typeof text === 'string' && typeof at === 'number' && Number.isFinite(at)
}

export const SYSTEM_PROMPT = `You drive a whiteboard for someone explaining ideas out loud, usually algorithms.
You receive the objects currently on the board and the last ~30 seconds of
transcript. Only the line marked NEWEST is new; earlier lines are context and
any changes they asked for are already on the board, so never repeat them.
Only act when the NEWEST line asks for or clearly describes a change to the
board. If unsure, do nothing. Most speech is explanation: call no tools.
Never write notes, summaries or labels unless the speaker explicitly asks for
text to be written.
When the speaker says two values on the board swap or trade places, that is a
swap, even if they only explain why.
Refer to existing objects only by the IDs listed on the board. New objects get
their IDs automatically; to refer to an object created earlier in the same
reply, use "new".
Make every call the request needs in this one reply, in the order the changes
should happen. You will not see tool results. Pointers on a new array go in
the same create_array call: "draw 4, 2, 7 with i on the first one" is
create_array(values: [4, 2, 7], pointers: [{ label: "i", index: 0 }]).`

// Asks the model which commands (if any) the transcript calls for. Commands
// that wouldn't change the board are returned separately in `dropped`.
export async function interpret(
  chat: ChatCompletion,
  request: InterpretRequest,
  config: ModelConfig = resolveModelConfig({}),
  signal?: AbortSignal,
): Promise<NoOpResult> {
  const response = await chat(
    {
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(request) },
      ],
      tools: commandTools,
      tool_choice: 'auto',
      // Pin one provider so behaviour doesn't change between requests.
      provider: { order: [config.provider], allow_fallbacks: false },
      // A reply is at most a few short tool calls (~40 tokens). Gemma
      // occasionally slips into a thinking loop ("thoughtthought…") until the
      // limit; 256 bounds that at a few seconds instead of ~27 s. Reasoning is
      // left at its default: DeepInfra honours effort "none", but in the eval it
      // raised false draws (9.8% -> 21.6%) and did not stop the loops.
      max_tokens: 256,
    },
    signal,
  )
  const commands = commandsFrom(response, request.objects.map((object) => object.id))
  return dropNoOps(commands, request.objects)
}

function userMessage({ segments, objects }: InterpretRequest): string {
  const board = objects.length
    ? objects.map(({ id, kind, props }) => `- ${id} (${kind}): ${JSON.stringify(props)}`).join('\n')
    : '(empty)'
  const transcript = segments
    .map((segment, i) => (i === segments.length - 1 ? `NEWEST: ${segment.text}` : `earlier: ${segment.text}`))
    .join('\n')
  return `Board:\n${board}\n\nTranscript (oldest first):\n${transcript}`
}

// All or nothing: the calls in one reply often depend on each other (create an
// array, then a pointer on it), so if any call is malformed, or a "new"
// reference has nothing to refer to, none are used.
function commandsFrom(response: ChatResponse, existingIds: string[]): CanvasCommand[] {
  const choice = response.choices[0]
  if (!choice) throw new Error('Model returned no choices')
  if (choice.finish_reason === 'length') throw new Error('Model reply was cut off')
  const calls = choice.message.tool_calls ?? []
  const drafts = calls.map(draftFromToolCall)
  const commands = drafts.every((draft) => draft !== undefined)
    ? assignIds(drafts as DraftCommand[], existingIds)
    : undefined
  if (!commands) {
    console.warn('Dropping reply with malformed tool calls:', JSON.stringify(calls))
    return []
  }
  return commands
}

export type InterpretPath = 'gemma' | 'jev-none' | 'jev' | 'fallback'

export type JevTrace = {
  answers?: JevAnswers
  latencyMs: number
  costUsd: number
  error?: string
}

export type JevInterpretResult = NoOpResult & {
  path: Exclude<InterpretPath, 'gemma'>
  reason?: string // why it fell back
  jev: JevTrace
  gemmaLatencyMs?: number // only when Gemma was called
}

// Jev first, Gemma only when Jev can't settle the request (sequential).
export async function interpretWithJev(
  chat: ChatCompletion,
  jev: JevDecide,
  request: InterpretRequest,
  config: ModelConfig,
  thresholds: JevThresholds = DEFAULT_THRESHOLDS,
  signal?: AbortSignal,
): Promise<JevInterpretResult> {
  const started = performance.now()
  let trace: JevTrace
  let route: Route
  try {
    const response = await jev(buildJevBody(request), signal)
    trace = { answers: response.answers, latencyMs: performance.now() - started, costUsd: response.usage?.cost ?? 0 }
    route = routeJev(response.answers, request, thresholds)
  } catch (error) {
    if (signal?.aborted) throw error
    trace = { latencyMs: performance.now() - started, costUsd: 0, error: String(error) }
    route = { kind: 'fallback', reason: 'jev error' }
  }
  if (route.kind === 'none') return { commands: [], dropped: [], path: 'jev-none', jev: trace }
  if (route.kind === 'command') return { ...dropNoOps([route.command], request.objects), path: 'jev', jev: trace }

  const gemmaStarted = performance.now()
  const result = await interpret(chat, request, config, signal)
  return { ...result, path: 'fallback', reason: route.reason, jev: trace, gemmaLatencyMs: performance.now() - gemmaStarted }
}
