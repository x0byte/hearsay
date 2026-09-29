import type { CanvasCommand } from '../canvas/commands.ts'
import type { InterpretOutcome } from './client.ts'
import type { InterpretRequest, TranscriptSegment } from './protocol.ts'
import type { SemanticObject } from '../canvas/semanticStore.ts'

// The server trims to its own window; this just keeps requests small.
export const MAX_SEGMENTS = 20

export type SessionStatus =
  | { kind: 'thinking' }
  | { kind: 'applied'; types: string }
  | { kind: 'no-change' }
  | { kind: 'rejected'; types: string; reason: string }
  | { kind: 'error'; message: string }

type Deps = {
  interpret: (request: InterpretRequest) => Promise<InterpretOutcome>
  apply: (commands: CanvasCommand[]) => { ok: true } | { ok: false; reason: string }
  objects: () => SemanticObject[]
  onStatus: (status: SessionStatus) => void
  now?: () => number
}

// One transcript shared by every input (voice, the dev text box): each new
// segment is sent with the recent ones as context, and whatever the model
// returns is applied to the canvas. A segment superseded by a newer one while
// in flight is dropped (the interpreter reports it as stale).
export function createTranscriptSession({ interpret, apply, objects, onStatus, now = Date.now }: Deps) {
  const startedAt = now()
  let segments: TranscriptSegment[] = []

  async function addSegment(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    segments = [...segments, { text: trimmed, at: now() - startedAt }].slice(-MAX_SEGMENTS)
    onStatus({ kind: 'thinking' })
    const outcome = await interpret({ segments, objects: objects() })
    if (outcome.status === 'stale') return
    if (outcome.status === 'error') return onStatus({ kind: 'error', message: outcome.message })
    if (outcome.commands.length === 0) return onStatus({ kind: 'no-change' })
    const types = outcome.commands.map((command) => command.type).join(', ')
    const result = apply(outcome.commands)
    onStatus(result.ok ? { kind: 'applied', types } : { kind: 'rejected', types, reason: result.reason })
  }

  return { addSegment, segments: () => segments }
}

export function describeStatus(status: SessionStatus): string {
  switch (status.kind) {
    case 'thinking':
      return 'Thinking…'
    case 'applied':
      return `Applied: ${status.types}`
    case 'no-change':
      return 'No change.'
    case 'rejected':
      return `Rejected ${status.types}: ${status.reason}`
    case 'error':
      return `Error: ${status.message}`
  }
}
