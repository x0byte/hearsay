import { dropNoOps } from '../src/canvas/dropNoOps.ts'
import { routeJev, type JevThresholds } from '../server/jev.ts'
import type { EvalCase } from './cases.ts'
import { requestFor } from './request.ts'
import { classify, type Attempt } from './score.ts'

// What a saved Jev-run attempt would have been at other thresholds, using the
// recorded Jev answers and the recorded (real or shadow) Gemma answer. No API
// calls. Latency is the sequential estimate: Jev, plus Gemma when it falls back.
export function rescoreAttempt(attempt: Attempt, evalCase: EvalCase, thresholds: JevThresholds): Attempt {
  const { jev, gemma } = attempt
  if (!jev || !gemma) throw new Error(`Attempt for ${attempt.case} is not from a Jev run`)
  const request = requestFor(evalCase)
  const route = jev.answers ? routeJev(jev.answers, request, thresholds) : { kind: 'fallback' as const, reason: 'jev error' }
  const base = { ...attempt, jev, gemma, reason: undefined, finishReason: undefined, tokens: undefined }

  if (route.kind === 'none') {
    return { ...base, path: 'jev-none', got: [], dropped: [], outcome: classify(evalCase.expected, []), latencyMs: jev.latencyMs, costUsd: jev.costUsd }
  }
  if (route.kind === 'command') {
    const { commands, dropped } = dropNoOps([route.command], request.objects)
    return { ...base, path: 'jev', got: commands, dropped, outcome: classify(evalCase.expected, commands), latencyMs: jev.latencyMs, costUsd: jev.costUsd }
  }
  const got = gemma.error ? { error: gemma.error } : (gemma.commands ?? [])
  return {
    ...base,
    path: 'fallback',
    reason: route.reason,
    got,
    dropped: gemma.dropped ?? [],
    outcome: classify(evalCase.expected, Array.isArray(got) ? got : undefined),
    latencyMs: jev.latencyMs + gemma.latencyMs,
    costUsd: jev.costUsd + gemma.costUsd,
  }
}
