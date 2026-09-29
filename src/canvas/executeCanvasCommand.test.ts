import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import type { CanvasCommand } from './commands'
import { executeCanvasCommand } from './executeCanvasCommand'
import { GAP, MARGIN } from './layout'
import { SemanticStore } from './semanticStore'

// Bounds of shapes already on the page; enough for the layout path.
function fakeEditor(existingBounds: { x: number; y: number; w: number; h: number }[] = []) {
  return {
    createShape: vi.fn(),
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

  it('throws on an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(() => executeCanvasCommand({} as Editor, new SemanticStore(), unknown)).toThrow(
      'Unhandled canvas command type: not_a_command',
    )
  })
})
