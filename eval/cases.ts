import type { CanvasCommand } from '../src/canvas/commands.ts'
import type { SemanticObject } from '../src/canvas/semanticStore.ts'

// Teaching sentences with the commands they should produce. `segments` is the
// transcript window, oldest first; the last one is the newest. Earlier
// segments are context whose changes are already on `board`.
// A string value of ANY in `expected` matches any string (e.g. wording of text).

export const ANY = '*'

// 'holdout' cases were written after prompt tuning stopped and are never used
// to tune it; they are reported separately.
export type EvalTag = 'explanation' | 'command' | 'multi' | 'context' | 'holdout'

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

  // Changing values: swap and set_value.
  {
    name: 'swap-explicit',
    tag: 'command',
    segments: ['swap the first two elements'],
    board: ARR,
    expected: [{ type: 'swap', target: 'array-a', i: 0, j: 1 }],
  },
  {
    name: 'swap-implied',
    tag: 'command',
    segments: ['4 is bigger than 1, so they trade places'],
    board: [obj('array-a', 'array', { values: [3, 4, 1, 5] })],
    expected: [{ type: 'swap', target: 'array-a', i: 1, j: 2 }],
  },
  {
    name: 'swap-at-pointers',
    tag: 'command',
    segments: ['swap the values at i and j'],
    board: ARR_IJ,
    expected: [{ type: 'swap', target: 'array-a', i: 0, j: 3 }],
  },
  {
    name: 'set-value',
    tag: 'command',
    segments: ['change the 8 to 10'],
    board: ARR,
    expected: [{ type: 'set_value', target: 'array-a', index: 2, value: 10 }],
  },
  explain('explain-swapping', 'swapping is how bubble sort makes progress', ARR),

  // Ranges: the values are spelled as a range, not listed.
  {
    name: 'create-array-range',
    tag: 'command',
    segments: ['create an array with numbers from 1 to 5'],
    board: EMPTY,
    expected: [{ type: 'create_array', id: 'array-a', values: [1, 2, 3, 4, 5] }],
  },
  {
    name: 'create-array-range-through',
    tag: 'command',
    segments: ['draw an array of 1 through 8'],
    board: ARR,
    expected: [{ type: 'create_array', id: 'array-b', values: [1, 2, 3, 4, 5, 6, 7, 8] }],
  },
  {
    name: 'create-array-range-down',
    tag: 'command',
    segments: ['make an array counting down from 5 to 1'],
    board: EMPTY,
    expected: [{ type: 'create_array', id: 'array-a', values: [5, 4, 3, 2, 1] }],
  },
  explain('explain-range-indices', 'the indices go from 0 to 3 here', ARR),
  explain('explain-range-values', 'an array like this could hold anything from 1 to 100', ARR),

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

  // Held out: frozen (see the hash test in score.test.ts) and never used for
  // tuning. 25 cases, 40% explanation-only.
  ...[
    ['holdout-explain-two-pointers', 'the reason we use two pointers is to avoid checking every pair', ARR_IJ],
    ['holdout-explain-bubbles', 'notice how the largest value bubbles to the end after each pass', ARR],
    ['holdout-explain-what-is-index', 'an index is just the position of a value in the array', ARR],
    ['holdout-explain-edge-cases', "let's pause and think about the edge cases", ARR_I],
    ['holdout-explain-sorted-faster', 'a sorted array makes searching much faster', EMPTY],
    ['holdout-explain-i-starts-at-zero', 'the loop variable i starts at zero', ARR_I],
    ['holdout-explain-merge-sort', "you'll see this pattern again in merge sort", ARR],
    ['holdout-explain-swap-cost', 'a swap costs three assignments if you use a temporary variable', ARR],
    ['holdout-explain-swap-condition', 'we only swap when the left value is bigger', ARR_IJ],
    ['holdout-explain-fewer-swaps', 'selection sort does far fewer swaps than bubble sort', ARR],
  ].map(([name, text, board]): EvalCase => ({
    name: name as string,
    tag: 'holdout',
    segments: [text as string],
    board: board as SemanticObject[],
    expected: [],
  })),
  {
    name: 'holdout-multi-lo-hi',
    tag: 'holdout',
    segments: ['draw an array 2, 4, 6, 8 and put a pointer lo on the first and hi on the last'],
    board: EMPTY,
    expected: [
      { type: 'create_array', id: 'array-a', values: [2, 4, 6, 8] },
      { type: 'create_pointer', id: 'pointer-lo', label: 'lo', array: 'array-a', index: 0 },
      { type: 'create_pointer', id: 'pointer-hi', label: 'hi', array: 'array-a', index: 3 },
    ],
  },
  {
    name: 'holdout-multi-highlight-middle',
    tag: 'holdout',
    segments: ['make the array 7, 3, 5 and highlight the middle one'],
    board: EMPTY,
    expected: [
      { type: 'create_array', id: 'array-a', values: [7, 3, 5] },
      { type: 'highlight', target: 'array-a', index: 1 },
    ],
  },
  {
    name: 'holdout-shift-j-to-start',
    tag: 'holdout',
    segments: ['shift j back to the start'],
    board: ARR_IJ,
    expected: [{ type: 'move_pointer', target: 'pointer-j', index: 0 }],
  },
  {
    name: 'holdout-swap-ends',
    tag: 'holdout',
    segments: ['exchange the first and last values'],
    board: ARR,
    expected: [{ type: 'swap', target: 'array-a', i: 0, j: 3 }],
  },
  {
    name: 'holdout-swap-implied-switch',
    tag: 'holdout',
    segments: ['since 5 is larger than 2 they need to switch'],
    board: ARR,
    expected: [{ type: 'swap', target: 'array-a', i: 0, j: 1 }],
  },
  {
    name: 'holdout-swap-i-with-next',
    tag: 'holdout',
    segments: ['swap i with the element right after it'],
    board: ARR_I,
    expected: [{ type: 'swap', target: 'array-a', i: 0, j: 1 }],
  },
  {
    name: 'holdout-context-those-two-swap',
    tag: 'holdout',
    segments: ['look at the 8 and the 1 at the end', 'those two should swap'],
    board: ARR,
    expected: [{ type: 'swap', target: 'array-a', i: 2, j: 3 }],
  },
  {
    name: 'holdout-set-value-replace',
    tag: 'holdout',
    segments: ['replace the 2 with a 7'],
    board: ARR,
    expected: [{ type: 'set_value', target: 'array-a', index: 1, value: 7 }],
  },
  {
    name: 'holdout-set-value-last-zero',
    tag: 'holdout',
    segments: ['make the last element zero'],
    board: ARR,
    expected: [{ type: 'set_value', target: 'array-a', index: 3, value: 0 }],
  },
  {
    name: 'holdout-set-value-letter',
    tag: 'holdout',
    segments: ['change the b to a z'],
    board: [obj('array-a', 'array', { values: ['a', 'b', 'c'] })],
    expected: [{ type: 'set_value', target: 'array-a', index: 1, value: 'z' }],
  },
  {
    name: 'holdout-advance-i-by-two',
    tag: 'holdout',
    segments: ['advance i by two'],
    board: ARR_I,
    expected: [{ type: 'move_pointer', target: 'pointer-i', index: 2 }],
  },
  {
    name: 'holdout-highlight-smallest',
    tag: 'holdout',
    segments: ['highlight the smallest number'],
    board: ARR,
    expected: [{ type: 'highlight', target: 'array-a', index: 3 }],
  },
  {
    name: 'holdout-unhighlight',
    tag: 'holdout',
    segments: ['unhighlight the array'],
    board: [obj('array-a', 'array', { values: [5, 2, 8, 1], highlight: 2 })],
    expected: [{ type: 'clear_highlight', target: 'array-a' }],
  },
  {
    name: 'holdout-word-array',
    tag: 'holdout',
    segments: ['put up an array of the words cat, dog, emu'],
    board: EMPTY,
    expected: [{ type: 'create_array', id: 'array-a', values: ['cat', 'dog', 'emu'] }],
  },
  {
    name: 'holdout-remove-i-pointer',
    tag: 'holdout',
    segments: ['remove the i pointer'],
    board: ARR_IJ,
    expected: [{ type: 'delete', target: 'pointer-i' }],
  },
]
