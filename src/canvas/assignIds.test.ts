import { describe, expect, it } from 'vitest'
import { assignIds, type DraftCommand } from './assignIds'

describe('assignIds', () => {
  it('gives each kind the next free ID, skipping IDs already on the board', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [1] },
      { type: 'create_array', values: [2] },
      { type: 'create_text', text: 'hi' },
      { type: 'create_pointer', label: 'i', array: 'array-a', index: 0 },
    ]
    expect(assignIds(drafts, ['array-a', 'text-1'])?.map((c) => 'id' in c && c.id)).toEqual([
      'array-b',
      'array-c',
      'text-2',
      'pointer-i',
    ])
  })

  it('names pointers after their label and numbers repeats', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_pointer', label: 'i', array: 'array-a', index: 0 },
      { type: 'create_pointer', label: 'Left End', array: 'array-a', index: 0 },
      { type: 'create_pointer', label: '??', array: 'array-a', index: 0 },
    ]
    expect(assignIds(drafts, ['pointer-i'])?.map((c) => 'id' in c && c.id)).toEqual([
      'pointer-i-2',
      'pointer-left-end',
      'pointer-p',
    ])
  })

  it('resolves "new" to the object created most recently in the batch', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [3, 1, 4] },
      { type: 'create_pointer', label: 'i', array: 'new', index: 0 },
      { type: 'highlight', target: 'new' },
    ]
    expect(assignIds(drafts, [])).toEqual([
      { type: 'create_array', id: 'array-a', values: [3, 1, 4] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 },
      { type: 'highlight', target: 'pointer-i' },
    ])
  })

  it('expands a compound create into the array and its pointers', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [2, 4, 6, 8], pointers: [{ label: 'lo', index: 0 }, { label: 'hi', index: 3 }] },
    ]
    expect(assignIds(drafts, [])).toEqual([
      { type: 'create_array', id: 'array-a', values: [2, 4, 6, 8] },
      { type: 'create_pointer', id: 'pointer-lo', label: 'lo', array: 'array-a', index: 0 },
      { type: 'create_pointer', id: 'pointer-hi', label: 'hi', array: 'array-a', index: 3 },
    ])
  })

  it('makes "new" mean the array after a compound create, not its last pointer', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [7, 3, 5], pointers: [{ label: 'i', index: 0 }] },
      { type: 'highlight', target: 'new', index: 1 },
    ]
    expect(assignIds(drafts, [])?.at(-1)).toEqual({ type: 'highlight', target: 'array-a', index: 1 })
  })

  it('expands a compound highlight after the pointers, as a cell or the whole array', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [4, 2, 7], pointers: [{ label: 'i', index: 0 }], highlight: 2 },
      { type: 'create_array', values: [1, 2], highlight: 'all' },
    ]
    expect(assignIds(drafts, [])).toEqual([
      { type: 'create_array', id: 'array-a', values: [4, 2, 7] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 },
      { type: 'highlight', target: 'array-a', index: 2 },
      { type: 'create_array', id: 'array-b', values: [1, 2] },
      { type: 'highlight', target: 'array-b' },
    ])
  })

  it('numbers compound pointers around IDs already on the board', () => {
    const drafts: DraftCommand[] = [{ type: 'create_array', values: [1], pointers: [{ label: 'i', index: 0 }] }]
    expect(assignIds(drafts, ['array-a', 'pointer-i'])?.map((c) => 'id' in c && c.id)).toEqual(['array-b', 'pointer-i-2'])
  })

  it('leaves existing references alone', () => {
    const drafts: DraftCommand[] = [{ type: 'move_pointer', target: 'pointer-i', index: 2 }]
    expect(assignIds(drafts, ['pointer-i'])).toEqual(drafts)
  })

  it('fails when "new" has nothing to refer to', () => {
    expect(assignIds([{ type: 'delete', target: 'new' }], ['array-a'])).toBeUndefined()
    expect(
      assignIds([{ type: 'create_pointer', label: 'i', array: 'new', index: 0 }], []),
    ).toBeUndefined()
  })
})
