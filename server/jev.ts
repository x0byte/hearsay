import { assignIds, type DraftCommand } from '../src/canvas/assignIds.ts'
import type { CanvasCommand } from '../src/canvas/commands.ts'
import { SemanticStore, type SemanticObject } from '../src/canvas/semanticStore.ts'
import { validateCommand } from '../src/canvas/validateCommand.ts'
import type { InterpretRequest } from '../src/interpret/protocol.ts'

// Jev (TypeSafe's decision model on OpenRouter) answers typed questions with
// probabilities instead of text. One request asks five independent questions
// (they are answered in parallel and can't see each other); literal values
// are extracted from the transcript in code. Everything here except the client
// is pure, so saved runs can be re-scored offline.

export const JEV_MODEL = 'typesafe/jev-1.13'
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'
const TIMEOUT_MS = 10_000
export const MAX_INDEX_OPTIONS = 20

export type JevThresholds = { gate: number; confidence: number }
export const DEFAULT_THRESHOLDS: JevThresholds = { gate: 0.5, confidence: 0.8 }

type Criteria = Record<string, string>
type Question =
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Criteria }

export type JevAnswers = {
  change?: { type: 'noul'; noul: number }
  command?: ChoiceAnswer
  target?: ChoiceAnswer
  index?: ChoiceAnswer
  index2?: ChoiceAnswer
}
export type ChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence?: number
  probabilities?: Record<string, number>
}
export type JevResponse = { answers: JevAnswers; usage?: { cost?: number } }
export type JevDecide = (
  body: { model: string; state: unknown; questions: Record<string, Question> },
  signal?: AbortSignal,
) => Promise<JevResponse>

// The fixed wording of every question. Part of the prompt version hash.
const COMMAND_OPTIONS: Criteria = {
  create_array: 'Draw a new array of values.',
  create_pointer: 'Add a new labelled pointer (like i or j) under a cell of an existing array.',
  move_pointer: 'Move an existing pointer to another cell.',
  highlight: 'Highlight an existing object, or one cell of an array.',
  clear_highlight: 'Remove an existing highlight.',
  swap: 'Swap the values in two cells of an array, e.g. two values "trade places".',
  set_value: 'Replace the value in one cell of an array.',
  delete: 'Remove an existing object.',
  create_text: 'Write some text on the board.',
  several: 'More than one of the above changes at once.',
  none: 'No change to the board.',
}
export const JEV_QUESTION_TEXT = {
  change: {
    instructions:
      'Does the NEWEST transcript line ask for, or clearly describe, a change to the whiteboard? Earlier lines are context only; their changes are already on the board.',
    true: 'The speaker asks for something to be drawn, moved, highlighted, swapped, changed or removed.',
    false: 'The speaker is only explaining, reasoning or talking; nothing on the board should change.',
  },
  command: 'Which single board change does the NEWEST line ask for?',
  commandOptions: COMMAND_OPTIONS,
  target: 'Which existing board object does the NEWEST line act on?',
  targetNone: 'No existing object (for example, something new is being drawn).',
  index:
    'Which zero-based array cell does the change end at? For a pointer, the cell it ends on; for a swap, the first of the two cells.',
  indexNone: 'No specific cell (the whole object, or not about a cell).',
  index2: 'If the NEWEST line asks for a swap, which zero-based cell is the second of the two cells?',
  index2None: 'Not a swap.',
}

export function buildJevBody(request: InterpretRequest) {
  const q = JEV_QUESTION_TEXT
  const board = request.objects.map(({ id, kind, props }) => ({ id, kind, ...props }))
  const earlier = request.segments.slice(0, -1).map((s) => s.text)
  const newest = request.segments.at(-1)?.text ?? ''
  const longest = Math.max(1, ...request.objects.map((o) => (Array.isArray(o.props.values) ? o.props.values.length : 0)))
  const cells: Criteria = {}
  for (let i = 0; i < Math.min(longest, MAX_INDEX_OPTIONS); i++) cells[String(i)] = `cell ${i}`
  const targets: Criteria = {}
  for (const object of request.objects) targets[object.id] = describe(object)
  targets.none = q.targetNone
  const questions: Record<string, Question> = {
    change: { type: 'noul', instructions: q.change.instructions, criteria: { true: q.change.true, false: q.change.false } },
    command: { type: 'choice', instructions: q.command, criteria: q.commandOptions },
    target: { type: 'choice', instructions: q.target, criteria: targets },
    index: { type: 'choice', instructions: q.index, criteria: { ...cells, none: q.indexNone } },
    index2: { type: 'choice', instructions: q.index2, criteria: { ...cells, none: q.index2None } },
  }
  return { model: JEV_MODEL, state: { board, transcript: { earlier, newest } }, questions }
}

