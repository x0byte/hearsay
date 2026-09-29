import { describe, expect, it } from 'vitest'
import { createInterpreter } from './client'
import type { InterpretRequest } from './protocol'

const request = (text: string): InterpretRequest => ({ segments: [{ text, at: 0 }], objects: [] })

// A fake fetch whose responses the test releases by hand, in any order.
// Like real fetch, it rejects if its signal is aborted before it resolves.
function controllableFetch() {
  const pending: { signal: AbortSignal; respond: (commands: unknown[]) => void }[] = []
  const fetchImpl = (_input: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      pending.push({
        signal,
        respond: (commands) => resolve(Response.json({ commands })),
      })
    })
  return { fetchImpl, pending }
}

const highlight = { type: 'highlight', target: 'array-a' }

describe('createInterpreter', () => {
  it('returns the commands from the server', async () => {
    const { fetchImpl, pending } = controllableFetch()
    const interpret = createInterpreter(fetchImpl)

    const result = interpret(request('highlight the array'))
    pending[0].respond([highlight])

    expect(await result).toEqual({ status: 'ok', commands: [highlight] })
  })

  it('aborts the previous request when a new one starts', async () => {
    const { fetchImpl, pending } = controllableFetch()
    const interpret = createInterpreter(fetchImpl)

    const first = interpret(request('first'))
    const second = interpret(request('second'))

    expect(pending[0].signal.aborted).toBe(true)
    expect(await first).toEqual({ status: 'stale' })
    pending[1].respond([])
    expect(await second).toEqual({ status: 'ok', commands: [] })
  })

  it('discards a stale response that arrives after a newer request', async () => {
    // A fetch that ignores abort, so the old response really does arrive late.
    const releases: ((commands: unknown[]) => void)[] = []
    const interpret = createInterpreter(
      () => new Promise((resolve) => releases.push((commands) => resolve(Response.json({ commands })))),
    )

    const first = interpret(request('first'))
    const second = interpret(request('second'))
    releases[1]([])
    releases[0]([highlight]) // the older response lands last

    expect(await second).toEqual({ status: 'ok', commands: [] })
    expect(await first).toEqual({ status: 'stale' })
  })

  it('reports server errors', async () => {
    const interpret = createInterpreter(async () =>
      Response.json({ error: 'Interpretation failed' }, { status: 502 }),
    )
    expect(await interpret(request('x'))).toEqual({ status: 'error', message: 'Interpretation failed' })
  })
})
