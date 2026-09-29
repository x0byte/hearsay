import { createShapeId, toRichText, type Editor, type TLTextShape } from 'tldraw'
import type { CanvasCommand, CreateTextCommand } from './commands'
import type { SemanticStore } from './semanticStore'

// Applies a CanvasCommand to a tldraw Editor and records the result in the
// semantic store. All tldraw-specific translation lives here so the command
// protocol stays independent of the canvas library.
export function executeCanvasCommand(
  editor: Editor,
  store: SemanticStore,
  command: CanvasCommand,
): void {
  switch (command.type) {
    case 'create_text':
      createText(editor, store, command)
      return
    default: {
      // Fails to compile if a new command type is added without a case above.
      const unhandled: never = command.type
      throw new Error(`Unhandled canvas command type: ${String(unhandled)}`)
    }
  }
}

// command.id is the semantic ID; the tldraw shape gets its own generated ID,
// and the store links the two.
function createText(editor: Editor, store: SemanticStore, command: CreateTextCommand): void {
  const shapeId = createShapeId()
  editor.createShape<TLTextShape>({
    id: shapeId,
    type: 'text',
    x: command.x,
    y: command.y,
    props: { richText: toRichText(command.text) },
  })
  store.add({ id: command.id, kind: 'text', shapeIds: [shapeId], props: { text: command.text } })
}