function describe(object: SemanticObject): string {
  const p = object.props
  const highlight = p.highlight === undefined ? '' : `, highlighted: ${p.highlight === 'all' ? 'all' : `cell ${p.highlight}`}`
  if (object.kind === 'array') return `${object.id}: array ${JSON.stringify(p.values)}${highlight}`
  if (object.kind === 'pointer') return `${object.id}: pointer "${p.label}" at cell ${p.index} of ${p.array}`
  return `${object.id}: text "${p.text}"${highlight}`
}

export type Route =
  | { kind: 'none' }
  | { kind: 'command'; command: CanvasCommand }
  | { kind: 'fallback'; reason: string }

// Jev alone decides whether to act: below the gate nothing happens. Above it,
// Jev's command is used only if every answer it needs is confident, any
// literal value can be extracted, and the command validates. Otherwise the
// request falls back to Gemma.
export function routeJev(answers: JevAnswers, request: InterpretRequest, t: JevThresholds): Route {
  const change = answers.change?.noul
  if (change === undefined) return { kind: 'fallback', reason: 'no change answer' }
  if (change < t.gate) return { kind: 'none' }

  const command = answers.command?.choice
  const confident = (answer: ChoiceAnswer | undefined) => answer !== undefined && confidenceOf(answer) >= t.confidence
  if (!command || !confident(answers.command)) return { kind: 'fallback', reason: 'command not confident' }

  const newest = request.segments.at(-1)?.text ?? ''
  const needs = (...names: ('target' | 'index' | 'index2')[]) => names.every((name) => confident(answers[name]))
  const index = cellOf(answers.index)
  const index2 = cellOf(answers.index2)
  const target = answers.target?.choice
  let draft: DraftCommand | undefined

  switch (command) {
    case 'create_array': {
      const values = arrayValues(newest)
      if (values) draft = { type: 'create_array', values }
      break
    }
    case 'create_pointer': {
      const label = pointerLabel(newest)
      if (label && target && index !== undefined && needs('target', 'index')) {
        draft = { type: 'create_pointer', label, array: arrayOf(target, request.objects), index }
      }
      break
    }
    case 'move_pointer':
      if (target && index !== undefined && needs('target', 'index')) draft = { type: 'move_pointer', target, index }
      break
    case 'highlight':
      if (target && needs('target', 'index')) {
        draft = index === undefined ? { type: 'highlight', target } : { type: 'highlight', target, index }
      }
      break
    case 'clear_highlight':
    case 'delete':
      if (target && needs('target')) draft = { type: command, target }
      break
    case 'swap':
      if (target && index !== undefined && index2 !== undefined && needs('target', 'index', 'index2')) {
        draft = { type: 'swap', target: arrayOf(target, request.objects), i: index, j: index2 }
      }
      break
    case 'set_value': {
      const value = newValue(newest)
      if (value !== undefined && target && index !== undefined && needs('target', 'index')) {
        draft = { type: 'set_value', target: arrayOf(target, request.objects), index, value }
      }
      break
    }
    default:
      // create_text, several, none: left to Gemma.
      return { kind: 'fallback', reason: `command ${command}` }
  }
  if (!draft) return { kind: 'fallback', reason: `${command}: missing confident answer or value` }

  const [assigned] = assignIds([draft], request.objects.map((o) => o.id)) ?? []
  if (!assigned) return { kind: 'fallback', reason: `${command}: unresolved reference` }
  const store = new SemanticStore()
  for (const object of request.objects) store.add(object)
  const validation = validateCommand(assigned, store)
  if (!validation.ok) return { kind: 'fallback', reason: `${command}: ${validation.reason}` }
  return { kind: 'command', command: assigned }
}

export function confidenceOf(answer: ChoiceAnswer): number {
  return answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0
}

function cellOf(answer: ChoiceAnswer | undefined): number | undefined {
  if (!answer || answer.choice === 'none') return undefined
  const n = Number(answer.choice)
  return Number.isInteger(n) ? n : undefined
}

