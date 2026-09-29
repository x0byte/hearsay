import {
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLGeoShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  type TLTextShape,
} from 'tldraw'
import type {
  CanvasCommand,
  CreateArrayCommand,
  CreatePointerCommand,
  CreateTextCommand,
  HighlightCommand,
  MovePointerCommand,
} from './commands'
import {
  arrayCellRects,
  nextFreePosition,
  pointerGeometry,
  type Point,
  type Rect,
} from './layout'
import type { SemanticObject, SemanticStore } from './semanticStore'
import { toShapeMeta, type SemanticShapeMeta } from './syncSemanticStore'

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
    case 'highlight':
      highlight(editor, store, command)
      return
    case 'create_pointer':
      createPointer(editor, store, command)
      return
    case 'move_pointer':
      movePointer(editor, store, command)
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
// shape carries the array's semantic meta (so they rebuild as one object) plus
// which cell or label it draws.
function createArray(editor: Editor, store: SemanticStore, command: CreateArrayCommand): void {
  const props = { values: command.values }
  const base = { semanticId: command.id, kind: 'array' as const, props }
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
      meta: toShapeMeta({ ...base, part: 'cell', index }),
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
      meta: toShapeMeta({ ...base, part: 'index-label', index }),
    } satisfies TLShapePartial<TLTextShape>)
  })
  editor.createShapes(shapes)
  store.add({ id: command.id, kind: 'array', shapeIds: shapes.map((s) => s.id), props })
}

const HIGHLIGHT_COLOR = 'orange'

// Fills array cells (all, or just `index`) and recolours text objects.
function highlight(editor: Editor, store: SemanticStore, command: HighlightCommand): void {
  const target = store.get(command.target)
  if (!target) throw new Error(`No such object: ${command.target}`)
  const shapes = target.shapeIds
    .map((id) => editor.getShape(id as TLShapeId))
    .filter((shape) => shape !== undefined)
  const updates: TLShapePartial[] = []
  for (const shape of shapes) {
    if (shape.type === 'text' && target.kind === 'text') {
      updates.push({ id: shape.id, type: 'text', props: { color: HIGHLIGHT_COLOR } })
    } else if (shape.meta.part === 'cell' && isSelectedCell(shape, command.index)) {
      updates.push({ id: shape.id, type: 'geo', props: { fill: 'solid', color: HIGHLIGHT_COLOR } })
    }
  }
  editor.updateShapes(updates)
}

function isSelectedCell(shape: TLShape, index: number | undefined): boolean {
  return index === undefined || shape.meta.index === index
}

function createPointer(editor: Editor, store: SemanticStore, command: CreatePointerCommand): void {
  const props = { label: command.label, array: command.array, index: command.index }
  const ids = { arrow: createShapeId(), label: createShapeId() }
  const cell = cellBounds(editor, store, command.array, command.index)
  editor.createShapes(pointerShapes(ids, cell, { semanticId: command.id, kind: 'pointer', props }))
  store.add({ id: command.id, kind: 'pointer', shapeIds: [ids.arrow, ids.label], props })
}

// Redraws the pointer's arrow and label under the new cell, and updates the
// semantic meta on both so a reload sees the new index.
function movePointer(editor: Editor, store: SemanticStore, command: MovePointerCommand): void {
  const pointer = getObject(store, command.target)
  const props: Record<string, unknown> = { ...pointer.props, index: command.index }
  const ids = {
    arrow: findPart(editor, pointer, 'pointer-arrow').id,
    label: findPart(editor, pointer, 'pointer-label').id,
  }
  const cell = cellBounds(editor, store, String(props.array), command.index)
  editor.updateShapes(pointerShapes(ids, cell, { semanticId: pointer.id, kind: 'pointer', props }))
  store.updateProps(pointer.id, props)
}

function pointerShapes(
  ids: { arrow: TLShapeId; label: TLShapeId },
  cell: Rect,
  base: SemanticShapeMeta,
): TLShapePartial[] {
  const { tip, tail, label, labelWidth } = pointerGeometry(cell)
  return [
    {
      id: ids.arrow,
      type: 'arrow',
      x: tail.x,
      y: tail.y,
      props: { start: { x: 0, y: 0 }, end: { x: tip.x - tail.x, y: tip.y - tail.y } },
      meta: toShapeMeta({ ...base, part: 'pointer-arrow' }),
    } satisfies TLShapePartial<TLArrowShape>,
    {
      id: ids.label,
      type: 'text',
      x: label.x,
      y: label.y,
      props: {
        richText: toRichText(String(base.props.label)),
        textAlign: 'middle',
        autoSize: false,
        w: labelWidth,
      },
      meta: toShapeMeta({ ...base, part: 'pointer-label' }),
    } satisfies TLShapePartial<TLTextShape>,
  ]
}

function getObject(store: SemanticStore, id: string): SemanticObject {
  const object = store.get(id)
  if (!object) throw new Error(`No such object: ${id}`)
  return object
}

function findPart(
  editor: Editor,
  object: SemanticObject,
  part: SemanticShapeMeta['part'],
  index?: number,
): TLShape {
  const shape = object.shapeIds
    .map((id) => editor.getShape(id as TLShapeId))
    .filter((s) => s !== undefined)
    .find((s) => s.meta.part === part && (index === undefined || s.meta.index === index))
  if (!shape) throw new Error(`${object.id} has no ${part}${index === undefined ? '' : ` ${index}`}`)
  return shape
}

// Where a cell currently is on the page, even if the array was moved by hand.
function cellBounds(editor: Editor, store: SemanticStore, arrayId: string, index: number): Rect {
  const cell = findPart(editor, getObject(store, arrayId), 'cell', index)
  const bounds = editor.getShapePageBounds(cell)
  if (!bounds) throw new Error(`${arrayId} cell ${index} has no bounds`)
  return bounds
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
