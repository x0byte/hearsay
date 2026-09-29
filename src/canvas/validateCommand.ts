import type { CanvasCommand } from './commands'
import type { SemanticStore } from './semanticStore'

export type ValidationResult = { ok: true } | { ok: false; reason: string }

// Checks a command against what currently exists on the canvas, before it is
// executed. Commands from any source (parser, model) must pass through here.
export function validateCommand(command: CanvasCommand, store: SemanticStore): ValidationResult {
  switch (command.type) {
    case 'create_text':
      if (store.get(command.id)) {
        return { ok: false, reason: `Object already exists: ${command.id}` }
      }
      return { ok: true }
    default: {
      // Fails to compile if a new command type is added without a case above.
      const unhandled: never = command.type
      return { ok: false, reason: `Unknown command type: ${String(unhandled)}` }
    }
  }
}
