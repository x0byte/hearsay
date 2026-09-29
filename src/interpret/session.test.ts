import { describe, expect, it, vi } from 'vitest'
import type { CanvasCommand } from '../canvas/commands'
import type { InterpretOutcome } from './client'
import type { InterpretRequest } from './protocol'
import { createTranscriptSession, MAX_SEGMENTS, type SessionStatus } from './session'

const highlight: CanvasCommand = { type: 'highlight', target: 'array-a' }

function setup(outcomes: InterpretOutcome[], applyResult: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const interpret = vi.fn(async (_request: InterpretRequest) => outcomes.shift() ?? { status: 'ok' as const, commands: [] })
  const apply = vi.fn((_commands: CanvasCommand[]) => applyResult)
  const statuses: SessionStatus[] = []
  let clock = 1_000
  const session = createTranscriptSession({
    interpret,
    apply,
    objects: () => [],
    onStatus: (status) => statuses.push(status),
    now: () => (clock += 500),
  })
  return { session, interpret, apply, statuses }
}

describe('createTranscriptSession', () => {
  it('sends each segment with earlier ones as context, timed from session start', async () => {
    const { session, interpret } = setup([])
    await session.addSegment('first line')
    await session.addSegment('  second line  ')
    expect(interpret.mock.calls[1][0].segments).toEqual([
      { text: 'first line', at: 500 },
      { text: 'second line', at: 1000 },
    ])
  })

  it('applies returned commands and reports them', async () => {
    const { session, apply, statuses } = setup([{ status: 'ok', commands: [highlight] }])
    await session.addSegment('highlight the array')
    expect(apply).toHaveBeenCalledWith([highlight])
    expect(statuses).toEqual([{ kind: 'thinking' }, { kind: 'applied', types: 'highlight' }])
  })

  it('reports no change, rejections and errors without applying anything wrong', async () => {
    const noChange = setup([{ status: 'ok', commands: [] }])
    await noChange.session.addSegment('just talking')
    expect(noChange.apply).not.toHaveBeenCalled()
    expect(noChange.statuses.at(-1)).toEqual({ kind: 'no-change' })

    const rejected = setup([{ status: 'ok', commands: [highlight] }], { ok: false, reason: 'No such object: array-a' })
    await rejected.session.addSegment('highlight it')
    expect(rejected.statuses.at(-1)).toEqual({ kind: 'rejected', types: 'highlight', reason: 'No such object: array-a' })

    const failed = setup([{ status: 'error', message: 'HTTP 502' }])
    await failed.session.addSegment('draw something')
    expect(failed.statuses.at(-1)).toEqual({ kind: 'error', message: 'HTTP 502' })
  })

  it('ignores a stale outcome: nothing applied, status left for the newer segment', async () => {
    const { session, apply, statuses } = setup([{ status: 'stale' }])
    await session.addSegment('superseded line')
    expect(apply).not.toHaveBeenCalled()
    expect(statuses).toEqual([{ kind: 'thinking' }])
  })

  it('skips blank segments and keeps only the most recent ones', async () => {
    const { session, interpret } = setup([])
    await session.addSegment('   ')
    expect(interpret).not.toHaveBeenCalled()
    for (let i = 0; i < MAX_SEGMENTS + 3; i++) await session.addSegment(`line ${i}`)
    expect(session.segments()).toHaveLength(MAX_SEGMENTS)
    expect(session.segments().at(-1)?.text).toBe(`line ${MAX_SEGMENTS + 2}`)
  })
})
