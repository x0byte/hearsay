import type { CanvasCommand, HighlightCommand } from './commands'
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
    case 'highlight':
      return checkHighlight(command, store)
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

function checkHighlight(command: HighlightCommand, store: SemanticStore): ValidationResult {
  const target = store.get(command.target)
  if (!target) return { ok: false, reason: `No such object: ${command.target}` }
  if (command.index === undefined) return { ok: true }
  if (target.kind !== 'array') {
    return { ok: false, reason: `Only arrays have cells: ${command.target}` }
  }
  const length = Array.isArray(target.props.values) ? target.props.values.length : 0
  if (!Number.isInteger(command.index) || command.index < 0 || command.index >= length) {
    return { ok: false, reason: `Index ${command.index} out of range for ${command.target}` }
  }
  return { ok: true }
}
