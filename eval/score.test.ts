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
    outcome,
    latencyMs,
    costUsd: 0.001,
    got: [],
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
})

describe('cases', () => {
  it('has 40 cases with unique names, about 40% expecting no commands', () => {
    expect(cases).toHaveLength(40)
    expect(new Set(cases.map((c) => c.name)).size).toBe(40)
    const nothing = cases.filter((c) => c.expected.length === 0).length
    expect(nothing / cases.length).toBeGreaterThanOrEqual(0.4)
    expect(nothing / cases.length).toBeLessThanOrEqual(0.45)
  })

  it('tags exactly the cases that expect nothing as explanation', () => {
    for (const c of cases) expect(c.tag === 'explanation').toBe(c.expected.length === 0)
  })
})
