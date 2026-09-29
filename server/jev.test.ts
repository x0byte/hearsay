import { describe, expect, it } from 'vitest'
import type { SemanticObject } from '../src/canvas/semanticStore.ts'
import type { InterpretRequest } from '../src/interpret/protocol.ts'
import {
  buildJevBody,
  MAX_INDEX_OPTIONS,
  arrayValues,
  MAX_RANGE_VALUES,
  newValue,
  pointerLabel,
  routeJev,
  type ChoiceAnswer,
  type JevAnswers,
} from './jev.ts'

const arrayA: SemanticObject = { id: 'array-a', kind: 'array', shapeIds: [], props: { values: [5, 2, 8, 1] } }
const pointerI: SemanticObject = {
  id: 'pointer-i',
  kind: 'pointer',
  shapeIds: [],
  props: { label: 'i', array: 'array-a', index: 0 },
}
const request = (newest: string, objects = [arrayA, pointerI]): InterpretRequest => ({
  segments: [{ text: newest, at: 0 }],
  objects,
})
const choice = (value: string, confidence = 0.95): ChoiceAnswer => ({ type: 'choice', choice: value, confidence })
const sure = (answers: Omit<JevAnswers, 'change'>): JevAnswers => ({ change: { type: 'noul', noul: 0.95 }, ...answers })
const thresholds = { gate: 0.5, confidence: 0.8 }

describe('buildJevBody', () => {
  it('lists board objects as targets and caps index options at 20 cells', () => {
    const long: SemanticObject = { ...arrayA, props: { values: Array.from({ length: 25 }, (_, i) => i) } }
    const body = buildJevBody({
      segments: [{ text: 'earlier line', at: 0 }, { text: 'newest line', at: 5 }],
      objects: [long, pointerI],
    })
    expect(Object.keys(body.questions.target.criteria)).toEqual(['array-a', 'pointer-i', 'none'])
    expect(Object.keys(body.questions.index.criteria)).toHaveLength(MAX_INDEX_OPTIONS + 1)
    expect(body.state.transcript).toEqual({ earlier: ['earlier line'], newest: 'newest line' })
  })
})

describe('value extraction', () => {
  it.each([
    ["let's make an array with 3, 1, 4, 1, 5", [3, 1, 4, 1, 5]],
    ['draw the array 9 7 2', [9, 7, 2]],
    ['values -1200 and 5', [-1200, 5]],
    ['create an array with numbers from 1 to 5', [1, 2, 3, 4, 5]],
    ['an array of 1 through 8', [1, 2, 3, 4, 5, 6, 7, 8]],
    ['count down from 5 to 1', [5, 4, 3, 2, 1]],
    ['an array from one to five', [1, 2, 3, 4, 5]],
    ['an array of three, one and four', [3, 1, 4]],
    // Left to Gemma: nothing to extract, or numbers the array wouldn't use.
    ['draw an array of words', undefined],
    ['an array with five random numbers', undefined],
    ['an array of 4 values', undefined],
    ['make an array 6, 3, 9, 1 and point i at the 9', undefined],
    ['an array from 1 to 5 with i on 2', undefined],
    ['an array from 1 to 1000', undefined],
  ])('arrayValues(%j)', (text, expected) => {
    expect(arrayValues(text)).toEqual(expected)
  })

  it('caps ranges at MAX_RANGE_VALUES', () => {
    expect(arrayValues(`from 1 to ${MAX_RANGE_VALUES}`)).toHaveLength(MAX_RANGE_VALUES)
    expect(arrayValues(`from 1 to ${MAX_RANGE_VALUES + 1}`)).toBeUndefined()
  })

  it.each([
    ['change the 8 to 10', 10],
    ['replace the 2 with a 7', 7],
    ['make the last element zero', 0],
    ['change the b to a z', undefined],
  ])('newValue(%j)', (text, expected) => {
    expect(newValue(text)).toBe(expected)
  })

  it.each([
    ['put a pointer i on the first element', 'i'],
    ["the j pointer isn't needed", 'j'],
    ['put j at the end', 'j'],
    ['add a pointer called mid on cell 2', 'mid'],
    ['move it over one', undefined],
  ])('pointerLabel(%j)', (text, expected) => {
    expect(pointerLabel(text)).toBe(expected)
  })
})

describe('routeJev', () => {
  it('does nothing below the gate, whatever the other answers say', () => {
    const answers = { change: { type: 'noul' as const, noul: 0.2 }, command: choice('swap') }
    expect(routeJev(answers, request('so they are out of order'), thresholds)).toEqual({ kind: 'none' })
  })

  it('builds a confident, valid command', () => {
    const answers = sure({ command: choice('move_pointer'), target: choice('pointer-i'), index: choice('1') })
    expect(routeJev(answers, request('move it over one'), thresholds)).toEqual({
      kind: 'command',
      command: { type: 'move_pointer', target: 'pointer-i', index: 1 },
    })
  })

  it('assigns IDs and extracts literals for create commands', () => {
    const create = sure({ command: choice('create_array') })
    expect(routeJev(create, request('draw the array 9 7 2'), thresholds)).toEqual({
      kind: 'command',
      command: { type: 'create_array', id: 'array-b', values: [9, 7, 2] },
    })
    const pointer = sure({ command: choice('create_pointer'), target: choice('array-a'), index: choice('3') })
    expect(routeJev(pointer, request('put j at the end'), thresholds)).toEqual({
      kind: 'command',
      command: { type: 'create_pointer', id: 'pointer-j', label: 'j', array: 'array-a', index: 3 },
    })
  })

  it('maps a pointer target to its array for swap and set_value', () => {
    const answers = sure({ command: choice('swap'), target: choice('pointer-i'), index: choice('0'), index2: choice('3') })
    expect(routeJev(answers, request('swap the values at i and j'), thresholds)).toEqual({
      kind: 'command',
      command: { type: 'swap', target: 'array-a', i: 0, j: 3 },
    })
  })

  it.each<[string, JevAnswers, string]>([
    ['a needed answer is not confident', sure({ command: choice('move_pointer'), target: choice('pointer-i', 0.6), index: choice('1') }), 'move it over one'],
    ['the command is several changes', sure({ command: choice('several') }), 'draw 1 2 and point i at 1'],
    ['text is left to Gemma', sure({ command: choice('create_text') }), "write 'hi'"],
    ['no literal value can be extracted', sure({ command: choice('create_array') }), 'an array of words'],
    ['the command fails validation', sure({ command: choice('move_pointer'), target: choice('pointer-i'), index: choice('9') }), 'move i to 9'],
  ])('falls back when %s', (_label, answers, newest) => {
    expect(routeJev(answers, request(newest), thresholds).kind).toBe('fallback')
  })
})
