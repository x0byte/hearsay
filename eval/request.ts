import { parseInterpretRequest } from '../server/interpret.ts'
import type { EvalCase } from './cases.ts'

export const SEGMENT_SPACING_MS = 5_000

// The request an eval case sends, trimmed exactly as the server trims it.
export function requestFor(evalCase: EvalCase) {
  const request = parseInterpretRequest({
    segments: evalCase.segments.map((text, i) => ({ text, at: i * SEGMENT_SPACING_MS })),
    objects: evalCase.board,
  })
  if (!request) throw new Error(`Case ${evalCase.name} is not a valid request`)
  return request
}
