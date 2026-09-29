import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import type { CanvasCommand } from './commands'
import { executeCanvasCommand } from './executeCanvasCommand'
import { SemanticStore } from './semanticStore'

function fakeEditor() {
  return { createShape: vi.fn() }
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
    expect(shape).toMatchObject({ type: 'text', x: 10, y: 20 })
    expect(store.get('hello')).toEqual({
      id: 'hello',
      kind: 'text',
      shapeIds: [shape.id],
      props: { text: 'Hi' },
    })
  })

  it('throws on an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(() => executeCanvasCommand({} as Editor, new SemanticStore(), unknown)).toThrow(
      'Unhandled canvas command type: not_a_command',
    )
  })
})
