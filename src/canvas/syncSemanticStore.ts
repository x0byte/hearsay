import type { Editor, JsonObject, TLShape } from 'tldraw'
import type { SemanticKind, SemanticObject, SemanticStore } from './semanticStore'

// Each tldraw shape drawn for a semantic object carries this in its `meta`,
// so the semantic store can be rebuilt from the persisted canvas.
export type SemanticShapeMeta = {
  semanticId: string
  kind: SemanticKind
  props: Record<string, unknown>
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