// A pointer names the array it sits on; commands on values act on that array.
function arrayOf(id: string, objects: SemanticObject[]): string {
  const object = objects.find((o) => o.id === id)
  return object?.kind === 'pointer' ? String(object.props.array) : id
}

// --- Literal values, extracted in code from the NEWEST line -----------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}
export const MAX_RANGE_VALUES = 20

// Array values in the NEWEST line: a range ("from 1 to 5", "1 through 8",
// "5 to 1"), or a run of numbers separated by commas, spaces or "and"
// ("3, 1, 4 and 5"). Number words count ("one to five"). Returns undefined,
// leaving the request to Gemma, unless every number in the line is used: a
// partial array is worse than asking Gemma.
export function arrayValues(text: string): number[] | undefined {
  const normalized = text
    .toLowerCase()
    .replace(/\b[a-z]+\b/g, (word) => (word in NUMBER_WORDS ? String(NUMBER_WORDS[word]) : word))
  const mentioned = normalized.match(new RegExp(NUMBER, 'g'))?.length ?? 0
  if (mentioned === 0) return undefined
  // "five random numbers": a count of values, not a value.
  if (new RegExp(`${NUMBER}\\s+(?:[a-z]+\\s+)?(?:numbers|values|elements|items|cells|integers)\\b`).test(normalized)) {
    return undefined
  }

  const range = new RegExp(`(?:from\\s+)?(${NUMBER})\\s+(?:to|through|thru)\\s+(${NUMBER})`).exec(normalized)
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])]
    const size = Math.abs(to - from) + 1
    if (mentioned !== 2 || !Number.isInteger(from) || !Number.isInteger(to) || size > MAX_RANGE_VALUES) return undefined
    const step = from <= to ? 1 : -1
    return Array.from({ length: size }, (_, i) => from + i * step)
  }

  const run = new RegExp(`${NUMBER}(?:(?:\\s*,\\s*|\\s+and\\s+|\\s+)${NUMBER})*`).exec(normalized)
  const values = run?.[0].match(new RegExp(NUMBER, 'g'))?.map(Number)
  return values && values.length === mentioned ? values : undefined
}

// The value after the last "to" / "with" / "into", or a sentence ending in a
// number: "change the 8 to 10" -> 10, "replace the 2 with a 7" -> 7,
// "make the last element zero" -> 0. Words and letters are left to Gemma.
export function newValue(text: string): number | undefined {
  const lower = text.toLowerCase()
  const after = /\b(?:to|with|into)\b(?!.*\b(?:to|with|into)\b)(.*)$/.exec(lower)?.[1] ?? lower.split(/\s+/).at(-1) ?? ''
  const digits = new RegExp(NUMBER).exec(after)
  if (digits) return Number(digits[0])
  const word = /\b([a-z]+)\b/.exec(after.replace(/\b(?:a|an|the)\b/g, ''))?.[1]
  return word !== undefined ? NUMBER_WORDS[word] : undefined
}

const COMMON_POINTERS = /\b(i|j|k|lo|hi|mid|left|right)\b/
// "pointer j" / "a pointer called j" / "the j pointer" / a bare i, j, k, lo, hi.
export function pointerLabel(text: string): string | undefined {
  const lower = text.toLowerCase()
  const before = /\b([a-z]\w{0,5})\s+pointer\b/.exec(lower)?.[1]
  if (before && !['a', 'the', 'new', 'another', 'second'].includes(before)) return before
  // Not followed by an apostrophe: "pointer isn't" is not a pointer called "isn".
  const named = /\bpointer\s+(?:called\s+|named\s+)?([a-z]\w{0,5})(?![\w'])/.exec(lower)?.[1]
  if (named && !['on', 'at', 'to', 'in', 'the', 'a'].includes(named)) return named
  return COMMON_POINTERS.exec(lower)?.[1]
}

// --- Client ----------------------------------------------------------------

export function openRouterJev(apiKey: string): JevDecide {
  return async (body, signal) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Hearsay' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
    const json: unknown = await response.json().catch(() => undefined)
    if (!response.ok || typeof (json as JevResponse | undefined)?.answers !== 'object') {
      throw new Error(`Jev ${response.status}: ${JSON.stringify(json)?.slice(0, 200)}`)
    }
    return json as JevResponse
  }
}
