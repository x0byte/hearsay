import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import type { CanvasCommand } from './commands'
import { executeCanvasCommand, runCommands } from './executeCanvasCommand'
import { ARRAY_CELL_SIZE, arrayCellWidth, GAP, MARGIN, pointerGeometry } from './layout'
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

  describe('highlight', () => {
    const arrayMeta = { semanticId: 'array-a', kind: 'array', props: { values: [5, 2] } }
    // Two cells and one index label of array-a, already highlighted at cell 0.
    function setup() {
      const shapes = [
        { id: 'shape:c0', type: 'geo', meta: { ...arrayMeta, part: 'cell', index: 0 } },
        { id: 'shape:l0', type: 'text', meta: { ...arrayMeta, part: 'index-label', index: 0 } },
        { id: 'shape:c1', type: 'geo', meta: { ...arrayMeta, part: 'cell', index: 1 } },
      ]
      const editor = {
        getShape: (id: string) => shapes.find((s) => s.id === id),
        updateShapes: vi.fn(),
      }
      const store = new SemanticStore()
      store.add({
        id: 'array-a',
        kind: 'array',
        shapeIds: shapes.map((s) => s.id),
        props: { values: [5, 2], highlight: 0 },
      })
      return { editor: editor as typeof editor & Editor, updateShapes: editor.updateShapes, store }
    }

    it('replaces the previous highlight and records the new one', () => {
      const { editor, updateShapes, store } = setup()

      executeCanvasCommand(editor, store, { type: 'highlight', target: 'array-a', index: 1 })

      const props = { values: [5, 2], highlight: 1 }
      expect(updateShapes).toHaveBeenCalledWith([
        { id: 'shape:c0', type: 'geo', props: { fill: 'none', color: 'black' }, meta: { ...arrayMeta, props, part: 'cell', index: 0 } },
        { id: 'shape:l0', type: 'text', meta: { ...arrayMeta, props, part: 'index-label', index: 0 } },
        { id: 'shape:c1', type: 'geo', props: { fill: 'solid', color: 'orange' }, meta: { ...arrayMeta, props, part: 'cell', index: 1 } },
      ])
      expect(store.get('array-a')?.props).toEqual(props)
    })

    it('highlights every cell when no index is given', () => {
      const { editor, updateShapes, store } = setup()
      executeCanvasCommand(editor, store, { type: 'highlight', target: 'array-a' })
      const cells = updateShapes.mock.calls[0][0].filter((u: { type: string }) => u.type === 'geo')
      expect(cells.map((u: { props: object }) => u.props)).toEqual([
        { fill: 'solid', color: 'orange' },
        { fill: 'solid', color: 'orange' },
      ])
      expect(store.get('array-a')?.props.highlight).toBe('all')
    })

    it('clear_highlight resets every cell and removes the stored highlight', () => {
      const { editor, updateShapes, store } = setup()
      executeCanvasCommand(editor, store, { type: 'clear_highlight', target: 'array-a' })
      const cells = updateShapes.mock.calls[0][0].filter((u: { type: string }) => u.type === 'geo')
      expect(cells.map((u: { props: object }) => u.props)).toEqual([
        { fill: 'none', color: 'black' },
        { fill: 'none', color: 'black' },
      ])
      expect(store.get('array-a')?.props).toEqual({ values: [5, 2] })
    })
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

  describe('swap and set_value', () => {
    // array-a [5, 2] at (100, 100) with pointer i on cell 1.
    function setup() {
      const meta = (part: string, index?: number) => ({ semanticId: 'x', part, index })
      const shapes = [
        { id: 'shape:c0', type: 'geo', x: 100, y: 100, meta: meta('cell', 0) },
        { id: 'shape:l0', type: 'text', x: 100, y: 164, meta: meta('index-label', 0) },
        { id: 'shape:c1', type: 'geo', x: 160, y: 100, meta: meta('cell', 1) },
        { id: 'shape:l1', type: 'text', x: 160, y: 164, meta: meta('index-label', 1) },
        { id: 'shape:pa', type: 'arrow', x: 0, y: 0, meta: meta('pointer-arrow') },
        { id: 'shape:pl', type: 'text', x: 0, y: 0, meta: meta('pointer-label') },
      ]
      const editor = { getShape: (id: string) => shapes.find((s) => s.id === id), updateShapes: vi.fn() }
      const store = new SemanticStore()
      store.add({
        id: 'array-a',
        kind: 'array',
        shapeIds: ['shape:c0', 'shape:l0', 'shape:c1', 'shape:l1'],
        props: { values: [5, 2], highlight: 1 },
      })
      store.add({
        id: 'pointer-i',
        kind: 'pointer',
        shapeIds: ['shape:pa', 'shape:pl'],
        props: { label: 'i', array: 'array-a', index: 1 },
      })
      const updated = () => editor.updateShapes.mock.calls[0][0] as { id: string; x: number; props: Record<string, unknown>; meta: Record<string, unknown> }[]
      const byId = (id: string) => updated().find((u) => u.id === id)!
      return { editor: editor as unknown as Editor, store, byId }
    }
    const label = (u: { props: Record<string, unknown> }) => JSON.stringify(u.props.richText)

    it('swap relabels the two cells and keeps the highlight on its cell', () => {
      const { editor, store, byId } = setup()
      executeCanvasCommand(editor, store, { type: 'swap', target: 'array-a', i: 0, j: 1 })

      expect(label(byId('shape:c0'))).toContain('"2"')
      expect(label(byId('shape:c1'))).toContain('"5"')
      expect(byId('shape:c1').props).not.toHaveProperty('fill') // highlight styling untouched
      expect(store.get('array-a')?.props).toEqual({ values: [2, 5], highlight: 1 })
      expect(byId('shape:c1').meta.props).toEqual({ values: [2, 5], highlight: 1 })
    })

    it('set_value widens every cell, and index labels and pointers follow', () => {
      const { editor, store, byId } = setup()
      executeCanvasCommand(editor, store, { type: 'set_value', target: 'array-a', index: 0, value: 123456 })

      const w = arrayCellWidth([123456, 2])
      expect(w).toBeGreaterThan(ARRAY_CELL_SIZE)
      expect(byId('shape:c0')).toMatchObject({ x: 100, props: { w } })
      expect(byId('shape:c1')).toMatchObject({ x: 100 + w, props: { w } })
      expect(byId('shape:l1')).toMatchObject({ x: 100 + w, props: { w } })
      const { tail } = pointerGeometry({ x: 100 + w, y: 100, w, h: ARRAY_CELL_SIZE })
      expect(byId('shape:pa')).toMatchObject({ x: tail.x, y: tail.y })
      expect(store.get('array-a')?.props.values).toEqual([123456, 2])
    })
  })

  it('deletes an array together with the pointers on it', () => {
    const editor = { deleteShapes: vi.fn() }
    const store = new SemanticStore()
    store.add({ id: 'array-a', kind: 'array', shapeIds: ['shape:c0'], props: { values: [1] } })
    store.add({ id: 'array-b', kind: 'array', shapeIds: ['shape:b0'], props: { values: [2] } })
    store.add({ id: 'pointer-i', kind: 'pointer', shapeIds: ['shape:pa'], props: { array: 'array-a' } })
    store.add({ id: 'pointer-j', kind: 'pointer', shapeIds: ['shape:pb'], props: { array: 'array-b' } })

    executeCanvasCommand(editor as unknown as Editor, store, { type: 'delete', target: 'array-a' })

    expect(editor.deleteShapes).toHaveBeenCalledWith(['shape:c0', 'shape:pa'])
    expect(store.list().map((o) => o.id)).toEqual(['array-b', 'pointer-j'])
  })

  it('throws on an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(() => executeCanvasCommand({} as Editor, new SemanticStore(), unknown)).toThrow(
      'Unhandled canvas command type: not_a_command',
    )
  })
})

