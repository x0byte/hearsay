import { toRichText, type Editor, type TLTextShape } from 'tldraw'
import type { CanvasCommand, CreateTextCommand } from './commands'

// Applies a CanvasCommand to a tldraw Editor. All tldraw-specific translation
// lives here so the command protocol stays independent of the canvas library.
export function executeCanvasCommand(editor: Editor, command: CanvasCommand): void {
  switch (command.type) {
    case 'create_text':
      createText(editor, command)
      return
    default: {
      // Fails to compile if a new command type is added without a case above.
      const unhandled: never = command.type
      throw new Error(`Unhandled canvas command type: ${String(unhandled)}`)
    }
  }
}

// command.id is a domain-level ID and is intentionally not used as the tldraw
// shape ID; tldraw generates its own.
function createText(editor: Editor, command: CreateTextCommand): void {
  editor.createShape<TLTextShape>({
    type: 'text',
    x: command.x,
    y: command.y,
    props: { richText: toRichText(command.text) },
  })
}
