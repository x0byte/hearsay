import type { CanvasCommand } from '../canvas/commands.ts'
import type { InterpretRequest } from './protocol.ts'

export type InterpretOutcome =
  | { status: 'ok'; commands: CanvasCommand[] }
  | { status: 'stale' } // a newer request superseded this one; ignore it
  | { status: 'error'; message: string }

type Fetch = (input: string, init: RequestInit) => Promise<Response>

// Returns an interpret() where the latest call wins: each call aborts the one
// still in flight, and a response that arrives after a newer call started is
// reported as stale rather than applied.
export function createInterpreter(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  let latest = 0
  let inFlight: AbortController | undefined

  return async function interpret(request: InterpretRequest): Promise<InterpretOutcome> {
    const id = ++latest
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    try {
      const response = await fetchImpl('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => undefined)
      if (id !== latest) return { status: 'stale' }
      if (!response.ok) {
        return { status: 'error', message: body?.error ?? `HTTP ${response.status}` }
      }
      if (!Array.isArray(body?.commands)) return { status: 'error', message: 'Malformed response' }
      return { status: 'ok', commands: body.commands }
    } catch (error) {
      if (id !== latest) return { status: 'stale' }
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }
}
