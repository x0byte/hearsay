import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import type { CanvasCommand } from './commands'
import { executeCanvasCommand } from './executeCanvasCommand'
import { ARRAY_CELL_SIZE, GAP, MARGIN } from './layout'
import { SemanticStore } from './semanticStore'

// Bounds of shapes already on the page; enough for the layout path.
function fakeEditor(existingBounds: { x: number; y: number; w: number; h: number }[] = []) {
  return {
    createShape: vi.fn(),
    createShapes: vi.fn(),
    getCurrentPageShapes: () => existingBounds,
    getShapePageBounds: (bounds: unknown) => bounds,
  }
}

describe('executeCanvasCommand', () => {
  it('creates a text shape and records it under the semantic ID', () => {
    const editor = fakeEditor()
    const store = new SemanticStore()

    executeCanvasCommand(editor as unknown as Editor, store, {
      type: 'create_text',
      id: 'hello',
      text: 'Hi',
      x: 10,
      y: 20,
    })

    const shape = editor.createShape.mock.calls[0][0]
    expect(shape).toMatchObject({
      type: 'text',
      x: 10,
      y: 20,
      meta: { semanticId: 'hello', kind: 'text', props: { text: 'Hi' } },
    })
    expect(store.get('hello')).toEqual({
      id: 'hello',
      kind: 'text',
      shapeIds: [shape.id],
      props: { text: 'Hi' },
    })
  })

  it('places a command without coordinates below existing shapes', () => {
    const editor = fakeEditor([{ x: 100, y: 100, w: 200, h: 50 }])

    executeCanvasCommand(editor as unknown as Editor, new SemanticStore(), {
      type: 'create_text',
      id: 'second',
      text: 'Below',
    })

    expect(editor.createShape.mock.calls[0][0]).toMatchObject({ x: MARGIN, y: 150 + GAP })
  })

  it('draws an array as a cell and an index label per value, under one semantic ID', () => {
    const editor = fakeEditor()
    const store = new SemanticStore()

    executeCanvasCommand(editor as unknown as Editor, store, {
      type: 'create_array',
      id: 'array-a',
      values: [3, 1],
      x: 0,
      y: 0,
    })

    const shapes = editor.createShapes.mock.calls[0][0]
    const meta = { semanticId: 'array-a', kind: 'array', props: { values: [3, 1] } }
    expect(shapes).toHaveLength(4)
    expect(shapes[0]).toMatchObject({ type: 'geo', x: 0, y: 0, meta })
    expect(shapes[1]).toMatchObject({ type: 'text', meta })
    expect(shapes[2]).toMatchObject({ type: 'geo', x: ARRAY_CELL_SIZE, y: 0, meta })
    expect(store.get('array-a')).toEqual({
      id: 'array-a',
      kind: 'array',
      shapeIds: shapes.map((s: { id: string }) => s.id),
      props: { values: [3, 1] },
    })
  })

  it('highlights only the requested array cell', () => {
    const shapes = [
      { id: 'shape:c0', type: 'geo', meta: { part: 'cell', index: 0 } },
      { id: 'shape:l0', type: 'text', meta: { part: 'index-label', index: 0 } },
      { id: 'shape:c1', type: 'geo', meta: { part: 'cell', index: 1 } },
    ]
    const editor = {
      getShape: (id: string) => shapes.find((s) => s.id === id),
      updateShapes: vi.fn(),
    }
    const store = new SemanticStore()
    store.add({ id: 'array-a', kind: 'array', shapeIds: shapes.map((s) => s.id), props: {} })

    executeCanvasCommand(editor as unknown as Editor, store, {
      type: 'highlight',
      target: 'array-a',
      index: 1,
    })

    expect(editor.updateShapes).toHaveBeenCalledWith([
      { id: 'shape:c1', type: 'geo', props: { fill: 'solid', color: 'orange' } },
    ])
  })

  describe('pointers', () => {
    const cell = { x: 100, y: 100, w: 60, h: 60 }

    // An array with cells 0 and 1, plus whatever pointer shapes a test adds.
    function setup(extraShapes: { id: string; type: string; meta: Record<string, unknown> }[] = []) {
      const shapes = [
        { id: 'shape:c0', type: 'geo', meta: { part: 'cell', index: 0 } },
        { id: 'shape:c1', type: 'geo', meta: { part: 'cell', index: 1 } },
        ...extraShapes,
      ]
      const editor = {
        getShape: (id: string) => shapes.find((s) => s.id === id),
        getShapePageBounds: (s: { meta: { index: number } }) => ({
          ...cell,
          x: cell.x + s.meta.index * cell.w,
        }),
        createShapes: vi.fn(),
        updateShapes: vi.fn(),
      }
      const store = new SemanticStore()
      store.add({
        id: 'array-a',
        kind: 'array',
        shapeIds: ['shape:c0', 'shape:c1'],
        props: { values: [3, 1] },
      })
      return { editor, store }
    }

    it('creates an arrow and label under the target cell', () => {
      const { editor, store } = setup()

      executeCanvasCommand(editor as unknown as Editor, store, {
        type: 'create_pointer',
        id: 'pointer-i',
        label: 'i',
        array: 'array-a',
        index: 1,
      })

      const [arrow, label] = editor.createShapes.mock.calls[0][0]
      const props = { label: 'i', array: 'array-a', index: 1 }
      expect(arrow).toMatchObject({ type: 'arrow', x: 190, meta: { part: 'pointer-arrow', props } })
      expect(label).toMatchObject({ type: 'text', x: 160, meta: { part: 'pointer-label', props } })
      expect(store.get('pointer-i')).toEqual({
        id: 'pointer-i',
        kind: 'pointer',
        shapeIds: [arrow.id, label.id],
        props,
      })
    })

    it('moves the existing arrow and label and updates the stored index', () => {
      const { editor, store } = setup([
        { id: 'shape:pa', type: 'arrow', meta: { part: 'pointer-arrow' } },
        { id: 'shape:pl', type: 'text', meta: { part: 'pointer-label' } },
      ])
      store.add({
        id: 'pointer-i',
        kind: 'pointer',
        shapeIds: ['shape:pa', 'shape:pl'],
        props: { label: 'i', array: 'array-a', index: 0 },
      })

      executeCanvasCommand(editor as unknown as Editor, store, {
        type: 'move_pointer',
        target: 'pointer-i',
        index: 1,
      })

      const [arrow, label] = editor.updateShapes.mock.calls[0][0]
      expect(arrow).toMatchObject({ id: 'shape:pa', x: 190, meta: { props: { index: 1 } } })
      expect(label).toMatchObject({ id: 'shape:pl', x: 160, meta: { props: { index: 1 } } })
      expect(store.get('pointer-i')?.props).toEqual({ label: 'i', array: 'array-a', index: 1 })
    })
  })

  it('throws on an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(() => executeCanvasCommand({} as Editor, new SemanticStore(), unknown)).toThrow(
      'Unhandled canvas command type: not_a_command',
    )
  })
})
