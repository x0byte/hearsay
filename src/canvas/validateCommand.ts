import type { CanvasCommand } from './commands'
import type { SemanticStore } from './semanticStore'

export type ValidationResult = { ok: true } | { ok: false; reason: string }

// Checks a command against what currently exists on the canvas, before it is
// executed. Commands from any source (parser, model) must pass through here.
export function validateCommand(command: CanvasCommand, store: SemanticStore): ValidationResult {
  switch (command.type) {
    case 'create_text':
      return checkNewId(command.id, store)
    case 'create_array':
      if (command.values.length === 0) {
        return { ok: false, reason: `Array has no values: ${command.id}` }
      }
      return checkNewId(command.id, store)
    default: {
      // Fails to compile if a new command type is added without a case above.
      const unhandled: never = command
      return { ok: false, reason: `Unknown command type: ${(unhandled as CanvasCommand).type}` }
    }
  }
}

function checkNewId(id: string, store: SemanticStore): ValidationResult {
  if (store.get(id)) return { ok: false, reason: `Object already exists: ${id}` }
  return { ok: true }
}
