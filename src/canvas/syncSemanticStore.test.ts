import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import { SemanticStore } from './semanticStore'
import { rebuildSemanticStore, syncSemanticStore } from './syncSemanticStore'

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

describe('syncSemanticStore', () => {
  const textShape = (id: string, meta: Record<string, unknown>) => ({ typeName: 'shape', id, meta })
  const helloMeta = { semanticId: 'hello', kind: 'text', props: { text: 'Hi' } }
  const noChanges = { added: {}, updated: {}, removed: {} }

  // A fake editor whose page shapes can change, with the listener captured.
  function setup() {
    let pageShapes: ReturnType<typeof textShape>[] = [textShape('shape:1', helloMeta)]
    let listener: (entry: unknown) => void = () => {}
    const editor = {
      getCurrentPageShapes: () => pageShapes,
      store: {
        listen: vi.fn((callback: (entry: unknown) => void) => {
          listener = callback
          return () => {}
        }),
      },
    }
    const store = new SemanticStore()
    rebuildSemanticStore(editor as unknown as Editor, store)
    syncSemanticStore(editor as unknown as Editor, store)
    return {
      store,
      setPageShapes: (shapes: typeof pageShapes) => (pageShapes = shapes),
      emit: (changes: Partial<typeof noChanges>) => listener({ changes: { ...noChanges, ...changes } }),
    }
  }

  it('drops an object when its shapes are deleted by hand', () => {
    const { store, setPageShapes, emit } = setup()
    setPageShapes([])
    emit({ removed: { 'shape:1': textShape('shape:1', helloMeta) } })
    expect(store.list()).toEqual([])
  })

  it('picks up restored meta, e.g. after undo', () => {
    const { store, setPageShapes, emit } = setup()
    const restored = { ...helloMeta, props: { text: 'Before' } }
    setPageShapes([textShape('shape:1', restored)])
    emit({ updated: { 'shape:1': [textShape('shape:1', helloMeta), textShape('shape:1', restored)] } })
    expect(store.get('hello')?.props).toEqual({ text: 'Before' })
  })

  it('ignores changes to shapes without semantic meta', () => {
    const { store, setPageShapes, emit } = setup()
    setPageShapes([])
    emit({ removed: { 'shape:9': textShape('shape:9', {}) } })
    expect(store.get('hello')).toBeDefined()
  })
})
