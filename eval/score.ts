import type { CanvasCommand } from '../src/canvas/commands.ts'
import { ANY, type EvalTag } from './cases.ts'

// correct:    got exactly the expected commands (including [] when [] expected)
// false_draw: expected [] but got commands
// miss:       expected commands but got []
// wrong:      expected commands, got different ones
// error:      the request failed
export type Outcome = 'correct' | 'false_draw' | 'miss' | 'wrong' | 'error'

export type Attempt = {
  case: string
  tag: EvalTag
  expectsChange: boolean
  outcome: Outcome
  latencyMs: number
  costUsd: number
  // From the model response; absent if the request failed before one arrived.
  finishReason?: string | null
  tokens?: { prompt: number; completion: number; reasoning: number }
  got: CanvasCommand[] | { error: string }
}

export function classify(expected: CanvasCommand[], got: CanvasCommand[] | undefined): Outcome {
  if (!got) return 'error'
  if (expected.length === 0) return got.length === 0 ? 'correct' : 'false_draw'
  if (got.length === 0) return 'miss'
  return matches(expected, got) ? 'correct' : 'wrong'
}

// Deep equality, ignoring key order, where an expected ANY matches any string.
export function matches(expected: unknown, got: unknown): boolean {
  if (expected === ANY) return typeof got === 'string'
  if (Array.isArray(expected)) {
    return (
      Array.isArray(got) &&
      got.length === expected.length &&
      expected.every((item, i) => matches(item, got[i]))
    )
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof got !== 'object' || got === null || Array.isArray(got)) return false
    const e = expected as Record<string, unknown>
    const g = got as Record<string, unknown>
    const keys = new Set([...Object.keys(e), ...Object.keys(g)])
    return [...keys].every((key) => matches(e[key], g[key]))
  }
  return expected === got
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]
}

export type Summary = {
  attempts: number
  accuracy: number
  counts: Record<Outcome, number>
  falseDrawRate: number // of attempts where [] was expected
  missRate: number // of attempts where commands were expected
  accuracyByTag: Partial<Record<EvalTag, number>>
  latencyMs: { p50: number; p95: number }
  totalCostUsd: number
}

export function summarize(attempts: Attempt[]): Summary {
  const counts: Record<Outcome, number> = { correct: 0, false_draw: 0, miss: 0, wrong: 0, error: 0 }
  for (const attempt of attempts) counts[attempt.outcome]++
  const expectingNothing = attempts.filter((a) => !a.expectsChange).length
  const expectingCommands = attempts.length - expectingNothing
  const accuracyByTag: Partial<Record<EvalTag, number>> = {}
  for (const tag of new Set(attempts.map((a) => a.tag))) {
    const ofTag = attempts.filter((a) => a.tag === tag)
    accuracyByTag[tag] = ratio(ofTag.filter((a) => a.outcome === 'correct').length, ofTag.length)
  }
  const latencies = attempts.filter((a) => a.outcome !== 'error').map((a) => a.latencyMs)
  return {
    attempts: attempts.length,
    accuracy: ratio(counts.correct, attempts.length),
    counts,
    falseDrawRate: ratio(counts.false_draw, expectingNothing),
    missRate: ratio(counts.miss, expectingCommands),
    accuracyByTag,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    totalCostUsd: attempts.reduce((sum, a) => sum + a.costUsd, 0),
  }
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}
