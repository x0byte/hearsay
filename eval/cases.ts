import type { CanvasCommand } from '../src/canvas/commands.ts'
import type { SemanticObject } from '../src/canvas/semanticStore.ts'

// Teaching sentences with the commands they should produce. `segments` is the
// transcript window, oldest first; the last one is the newest. Earlier
// segments are context whose changes are already on `board`.
// A string value of ANY in `expected` matches any string (e.g. wording of text).

export const ANY = '*'

export type EvalTag = 'explanation' | 'command' | 'multi' | 'context'

export type EvalCase = {
  name: string
  tag: EvalTag
  segments: string[]
  board: SemanticObject[]
  expected: CanvasCommand[]
}

const obj = (id: string, kind: SemanticObject['kind'], props: Record<string, unknown>): SemanticObject => ({
  id,
  kind,
  shapeIds: [],
  props,
})
const arrayA = obj('array-a', 'array', { values: [5, 2, 8, 1] })
const arrayB = obj('array-b', 'array', { values: [9, 7, 2] })
const pointerI = obj('pointer-i', 'pointer', { label: 'i', array: 'array-a', index: 0 })
const pointerJ = obj('pointer-j', 'pointer', { label: 'j', array: 'array-a', index: 3 })

const EMPTY: SemanticObject[] = []
const ARR = [arrayA]
const ARR_I = [arrayA, pointerI]
const ARR_IJ = [arrayA, pointerI, pointerJ]
const TWO_ARR = [arrayA, arrayB]

const explain = (name: string, text: string, board: SemanticObject[]): EvalCase => ({
  name,
  tag: 'explanation',
  segments: [text],
  board,
  expected: [],
})