describe('runCommands', () => {
  // Enough editor for text commands, plus the history calls runCommands makes.
  function setup() {
    const editor = {
      markHistoryStoppingPoint: vi.fn(() => 'mark-1'),
      bailToMark: vi.fn(),
      run: (fn: () => void) => fn(),
      createShape: vi.fn(),
      deleteShapes: vi.fn(),
      getCurrentPageShapes: () => [],
      getShapePageBounds: () => undefined,
    }
    return { editor, store: new SemanticStore() }
  }

  it('skips no-op commands instead of executing them', () => {
    const { editor, store } = setup()
    store.add({ id: 'pointer-i', kind: 'pointer', shapeIds: [], props: { array: 'array-a', index: 0 } })

    const result = runCommands(editor as unknown as Editor, store, [
      { type: 'move_pointer', target: 'pointer-i', index: 0 },
    ])

    // Nothing to validate or execute, so no failure from the missing array.
    expect(result).toEqual({ ok: true })
  })

  it('runs a batch where later commands depend on earlier ones', () => {
    const { editor, store } = setup()

    const result = runCommands(editor as unknown as Editor, store, [
      { type: 'create_text', id: 'a', text: 'A' },
      { type: 'create_text', id: 'b', text: 'B' },
      { type: 'delete', target: 'a' },
    ])

    expect(result).toEqual({ ok: true })
    expect(editor.markHistoryStoppingPoint).toHaveBeenCalledTimes(1)
    expect(editor.bailToMark).not.toHaveBeenCalled()
    expect(store.list().map((o) => o.id)).toEqual(['b'])
  })

  it('rolls back the whole batch when one command is rejected', () => {
    const { editor, store } = setup()

    const result = runCommands(editor as unknown as Editor, store, [
      { type: 'create_text', id: 'a', text: 'A' },
      { type: 'create_text', id: 'a', text: 'Again' },
    ])

    expect(result).toEqual({ ok: false, index: 1, reason: 'Object already exists: a' })
    expect(editor.bailToMark).toHaveBeenCalledWith('mark-1')
    // Rebuilt from the (rolled back, here empty) canvas.
    expect(store.list()).toEqual([])
  })
})
