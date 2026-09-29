import { describe, expect, it } from 'vitest'
import type { CanvasCommand } from './commands'
import { dropNoOps } from './dropNoOps'
import type { SemanticObject } from './semanticStore'

const board: SemanticObject[] = [
  { id: 'array-a', kind: 'array', shapeIds: [], props: { values: [5, 2, 8], highlight: 1 } },
  { id: 'array-b', kind: 'array', shapeIds: [], props: { values: [9] } },
  { id: 'pointer-i', kind: 'pointer', shapeIds: [], props: { label: 'i', array: 'array-a', index: 0 } },
]

describe('dropNoOps', () => {
  it.each<[string, CanvasCommand]>([
    ['moving a pointer to its current index', { type: 'move_pointer', target: 'pointer-i', index: 0 }],
    ['repeating the exact current cell highlight', { type: 'highlight', target: 'array-a', index: 1 }],
    ['clearing a highlight that is not there', { type: 'clear_highlight', target: 'array-b' }],
  ])('drops %s', (_label, command) => {
    expect(dropNoOps([command], board)).toEqual({ commands: [], dropped: [command] })
  })

  it.each<[string, CanvasCommand]>([
    ['moving a pointer somewhere else', { type: 'move_pointer', target: 'pointer-i', index: 2 }],
    ['highlighting a different cell', { type: 'highlight', target: 'array-a', index: 2 }],
    ['highlighting the whole object when one cell is highlighted', { type: 'highlight', target: 'array-a' }],
    ['clearing an existing highlight', { type: 'clear_highlight', target: 'array-a' }],
    ['a command on an unknown object (left to the validator)', { type: 'move_pointer', target: 'nope', index: 0 }],
  ])('keeps %s', (_label, command) => {
    expect(dropNoOps([command], board)).toEqual({ commands: [command], dropped: [] })
  })

  it('judges each command against the board as earlier commands leave it', () => {
    const commands: CanvasCommand[] = [
      { type: 'move_pointer', target: 'pointer-i', index: 2 },
      { type: 'move_pointer', target: 'pointer-i', index: 2 }, // now a no-op
      { type: 'move_pointer', target: 'pointer-i', index: 0 }, // real move back
      { type: 'clear_highlight', target: 'array-a' },
      { type: 'clear_highlight', target: 'array-a' }, // already cleared
    ]
    expect(dropNoOps(commands, board)).toEqual({
      commands: [commands[0], commands[2], commands[3]],
      dropped: [commands[1], commands[4]],
    })
  })

  it('tracks objects created in the same batch', () => {
    const commands: CanvasCommand[] = [
      { type: 'create_pointer', id: 'pointer-j', label: 'j', array: 'array-a', index: 1 },
      { type: 'move_pointer', target: 'pointer-j', index: 1 },
    ]
    expect(dropNoOps(commands, board).dropped).toEqual([commands[1]])
  })

  it('does not change the board it is given', () => {
    dropNoOps([{ type: 'move_pointer', target: 'pointer-i', index: 2 }], board)
    expect(board[2].props.index).toBe(0)
  })
})
