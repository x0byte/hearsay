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
  DeleteCommand,
  Highlight,
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
import {
  rebuildSemanticStore,
  toShapeMeta,
  whileApplyingCommands,
  type SemanticShapeMeta,
} from './syncSemanticStore'
import { dropNoOps } from './dropNoOps'
import { validateCommand } from './validateCommand'

export type RunResult = { ok: true } | { ok: false; index: number; reason: string }

// Runs a batch of commands as one undo step, all or nothing. Each command is
// validated just before it runs, so later commands can build on earlier ones
// (e.g. create an array, then a pointer on it). If any command is rejected or
// fails, the canvas is rolled back and the store rebuilt from it.
export function runCommands(
  editor: Editor,
  store: SemanticStore,
  commands: CanvasCommand[],
): RunResult {
  // Safety net: the server already drops no-ops, but the board may have
  // changed since. `index` in a failure refers to the remaining commands.
  const { commands: effective } = dropNoOps(commands, store.list())
  return whileApplyingCommands(() => {
    const mark = editor.markHistoryStoppingPoint('hearsay-commands')
    let result: RunResult = { ok: true }
    editor.run(() => {
      for (const [index, command] of effective.entries()) {
        const validation = validateCommand(command, store)
        if (!validation.ok) {
          result = { ok: false, index, reason: validation.reason }
          return
        }
        try {
          executeCanvasCommand(editor, store, command)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          result = { ok: false, index, reason }
          return
        }
      }
    })
    if (!result.ok) {
      editor.bailToMark(mark)
      rebuildSemanticStore(editor, store)
    }
    return result
  })
}

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
      setHighlight(editor, store, command.target, command.index ?? 'all')
      return
    case 'clear_highlight':
      setHighlight(editor, store, command.target, undefined)
      return
    case 'create_pointer':
      createPointer(editor, store, command)
      return
    case 'move_pointer':
      movePointer(editor, store, command)
      return
    case 'delete':
      deleteObject(editor, store, command)
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
  const cells = arrayCellRects(positionFor(editor, command), command.values)
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

// Highlights are exclusive per object: every shape of the object is redrawn
// from its single current highlight, which is stored in the object's props
// (and each shape's meta, so it survives a reload). `undefined` clears it.
function setHighlight(
  editor: Editor,
  store: SemanticStore,
  target: string,
  highlight: Highlight | undefined,
): void {
  const object = getObject(store, target)
  const props = { ...object.props }
  delete props.highlight
  if (highlight !== undefined) props.highlight = highlight
  const updates: TLShapePartial[] = shapesOf(editor, object).map((shape) => {
    const meta = toShapeMeta({ ...(shape.meta as unknown as SemanticShapeMeta), props })
    if (shape.type === 'text' && object.kind === 'text') {
      const color = highlight === undefined ? 'black' : HIGHLIGHT_COLOR
      return { id: shape.id, type: 'text', meta, props: { color } }
    }
    if (shape.meta.part === 'cell') {
      const on = highlight === 'all' || shape.meta.index === highlight
      const style = on
        ? ({ fill: 'solid', color: HIGHLIGHT_COLOR } as const)
        : ({ fill: 'none', color: 'black' } as const)
      return { id: shape.id, type: 'geo', meta, props: style }
    }
    return { id: shape.id, type: shape.type, meta }
  })
  editor.updateShapes(updates)
  store.updateProps(object.id, props)
}

function shapesOf(editor: Editor, object: SemanticObject): TLShape[] {
  return object.shapeIds
    .map((id) => editor.getShape(id as TLShapeId))
    .filter((shape) => shape !== undefined)
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

// Pointers on a deleted array would point at nothing, so they go too.
function deleteObject(editor: Editor, store: SemanticStore, command: DeleteCommand): void {
  const target = getObject(store, command.target)
  const dependents = store
    .list()
    .filter((object) => object.kind === 'pointer' && object.props.array === target.id)
  const removed = [target, ...dependents]
  editor.deleteShapes(removed.flatMap((object) => object.shapeIds) as TLShapeId[])
  for (const object of removed) store.remove(object.id)
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
  const shape = shapesOf(editor, object).find((s) => s.meta.part === part && (index === undefined || s.meta.index === index))
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
