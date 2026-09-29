import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import { SemanticStore } from './semanticStore'
import { rebuildSemanticStore, syncSemanticStore, whileApplyingCommands } from './syncSemanticStore'

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
  type FakeShape = { id: string; meta: Record<string, unknown> }
  const helloMeta = { semanticId: 'hello', kind: 'text', props: { text: 'Hi' } }
  const hello = (meta: Record<string, unknown> = helloMeta): FakeShape => ({ id: 'shape:1', meta })
  const flushMicrotasks = () => Promise.resolve()

  // A fake editor whose page shapes can change, with the side-effect handlers
  // captured so tests can fire them like tldraw would.
  function setup() {
    let pageShapes: FakeShape[] = [hello()]
    const handlers: Record<string, (...args: FakeShape[]) => void> = {}
    const register = (kind: string) => (_type: string, handler: (...args: FakeShape[]) => void) => {
      handlers[kind] = handler
      return () => delete handlers[kind]
    }
    const editor = {
      getCurrentPageShapes: vi.fn(() => pageShapes),
      sideEffects: {
        registerAfterCreateHandler: register('create'),
        registerAfterDeleteHandler: register('delete'),
        registerAfterChangeHandler: register('change'),
      },
    }
    const store = new SemanticStore()
    rebuildSemanticStore(editor as unknown as Editor, store)
    const stop = syncSemanticStore(editor as unknown as Editor, store)
    editor.getCurrentPageShapes.mockClear()
    return {
      editor,
      store,
      handlers,
      stop,
      setPageShapes: (shapes: FakeShape[]) => (pageShapes = shapes),
    }
  }

  it('drops an object when its shapes are deleted by hand', async () => {
    const { store, handlers, setPageShapes } = setup()
    setPageShapes([])
    handlers.delete(hello())
    await flushMicrotasks()
    expect(store.list()).toEqual([])
  })

  it('picks up restored meta, e.g. after undo', async () => {
    const { store, handlers, setPageShapes } = setup()
    const restored = { ...helloMeta, props: { text: 'Before' } }
    setPageShapes([hello(restored)])
    handlers.change(hello(), hello(restored))
    await flushMicrotasks()
    expect(store.get('hello')?.props).toEqual({ text: 'Before' })
  })

  it('ignores changes made while applying commands', async () => {
    const { editor, handlers, setPageShapes } = setup()
    setPageShapes([])
    whileApplyingCommands(() => {
      handlers.create(hello())
      handlers.delete(hello())
    })
    await flushMicrotasks()
    expect(editor.getCurrentPageShapes).not.toHaveBeenCalled()
  })

  it('rebuilds once for many shapes deleted together', async () => {
    const { editor, handlers, setPageShapes } = setup()
    setPageShapes([])
    handlers.delete(hello())
    handlers.delete({ id: 'shape:2', meta: helloMeta })
    await flushMicrotasks()
    expect(editor.getCurrentPageShapes).toHaveBeenCalledTimes(1)
  })

  it('ignores shapes without semantic meta', async () => {
    const { editor, handlers } = setup()
    handlers.delete({ id: 'shape:9', meta: {} })
    await flushMicrotasks()
    expect(editor.getCurrentPageShapes).not.toHaveBeenCalled()
  })

  it('stops syncing when unsubscribed', () => {
    const { handlers, stop } = setup()
    stop()
    expect(Object.keys(handlers)).toEqual([])
  })
})
