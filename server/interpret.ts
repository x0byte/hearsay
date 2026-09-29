import type { CanvasCommand } from '../src/canvas/commands.ts'
import type { SemanticObject } from '../src/canvas/semanticStore.ts'
import { commandFromToolCall, commandTools } from './commandTools.ts'
import type { ChatCompletion, ChatResponse } from './openrouter.ts'

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it'

// The OpenRouter provider each supported model is pinned to. Both support tool
// calling. Paid: DeepInfra fp8 ($0.07 / $0.34 per 1M tokens). Free: the only
// provider, with a shared rate limit.
export const PROVIDER_FOR_MODEL: Record<string, string> = {
  'google/gemma-4-26b-a4b-it': 'deepinfra/fp8',
  'google/gemma-4-26b-a4b-it:free': 'google-ai-studio',
}

export type InterpretRequest = {
  transcript: string
  objects: SemanticObject[]
}

export type ModelConfig = { model: string; provider: string }

// HEARSAY_MODEL picks the model and HEARSAY_PROVIDER overrides its pinned
// provider. An unknown model needs an explicit provider.
export function resolveModelConfig(env: Record<string, string | undefined>): ModelConfig {
  const model = env.HEARSAY_MODEL ?? DEFAULT_MODEL
  const provider = env.HEARSAY_PROVIDER ?? PROVIDER_FOR_MODEL[model]
  if (!provider) throw new Error(`No provider pinned for ${model}; set HEARSAY_PROVIDER`)
  return { model, provider }
}

// Checks the shape of an incoming request body; returns undefined if invalid.
export function parseInterpretRequest(body: unknown): InterpretRequest | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { transcript, objects } = body as Record<string, unknown>
  if (typeof transcript !== 'string' || transcript.trim() === '') return undefined
  if (!Array.isArray(objects)) return undefined
  return { transcript, objects: objects as SemanticObject[] }
}

const SYSTEM_PROMPT = `You drive a whiteboard for someone explaining ideas out loud, usually algorithms.
You receive the latest transcript and the objects currently on the board.
Call tools only when the speaker asks for, or clearly implies, a change to the board.
Most speech is explanation: in that case call no tools and reply with nothing.
Refer to existing objects only by the IDs listed on the board. Call tools in the
order the changes should happen.`

// Asks the model which commands (if any) the transcript calls for.
export async function interpret(
  chat: ChatCompletion,
  request: InterpretRequest,
  config: ModelConfig = resolveModelConfig({}),
): Promise<CanvasCommand[]> {
  const response = await chat({
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(request) },
    ],
    tools: commandTools,
    tool_choice: 'auto',
    // Pin one provider so behaviour doesn't change between requests.
    provider: { order: [config.provider], allow_fallbacks: false },
    max_tokens: 1024,
  })
  return commandsFrom(response)
}

function userMessage({ transcript, objects }: InterpretRequest): string {
  const board = objects.length
    ? objects.map(({ id, kind, props }) => `- ${id} (${kind}): ${JSON.stringify(props)}`).join('\n')
    : '(empty)'
  return `Board:\n${board}\n\nTranscript:\n${transcript}`
}

// All or nothing: the calls in one reply often depend on each other (create an
// array, then a pointer on it), so if any call is malformed none are used.
function commandsFrom(response: ChatResponse): CanvasCommand[] {
  const choice = response.choices[0]
  if (!choice) throw new Error('Model returned no choices')
  if (choice.finish_reason === 'length') throw new Error('Model reply was cut off')
  const calls = choice.message.tool_calls ?? []
  const commands = calls.map(commandFromToolCall)
  if (commands.some((command) => command === undefined)) {
    console.warn('Dropping reply with malformed tool calls:', JSON.stringify(calls))
    return []
  }
  return commands as CanvasCommand[]
}
