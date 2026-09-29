import { describe, expect, it } from 'vitest'
import type { Editor } from 'tldraw'
import { SemanticStore } from './semanticStore'
import { rebuildSemanticStore } from './syncSemanticStore'

function editorWithShapes(shapes: { id: string; meta: Record<string, unknown> }[]) {
  return { getCurrentPageShapes: () => shapes } as unknown as Editor
}

describe('rebuildSemanticStore', () => {
  it('groups shapes by semantic ID and ignores shapes without semantic meta', () => {
    const arrayMeta = { semanticId: 'array-a', kind: 'array', props: { values: [3, 1] } }
    const editor = editorWithShapes([
      { id: 'shape:1', meta: arrayMeta },
      { id: 'shape:2', meta: {} },
      { id: 'shape:3', meta: arrayMeta },
    ])
    const store = new SemanticStore()

    rebuildSemanticStore(editor, store)

    expect(store.list()).toEqual([
      { id: 'array-a', kind: 'array', shapeIds: ['shape:1', 'shape:3'], props: { values: [3, 1] } },
    ])
  })

  it('replaces whatever the store held before', () => {
    const store = new SemanticStore()
    store.add({ id: 'stale', kind: 'text', shapeIds: ['shape:9'], props: {} })

    rebuildSemanticStore(editorWithShapes([]), store)

    expect(store.list()).toEqual([])
  })
})
