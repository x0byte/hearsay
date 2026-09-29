import { describe, expect, it } from 'vitest'
import type { CanvasCommand } from './commands'
import { SemanticStore } from './semanticStore'
import { validateCommand } from './validateCommand'

const createHello: CanvasCommand = { type: 'create_text', id: 'hello', text: 'Hi', x: 0, y: 0 }

describe('validateCommand', () => {
  it('accepts create_text with a new ID', () => {
    expect(validateCommand(createHello, new SemanticStore())).toEqual({ ok: true })
  })

  it('rejects create_text when the ID already exists', () => {
    const store = new SemanticStore()
    store.add({ id: 'hello', kind: 'text', shapeIds: ['shape:1'], props: {} })
    expect(validateCommand(createHello, store)).toEqual({
      ok: false,
      reason: 'Object already exists: hello',
    })
  })

  it('rejects create_array with no values', () => {
    const empty: CanvasCommand = { type: 'create_array', id: 'array-a', values: [] }
    expect(validateCommand(empty, new SemanticStore())).toEqual({
      ok: false,
      reason: 'Array has no values: array-a',
    })
  })

  it('rejects create_array when the ID already exists', () => {
    const store = new SemanticStore()
    store.add({ id: 'array-a', kind: 'array', shapeIds: [], props: {} })
    const create: CanvasCommand = { type: 'create_array', id: 'array-a', values: [1] }
    expect(validateCommand(create, store)).toEqual({
      ok: false,
      reason: 'Object already exists: array-a',
    })
  })

  it('rejects an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(validateCommand(unknown, new SemanticStore())).toEqual({
      ok: false,
      reason: 'Unknown command type: not_a_command',
    })
  })
})
