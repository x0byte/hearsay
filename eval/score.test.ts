import { describe, expect, it } from 'vitest'
import type { CanvasCommand } from '../src/canvas/commands.ts'
import { ANY, cases } from './cases.ts'
import { classify, matches, percentile, summarize, type Attempt } from './score.ts'

const move: CanvasCommand = { type: 'move_pointer', target: 'pointer-i', index: 1 }

describe('classify', () => {
  it('distinguishes correct, false draws, misses, wrong answers and errors', () => {
    expect(classify([], [])).toBe('correct')
    expect(classify([], [move])).toBe('false_draw')
    expect(classify([move], [])).toBe('miss')
    expect(classify([move], [{ ...move, index: 2 }])).toBe('wrong')
    expect(classify([move], [move, move])).toBe('wrong')
    expect(classify([move], undefined)).toBe('error')
    expect(classify([move], [{ index: 1, target: 'pointer-i', type: 'move_pointer' }])).toBe('correct')
  })

  it('treats swap(i, j) and swap(j, i) as the same answer', () => {
    const swap: CanvasCommand = { type: 'swap', target: 'array-a', i: 1, j: 2 }
    expect(classify([swap], [{ ...swap, i: 2, j: 1 }])).toBe('correct')
    expect(classify([swap], [{ ...swap, i: 0, j: 2 }])).toBe('wrong')
  })
})

describe('matches', () => {
  it('lets ANY match any string but nothing else', () => {
    const expected = { type: 'create_text', id: 'text-1', text: ANY }
    expect(matches(expected, { type: 'create_text', id: 'text-1', text: 'Bubble sort' })).toBe(true)
    expect(matches(expected, { type: 'create_text', id: 'text-1', text: 3 })).toBe(false)
  })

  it('treats an extra or missing field as a mismatch', () => {
    expect(matches({ type: 'highlight', target: 'a' }, { type: 'highlight', target: 'a', index: 0 })).toBe(false)
    expect(matches({ type: 'highlight', target: 'a', index: 0 }, { type: 'highlight', target: 'a' })).toBe(false)
  })
})

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(values, 50)).toBe(10)
    expect(percentile(values, 95)).toBe(19)
    expect(percentile([], 50)).toBe(0)
  })
})

describe('summarize', () => {
  const attempt = (tag: Attempt['tag'], outcome: Attempt['outcome'], latencyMs: number): Attempt => ({
    case: 'c',
    tag,
    expectsChange: tag !== 'explanation',
    outcome,
    latencyMs,
    costUsd: 0.001,
    got: [],
    dropped: [],
  })

  it('reports rates against the right denominators', () => {
    const summary = summarize([
      attempt('explanation', 'correct', 100),
      attempt('explanation', 'false_draw', 200),
      attempt('command', 'correct', 300),
      attempt('command', 'miss', 400),
      attempt('context', 'error', 0),
    ])
    expect(summary.accuracy).toBe(2 / 5)
    expect(summary.falseDrawRate).toBe(1 / 2)
    expect(summary.missRate).toBe(1 / 3)
    expect(summary.accuracyByTag).toEqual({ explanation: 0.5, command: 0.5, context: 0 })
    expect(summary.latencyMs).toEqual({ p50: 200, p95: 400 })
    expect(summary.totalCostUsd).toBeCloseTo(0.005)
  })

  it('reports dropped no-ops separately, including no-change attempts they rescued', () => {
    const noOp: CanvasCommand = { type: 'move_pointer', target: 'pointer-i', index: 0 }
    const summary = summarize([
      { ...attempt('explanation', 'correct', 100), dropped: [noOp] }, // rescued
      { ...attempt('explanation', 'false_draw', 100), dropped: [noOp] }, // still a false draw
      { ...attempt('command', 'correct', 100), dropped: [noOp, noOp] },
      attempt('explanation', 'correct', 100),
    ])
    expect(summary.noOps).toEqual({ commands: 4, attempts: 3, rescued: 1 })
    expect(summary.counts.false_draw).toBe(1)
  })
})

describe('cases', () => {
  const tuned = cases.filter((c) => c.tag !== 'holdout')
  const holdout = cases.filter((c) => c.tag === 'holdout')

  it('has 45 tuned and 10 held-out cases, all with unique names', () => {
    expect(tuned).toHaveLength(45)
    expect(holdout).toHaveLength(10)
    expect(new Set(cases.map((c) => c.name)).size).toBe(55)
  })

  it('keeps about 40% of the tuned set expecting no commands', () => {
    const nothing = tuned.filter((c) => c.expected.length === 0).length
    expect(nothing / tuned.length).toBeGreaterThanOrEqual(0.4)
    expect(nothing / tuned.length).toBeLessThanOrEqual(0.45)
  })

  it('tags exactly the tuned cases that expect nothing as explanation', () => {
    for (const c of tuned) expect(c.tag === 'explanation').toBe(c.expected.length === 0)
  })

  it('makes the held-out set mostly explanation with a couple of multi-command cases', () => {
    expect(holdout.filter((c) => c.expected.length === 0).length).toBeGreaterThanOrEqual(6)
    expect(holdout.filter((c) => c.expected.length > 1).length).toBeGreaterThanOrEqual(2)
  })
})
