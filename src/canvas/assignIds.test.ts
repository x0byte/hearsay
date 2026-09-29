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
