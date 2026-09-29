// Explicit .ts extensions: this module is also loaded by the Node server.
import type { CanvasCommand, Highlight } from './commands.ts'
import type { SemanticObject } from './semanticStore.ts'

export type NoOpResult = { commands: CanvasCommand[]; dropped: CanvasCommand[] }

// Removes commands that would not change the board: moving a pointer to the
// index it is already on, a highlight equal to the object's current one, and
// clearing a highlight that isn't there. Commands are checked in order against
// the board as earlier commands in the batch leave it. Anything else, including
// commands on unknown objects, is kept for the validator to judge.
export function dropNoOps(commands: CanvasCommand[], objects: SemanticObject[]): NoOpResult {
  const state = new Map(objects.map((o) => [o.id, { ...o.props }]))
  const kept: CanvasCommand[] = []
  const dropped: CanvasCommand[] = []

  for (const command of commands) {
    const current = 'target' in command ? state.get(command.target) : undefined
    let noOp = false
    switch (command.type) {
      case 'move_pointer':
        noOp = current?.index === command.index
        if (current && !noOp) current.index = command.index
        break
      case 'highlight': {
        const requested: Highlight = command.index ?? 'all'
        noOp = current !== undefined && current.highlight === requested
        if (current && !noOp) current.highlight = requested
        break
      }
      case 'clear_highlight':
        noOp = current !== undefined && current.highlight === undefined
        if (current) delete current.highlight
        break
      case 'delete':
        state.delete(command.target)
        break
      case 'create_text':
      case 'create_array':
      case 'create_pointer': {
        const { type: _type, id, ...props } = command
        state.set(id, props)
        break
      }
    }
    if (noOp) dropped.push(command)
    else kept.push(command)
  }
  return { commands: kept, dropped }
}
