import { describe, expect, it } from 'vitest'
import type { EvalCase } from './cases.ts'
import { rescoreAttempt } from './rescoring.ts'
import type { Attempt } from './score.ts'

const moveCase: EvalCase = {
  name: 'move',
  tag: 'command',
  segments: ['move it over one'],
  board: [
    { id: 'array-a', kind: 'array', shapeIds: [], props: { values: [5, 2, 8, 1] } },
    { id: 'pointer-i', kind: 'pointer', shapeIds: [], props: { label: 'i', array: 'array-a', index: 0 } },
  ],
  expected: [{ type: 'move_pointer', target: 'pointer-i', index: 1 }],
}

// A saved Jev-run attempt: Jev settled it; Gemma's shadow answer disagrees.
const saved: Attempt = {
  case: 'move',
  tag: 'command',
  expectsChange: true,
  outcome: 'correct',
  latencyMs: 300,
  costUsd: 0.00003,
  got: [{ type: 'move_pointer', target: 'pointer-i', index: 1 }],
  dropped: [],
  path: 'jev',
  jev: {
    latencyMs: 300,
    costUsd: 0.00003,
    answers: {
      change: { type: 'noul', noul: 0.9 },
      command: { type: 'choice', choice: 'move_pointer', confidence: 0.85 },
      target: { type: 'choice', choice: 'pointer-i', confidence: 0.99 },
      index: { type: 'choice', choice: '1', confidence: 0.99 },
    },
  },
  gemma: { latencyMs: 800, costUsd: 0.0001, shadow: true, commands: [{ type: 'move_pointer', target: 'pointer-i', index: 2 }], dropped: [] },
}

describe('rescoreAttempt', () => {
  it('reproduces the recorded route at the recorded thresholds', () => {
    expect(rescoreAttempt(saved, moveCase, { gate: 0.5, confidence: 0.8 })).toMatchObject({ path: 'jev', outcome: 'correct', latencyMs: 300 })
  })

  it('uses the shadow Gemma answer when stricter thresholds force a fallback', () => {
    const rescored = rescoreAttempt(saved, moveCase, { gate: 0.5, confidence: 0.9 })
    expect(rescored).toMatchObject({ path: 'fallback', outcome: 'wrong', latencyMs: 1100 })
    expect(rescored.costUsd).toBeCloseTo(0.00013)
  })

  it('does nothing when the gate is raised above the change probability', () => {
    expect(rescoreAttempt(saved, moveCase, { gate: 0.95, confidence: 0.8 })).toMatchObject({ path: 'jev-none', outcome: 'miss', got: [] })
  })
})
