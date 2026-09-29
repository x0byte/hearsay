import {
  createShapeId,
  toRichText,
  type Editor,
  type TLGeoShape,
  type TLShapePartial,
  type TLTextShape,
} from 'tldraw'
import type { CanvasCommand, CreateArrayCommand, CreateTextCommand } from './commands'
import { arrayCellRects, nextFreePosition, type Point, type Rect } from './layout'
import type { SemanticStore } from './semanticStore'
import { toShapeMeta } from './syncSemanticStore'

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
    case 'create_array':
      createArray(editor, store, command)
      return
    default: {
      // Fails to compile if a new command type is added without a case above.
      const unhandled: never = command
      throw new Error(`Unhandled canvas command type: ${(unhandled as CanvasCommand).type}`)
    }
  }
}

// command.id is the semantic ID; the tldraw shape gets its own generated ID,
// and the store links the two.
function createText(editor: Editor, store: SemanticStore, command: CreateTextCommand): void {
  const shapeId = createShapeId()
  const props = { text: command.text }
  const { x, y } = positionFor(editor, command)
  editor.createShape<TLTextShape>({
    id: shapeId,
    type: 'text',
    x,
    y,
    props: { richText: toRichText(command.text) },
    meta: toShapeMeta({ semanticId: command.id, kind: 'text', props }),
  })
  store.add({ id: command.id, kind: 'text', shapeIds: [shapeId], props })
}

// Each value becomes a square cell with its index labelled underneath. Every
// shape carries the same semantic meta, so they rebuild as one object.
function createArray(editor: Editor, store: SemanticStore, command: CreateArrayCommand): void {
  const props = { values: command.values }
  const meta = toShapeMeta({ semanticId: command.id, kind: 'array', props })
  const cells = arrayCellRects(positionFor(editor, command), command.values.length)
  const shapes: TLShapePartial[] = []
  cells.forEach((cell, index) => {
    shapes.push({
      id: createShapeId(),
      type: 'geo',
      x: cell.x,
      y: cell.y,
      props: {
        geo: 'rectangle',
        w: cell.w,
        h: cell.h,
        richText: toRichText(String(command.values[index])),
      },
      meta,
    } satisfies TLShapePartial<TLGeoShape>)
    shapes.push({
      id: createShapeId(),
      type: 'text',
      x: cell.x,
      y: cell.y + cell.h + 4,
      props: {
        richText: toRichText(String(index)),
        size: 's',
        color: 'grey',
        textAlign: 'middle',
        autoSize: false,
        w: cell.w,
      },
      meta,
    } satisfies TLShapePartial<TLTextShape>)
  })
  editor.createShapes(shapes)
  store.add({ id: command.id, kind: 'array', shapeIds: shapes.map((s) => s.id), props })
}

function positionFor(editor: Editor, command: { x?: number; y?: number }): Point {
  if (command.x !== undefined && command.y !== undefined) return { x: command.x, y: command.y }
  return nextFreePosition(occupiedRects(editor))
}

function occupiedRects(editor: Editor): Rect[] {
  return editor
    .getCurrentPageShapes()
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((bounds) => bounds !== undefined)
}
