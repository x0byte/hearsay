// Shared contract for POST /api/interpret, used by the browser client and the
// Node server. Explicit .ts extensions: the server loads this module too.
import type { CanvasCommand } from '../canvas/commands.ts'
import type { SemanticObject } from '../canvas/semanticStore.ts'

export type TranscriptSegment = {
  text: string
  at: number // ms since session start
}

export type InterpretRequest = {
  segments: TranscriptSegment[] // oldest first; the last one is the newest
  objects: SemanticObject[]
}

export type InterpretResponse = { commands: CanvasCommand[] }