export const cases: EvalCase[] = [
  // Plain explanation: should produce no commands.
  explain('explain-idea', 'so the idea behind this algorithm is pretty simple', ARR),
  explain('explain-neighbours', 'bubble sort repeatedly compares neighbouring elements', ARR),
  explain('explain-complexity', 'the time complexity here is O of n squared', ARR_I),
  explain('explain-why-left', 'you might wonder why we start from the left', ARR_I),
  explain('explain-confused', 'this is where most students get confused', EMPTY),
  explain('explain-zero-indexed', 'remember that arrays are zero indexed', ARR),
  explain('explain-in-order', 'if the two values are already in order we just leave them', ARR_IJ),
  explain('explain-binary-search', 'binary search only works on sorted input', ARR),
  explain('explain-check-in', 'okay, does that make sense so far?', ARR_I),
  explain('explain-until-done', 'we keep doing this until nothing changes', ARR_I),
  explain('explain-what-is-array', 'an array is just a row of values stored next to each other', EMPTY),
  explain('explain-what-is-i', "the pointer i tells us which element we're looking at", ARR_I),
  explain('explain-worst-case', 'in the worst case every element has to move', ARR),
  explain('explain-thinking', 'let me think about how to explain this', ARR),
  explain('explain-out-of-order', "so eight is bigger than two, which means they're out of order", ARR_IJ),
  explain('explain-later', "I'll draw that in a second, but first some background", EMPTY),

  // Single explicit commands.
  {
    name: 'create-array',
    tag: 'command',
    segments: ["let's make an array with 3, 1, 4, 1, 5"],
    board: EMPTY,
    expected: [{ type: 'create_array', id: 'array-a', values: [3, 1, 4, 1, 5] }],
  },
  {
    name: 'create-second-array',
    tag: 'command',
    segments: ['draw the array 9 7 2'],
    board: ARR,
    expected: [{ type: 'create_array', id: 'array-b', values: [9, 7, 2] }],
  },
  {
    name: 'create-pointer-first',
    tag: 'command',
    segments: ['put a pointer i on the first element'],
    board: ARR,
    expected: [{ type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 }],
  },
  {
    name: 'create-pointer-end',
    tag: 'command',
    segments: ['put j at the end'],
    board: ARR_I,
    expected: [{ type: 'create_pointer', id: 'pointer-j', label: 'j', array: 'array-a', index: 3 }],
  },
  {
    name: 'move-pointer-absolute',
    tag: 'command',
    segments: ['move i to index 2'],
    board: ARR_I,
    expected: [{ type: 'move_pointer', target: 'pointer-i', index: 2 }],
  },
  {
    name: 'move-it-over-one',
    tag: 'command',
    segments: ['move it over one'],
    board: ARR_I,
    expected: [{ type: 'move_pointer', target: 'pointer-i', index: 1 }],
  },
  {
    name: 'move-j-left',
    tag: 'command',
    segments: ['move j one to the left'],
    board: ARR_IJ,
    expected: [{ type: 'move_pointer', target: 'pointer-j', index: 2 }],
  },
  {
    name: 'move-i-to-last',
    tag: 'command',
    segments: ['move i to the last element'],
    board: ARR_I,
    expected: [{ type: 'move_pointer', target: 'pointer-i', index: 3 }],
  },
  {
    name: 'highlight-by-value',
    tag: 'command',
    segments: ['highlight the eight'],
    board: ARR,
    expected: [{ type: 'highlight', target: 'array-a', index: 2 }],
  },
  {
    name: 'highlight-whole-array',
    tag: 'command',
    segments: ['highlight the whole array'],
    board: ARR,
    expected: [{ type: 'highlight', target: 'array-a' }],
  },
  {
    name: 'highlight-by-index',
    tag: 'command',
    segments: ['highlight index 1'],
    board: ARR,
    expected: [{ type: 'highlight', target: 'array-a', index: 1 }],
  },
  {
    name: 'highlight-in-second-array',
    tag: 'command',
    segments: ['highlight the two in the second array'],
    board: TWO_ARR,
    expected: [{ type: 'highlight', target: 'array-b', index: 2 }],
  },
  {
    name: 'delete-pointer',
    tag: 'command',
    segments: ['delete the pointer j'],
    board: ARR_IJ,
    expected: [{ type: 'delete', target: 'pointer-j' }],
  },
  {
    name: 'delete-that-array',
    tag: 'command',
    segments: ['clear that array'],
    board: ARR_I,
    expected: [{ type: 'delete', target: 'array-a' }],
  },
  {
    name: 'delete-second-array',
    tag: 'command',
    segments: ['get rid of the second array'],
    board: TWO_ARR,
    expected: [{ type: 'delete', target: 'array-b' }],
  },
  {
    name: 'create-title',
    tag: 'command',
    segments: ["write 'Bubble sort' as a title"],
    board: EMPTY,
    expected: [{ type: 'create_text', id: 'text-1', text: ANY }],
  },

  // Several commands in one sentence, referring to what was just created.
  {
    name: 'multi-array-and-pointer',
    tag: 'multi',
    segments: ['make an array 6, 3, 9, 1 and point i at the 9'],
    board: EMPTY,
    expected: [
      { type: 'create_array', id: 'array-a', values: [6, 3, 9, 1] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 2 },
    ],
  },
  {
    name: 'multi-second-array-and-pointer',
    tag: 'multi',
    segments: ['here is a second array 9, 7, 2 and put a pointer j on its last element'],
    board: ARR_I,
    expected: [
      { type: 'create_array', id: 'array-b', values: [9, 7, 2] },
      { type: 'create_pointer', id: 'pointer-j', label: 'j', array: 'array-b', index: 2 },
    ],
  },

  // The newest line only makes sense with earlier context.
  {
    name: 'context-pointer-after-array',
    tag: 'context',
    segments: ["let's make an array with 5, 2, 8, 1", 'now put i on the first one'],
    board: ARR,
    expected: [{ type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 }],
  },
  {
    name: 'context-move-it',
    tag: 'context',
    segments: ['we compare i with the next element', 'okay, move it along'],
    board: ARR_IJ,
    expected: [{ type: 'move_pointer', target: 'pointer-i', index: 1 }],
  },
  {
    name: 'context-its-first-cell',
    tag: 'context',
    segments: ['look at the second array', 'highlight its first cell'],
    board: TWO_ARR,
    expected: [{ type: 'highlight', target: 'array-b', index: 0 }],
  },
  {
    name: 'context-remove-it',
    tag: 'context',
    segments: ["the j pointer isn't needed anymore", 'so remove it'],
    board: ARR_IJ,
    expected: [{ type: 'delete', target: 'pointer-j' }],
  },
  {
    name: 'context-highlight-that',
    tag: 'context',
    segments: ["let's focus on the value 8", 'highlight that'],
    board: ARR,
    expected: [{ type: 'highlight', target: 'array-a', index: 2 }],
  },
  {
    name: 'context-no-repeat',
    tag: 'explanation',
    segments: ['draw the array 3, 1, 2', "this is the input we'll sort"],
    board: [obj('array-a', 'array', { values: [3, 1, 2] })],
    expected: [],
  },
]
