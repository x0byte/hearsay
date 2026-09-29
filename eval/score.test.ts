import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CanvasCommand } from '../src/canvas/commands.ts'
import { ANY, cases } from './cases.ts'
import { classify, matches, parallelLatencyMs, percentile, summarize, type Attempt } from './score.ts'

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
    path: 'gemma',
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

  it('has 45 tuned and 25 held-out cases, all with unique names', () => {
    expect(tuned).toHaveLength(45)
    expect(holdout).toHaveLength(25)
    expect(new Set(cases.map((c) => c.name)).size).toBe(70)
  })

  it('keeps about 40% of the tuned set expecting no commands', () => {
    const nothing = tuned.filter((c) => c.expected.length === 0).length
    expect(nothing / tuned.length).toBeGreaterThanOrEqual(0.4)
    expect(nothing / tuned.length).toBeLessThanOrEqual(0.45)
  })

  it('tags exactly the tuned cases that expect nothing as explanation', () => {
    for (const c of tuned) expect(c.tag === 'explanation').toBe(c.expected.length === 0)
  })

  it('keeps the held-out set about 40% explanation-only, with a couple of multi-command cases', () => {
    expect(holdout.filter((c) => c.expected.length === 0).length).toBe(10)
    expect(holdout.filter((c) => c.expected.length > 1).length).toBeGreaterThanOrEqual(2)
  })

  it('never reuses a tuned sentence in the held-out set', () => {
    const tunedSegments = new Set(tuned.flatMap((c) => c.segments))
    expect(holdout.flatMap((c) => c.segments).filter((s) => tunedSegments.has(s))).toEqual([])
  })

  // The held-out set is frozen: its results are only comparable across runs if
  // it never changes. If this fails, undo the change to the holdout cases. To
  // start a genuinely new held-out set, change the hash in its own commit and
  // say so, because earlier held-out results stop being comparable.
  it('is frozen', () => {
    const hash = createHash('sha256').update(JSON.stringify(holdout)).digest('hex')
    expect(hash).toBe('951bb4fbb9e40c09646c2f27b22e742a56c8402aaea99556904cad1405f08a36')
  })
})

describe('parallelLatencyMs', () => {
  const jevRun: Attempt = {
    case: 'c',
    tag: 'command',
    expectsChange: true,
    outcome: 'correct',
    latencyMs: 300,
    costUsd: 0,
    got: [],
    dropped: [],
    path: 'jev',
    jev: { latencyMs: 300, costUsd: 0 },
    gemma: { latencyMs: 800, costUsd: 0, shadow: true },
  }

  it('is Jev alone when Jev settles, the slower of the two on fallback, and unchanged for Gemma-only', () => {
    expect(parallelLatencyMs(jevRun)).toBe(300)
    expect(parallelLatencyMs({ ...jevRun, path: 'fallback', gemma: { latencyMs: 800, costUsd: 0, shadow: false } })).toBe(800)
    expect(parallelLatencyMs({ ...jevRun, path: 'gemma', latencyMs: 750 })).toBe(750)
  })
})
