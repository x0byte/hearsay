import type { Editor, JsonObject, TLShape } from 'tldraw'
import type { SemanticKind, SemanticObject, SemanticStore } from './semanticStore'

// Each tldraw shape drawn for a semantic object carries this in its `meta`,
// so the semantic store can be rebuilt from the persisted canvas.
export type SemanticShapeMeta = {
  semanticId: string
  kind: SemanticKind
  props: Record<string, unknown>
  // Which part of the object this shape draws, e.g. array cell 2.
  part?: 'cell' | 'index-label' | 'pointer-arrow' | 'pointer-label'
  index?: number
}

export function toShapeMeta(object: SemanticShapeMeta): JsonObject {
  // props is always JSON-serialisable; tldraw's meta type just can't see that.
  return object as unknown as JsonObject
}

function readShapeMeta(shape: TLShape): SemanticShapeMeta | undefined {
  const { semanticId, kind, props } = shape.meta
  if (typeof semanticId !== 'string') return undefined
  return { semanticId, kind: kind as SemanticKind, props: (props ?? {}) as Record<string, unknown> }
}

// Replaces the store's contents with the semantic objects found on the
// current page. Shapes without semantic meta (e.g. manual drawings) are ignored.
export function rebuildSemanticStore(editor: Editor, store: SemanticStore): void {
  const objects = new Map<string, SemanticObject>()
  for (const shape of editor.getCurrentPageShapes()) {
    const meta = readShapeMeta(shape)
    if (!meta) continue
    const existing = objects.get(meta.semanticId)
    if (existing) {
      existing.shapeIds.push(shape.id)
    } else {
      objects.set(meta.semanticId, {
        id: meta.semanticId,
        kind: meta.kind,
        shapeIds: [shape.id],
        props: meta.props,
      })
    }
  }
  store.clear()
  for (const object of objects.values()) store.add(object)
}

// True while runCommands is applying (or rolling back) a batch. Those changes
// already update the store, so sync ignores them.
let applyingCommands = false

export function whileApplyingCommands<T>(fn: () => T): T {
  const previous = applyingCommands
  applyingCommands = true
  try {
    return fn()
  } finally {
    applyingCommands = previous
  }
}

// Keeps the store in step with changes made outside runCommands: manual
// deletes, undo and redo. Side-effect handlers run synchronously with each
// change, so they can tell our own changes apart; store.listen can't, because
// it reports every local change as source 'user' on the next frame.
// Rebuilding from shape meta gives the same result a reload would. Returns a
// function that stops syncing.
export function syncSemanticStore(editor: Editor, store: SemanticStore): () => void {
  let rebuildPending = false
  const onSemanticChange = () => {
    if (applyingCommands || rebuildPending) return
    // Deleting many shapes fires once per shape; rebuild once, after the change.
    rebuildPending = true
    queueMicrotask(() => {
      rebuildPending = false
      rebuildSemanticStore(editor, store)
    })
  }
  const { sideEffects } = editor
  const unsubscribers = [
    sideEffects.registerAfterCreateHandler('shape', (shape) => {
      if (isSemanticShape(shape)) onSemanticChange()
    }),
    sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      if (isSemanticShape(shape)) onSemanticChange()
    }),
    // e.g. undoing move_pointer restores the old meta.
    sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
      if (prev.meta !== next.meta && (isSemanticShape(prev) || isSemanticShape(next))) {
        onSemanticChange()
      }
    }),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

function isSemanticShape(shape: TLShape): boolean {
  return typeof shape.meta.semanticId === 'string'
}
