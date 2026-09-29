// Explicit .ts extensions: this module is also loaded by the Node server.
import type { CanvasCommand, CreatePointerCommand, HighlightCommand, MovePointerCommand } from './commands.ts'
import type { SemanticStore } from './semanticStore.ts'

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
    case 'create_pointer':
      return checkCreatePointer(command, store)
    case 'move_pointer':
      return checkMovePointer(command, store)
    case 'swap': {
      const first = checkArrayCell(command.target, command.i, store)
      return first.ok ? checkArrayCell(command.target, command.j, store) : first
    }
    case 'set_value':
      if (typeof command.value === 'number' ? !Number.isFinite(command.value) : command.value.trim() === '') {
        return { ok: false, reason: `Invalid value for ${command.target}` }
      }
      return checkArrayCell(command.target, command.index, store)
    case 'clear_highlight':
    case 'delete':
      if (!store.get(command.target)) return { ok: false, reason: `No such object: ${command.target}` }
      return { ok: true }
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
  if (!store.get(command.target)) return { ok: false, reason: `No such object: ${command.target}` }
  if (command.index === undefined) return { ok: true }
  return checkArrayCell(command.target, command.index, store)
}

function checkCreatePointer(command: CreatePointerCommand, store: SemanticStore): ValidationResult {
  const newId = checkNewId(command.id, store)
  if (!newId.ok) return newId
  return checkArrayCell(command.array, command.index, store)
}

function checkMovePointer(command: MovePointerCommand, store: SemanticStore): ValidationResult {
  const pointer = store.get(command.target)
  if (!pointer) return { ok: false, reason: `No such object: ${command.target}` }
  if (pointer.kind !== 'pointer') return { ok: false, reason: `Not a pointer: ${command.target}` }
  return checkArrayCell(String(pointer.props.array), command.index, store)
}

// The array exists and `index` is one of its cells.
function checkArrayCell(arrayId: string, index: number, store: SemanticStore): ValidationResult {
  const array = store.get(arrayId)
  if (!array) return { ok: false, reason: `No such object: ${arrayId}` }
  if (array.kind !== 'array') return { ok: false, reason: `Only arrays have cells: ${arrayId}` }
  const length = Array.isArray(array.props.values) ? array.props.values.length : 0
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    return { ok: false, reason: `Index ${index} out of range for ${arrayId}` }
  }
  return { ok: true }
}
