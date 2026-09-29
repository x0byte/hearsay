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

  it('resolves "$N" to the ID assigned to command N of the batch', () => {
    const drafts: DraftCommand[] = [
      { type: 'create_array', values: [3, 1, 4] },
      { type: 'create_array', values: [9, 7] },
      { type: 'create_pointer', label: 'i', array: '$0', index: 0 },
      { type: 'create_pointer', label: 'j', array: '$1', index: 1 },
      { type: 'highlight', target: '$0', index: 2 },
    ]
    expect(assignIds(drafts, [])).toEqual([
      { type: 'create_array', id: 'array-a', values: [3, 1, 4] },
      { type: 'create_array', id: 'array-b', values: [9, 7] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 },
      { type: 'create_pointer', id: 'pointer-j', label: 'j', array: 'array-b', index: 1 },
      { type: 'highlight', target: 'array-a', index: 2 },
    ])
  })

  it('leaves existing references alone', () => {
    const drafts: DraftCommand[] = [{ type: 'move_pointer', target: 'pointer-i', index: 2 }]
    expect(assignIds(drafts, ['pointer-i'])).toEqual(drafts)
  })

  it.each([
    ['refers past the end', [{ type: 'delete', target: '$0' }]],
    ['refers forward', [{ type: 'create_pointer', label: 'i', array: '$1', index: 0 }, { type: 'create_array', values: [1] }]],
    ['refers to itself', [{ type: 'create_pointer', label: 'i', array: '$0', index: 0 }]],
    ['refers to a non-create command', [{ type: 'delete', target: 'array-a' }, { type: 'highlight', target: '$0' }]],
    ['is not a number', [{ type: 'create_array', values: [1] }, { type: 'delete', target: '$a' }]],
  ] as [string, DraftCommand[]][])('rejects the batch when a placeholder %s', (_label, drafts) => {
    expect(assignIds(drafts, ['array-a'])).toBeUndefined()
  })
})
