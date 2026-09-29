import { describe, expect, it, vi } from 'vitest'
import { commandTools, draftFromToolCall } from './commandTools.ts'
import type { SemanticObject } from '../src/canvas/semanticStore.ts'
import type { InterpretRequest } from '../src/interpret/protocol.ts'
import {
  DEFAULT_MODEL,
  interpret,
  interpretWithJev,
  MAX_SEGMENTS,
  parseInterpretRequest,
  resolveModelConfig,
  WINDOW_MS,
} from './interpret.ts'
import type { ChoiceAnswer, JevAnswers } from './jev.ts'
import type { ChatRequest, ToolCall } from './openrouter.ts'

const call = (name: string, args: unknown): ToolCall => ({
  id: `call-${name}`,
  type: 'function',
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
})

// A fake chat completion that replies with the given tool calls.
function fakeChat(toolCalls: ToolCall[] | undefined, finishReason = 'tool_calls') {
  return vi.fn(async (_request: ChatRequest, _signal?: AbortSignal) => ({
    choices: [{ finish_reason: finishReason, message: { content: null, tool_calls: toolCalls } }],
  }))
}

const request = {
  segments: [
    { text: 'We are going to sort some numbers.', at: 1_000 },
    { text: 'Let me draw the array 3 1 4 and put i at the start', at: 4_000 },
  ],
  objects: [{ id: 'hello', kind: 'text' as const, shapeIds: ['shape:1'], props: { text: 'Hi' } }],
}

describe('interpret', () => {
  it('turns valid tool calls into commands, in order, with IDs assigned in code', async () => {
    const chat = fakeChat([
      call('create_array', { values: [3, 1, 4] }),
      call('create_pointer', { label: 'i', array: 'new', index: 0 }),
    ])

    expect((await interpret(chat, request)).commands).toEqual([
      { type: 'create_array', id: 'array-a', values: [3, 1, 4] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 },
    ])
  })

  it('expands a compound create_array into the array and its pointers', async () => {
    const chat = fakeChat([call('create_array', { values: [2, 4, 6, 8], pointers: [{ label: 'lo', index: 0 }, { label: 'hi', index: 3 }] })])
    expect((await interpret(chat, request)).commands).toEqual([
      { type: 'create_array', id: 'array-a', values: [2, 4, 6, 8] },
      { type: 'create_pointer', id: 'pointer-lo', label: 'lo', array: 'array-a', index: 0 },
      { type: 'create_pointer', id: 'pointer-hi', label: 'hi', array: 'array-a', index: 3 },
    ])
  })

  it('returns no commands when "new" has nothing to refer to', async () => {
    const chat = fakeChat([call('highlight', { target: 'new' })])
    expect((await interpret(chat, request)).commands).toEqual([])
  })

  it('returns no-op commands separately instead of as commands', async () => {
    const withPointer = {
      ...request,
      objects: [{ id: 'pointer-i', kind: 'pointer' as const, shapeIds: [], props: { label: 'i', index: 0 } }],
    }
    const noOp = call('move_pointer', { target: 'pointer-i', index: 0 })
    expect(await interpret(fakeChat([noOp]), withPointer)).toEqual({
      commands: [],
      dropped: [{ type: 'move_pointer', target: 'pointer-i', index: 0 }],
    })
  })

  it('returns no commands when the model calls no tools', async () => {
    expect((await interpret(fakeChat(undefined, 'stop'), request)).commands).toEqual([])
  })

  it('returns no commands at all if any one call is malformed', async () => {
    const chat = fakeChat([
      call('create_array', { values: [3, 1, 4] }),
      call('create_pointer', { label: 'i', array: 'new', index: '0' }),
    ])
    expect((await interpret(chat, request)).commands).toEqual([])
  })

  it('sends the board, transcript, tools and pinned provider', async () => {
    const chat = fakeChat([], 'stop')
    await interpret(chat, request)

    const sent = chat.mock.calls[0][0]
    expect(sent.model).toBe(DEFAULT_MODEL)
    expect(sent.provider).toEqual({ order: ['deepinfra/fp8'], allow_fallbacks: false })
    expect(sent.max_tokens).toBe(256)
    expect(sent.tools).toBe(commandTools)
    expect(sent.messages[1].content).toContain('- hello (text): {"text":"Hi"}')
    expect(sent.messages[1].content).toContain(
      'earlier: We are going to sort some numbers.\nNEWEST: Let me draw the array 3 1 4 and put i at the start',
    )
  })

  it('passes the abort signal through to the chat call', async () => {
    const chat = fakeChat([], 'stop')
    const controller = new AbortController()
    await interpret(chat, request, undefined, controller.signal)
    expect(chat.mock.calls[0][1]).toBe(controller.signal)
  })

  it('throws on a cut-off reply', async () => {
    await expect(interpret(fakeChat([], 'length'), request)).rejects.toThrow('cut off')
  })
})

describe('draftFromToolCall', () => {
  it('accepts a call that matches its schema, including optional fields', () => {
    expect(draftFromToolCall(call('highlight', { target: 'array-a' }))).toEqual({
      type: 'highlight',
      target: 'array-a',
    })
    expect(draftFromToolCall(call('highlight', { target: 'array-a', index: 2 }))).toEqual({
      type: 'highlight',
      target: 'array-a',
      index: 2,
    })
    expect(draftFromToolCall(call('set_value', { target: 'array-a', index: 0, value: 'x' }))).toEqual({
      type: 'set_value',
      target: 'array-a',
      index: 0,
      value: 'x',
    })
    expect(draftFromToolCall(call('create_array', { values: [1, 'x'] }))).toEqual({
      type: 'create_array',
      values: [1, 'x'],
    })
  })

  it.each([
    ['unknown tool', call('draw_tree', { values: [1] })],
    ['model-supplied id', call('create_array', { id: 'array-z', values: [1] })],
    ['invalid JSON', call('delete', '{target:')],
    ['missing field', call('move_pointer', { target: 'pointer-i' })],
    ['extra field', call('delete', { target: 'a', x: 10 })],
    ['wrong type', call('move_pointer', { target: 'pointer-i', index: 1.5 })],
    ['empty string', call('delete', { target: '' })],
    ['bad array item', call('create_array', { values: [1, null] })],
    ['a set_value with a non-scalar value', call('set_value', { target: 'array-a', index: 0, value: [1] })],
    ['a compound pointer without an index', call('create_array', { values: [1], pointers: [{ label: 'i' }] })],
    ['a compound pointer with an extra field', call('create_array', { values: [1], pointers: [{ label: 'i', index: 0, color: 'red' }] })],
    ['not an object', call('delete', '["a"]')],
  ])('rejects %s', (_label, toolCall) => {
    expect(draftFromToolCall(toolCall)).toBeUndefined()
  })
})

describe('commandTools', () => {
  it('has one tool per command type and never asks for coordinates or new IDs', () => {
    expect(commandTools.map((t) => t.function.name)).toEqual([
      'create_text',
      'create_array',
      'highlight',
      'clear_highlight',
      'create_pointer',
      'move_pointer',
      'swap',
      'set_value',
      'delete',
    ])
    for (const t of commandTools) {
      const properties = Object.keys(t.function.parameters.properties ?? {})
      expect(properties).not.toContain('x')
      expect(properties).not.toContain('y')
      expect(properties).not.toContain('id')
    }
  })
})

describe('resolveModelConfig', () => {
  it('defaults to paid Gemma pinned to DeepInfra fp8', () => {
    expect(resolveModelConfig({})).toEqual({ model: DEFAULT_MODEL, provider: 'deepinfra/fp8' })
  })

  it('pins the free variant to its own provider when only the model is set', () => {
    expect(resolveModelConfig({ HEARSAY_MODEL: 'google/gemma-4-26b-a4b-it:free' })).toEqual({
      model: 'google/gemma-4-26b-a4b-it:free',
      provider: 'google-ai-studio',
    })
  })

  it('lets HEARSAY_PROVIDER override, and requires it for unknown models', () => {
    expect(resolveModelConfig({ HEARSAY_PROVIDER: 'novita/bf16' }).provider).toBe('novita/bf16')
    expect(() => resolveModelConfig({ HEARSAY_MODEL: 'other/model' })).toThrow('set HEARSAY_PROVIDER')
  })
})

describe('parseInterpretRequest', () => {
  it('accepts segments with board objects', () => {
    expect(parseInterpretRequest(request)).toEqual(request)
  })

  it('keeps only segments from the last 30 s before the newest one', () => {
    const newestAt = 100_000
    const segments = [
      { text: 'too old', at: newestAt - WINDOW_MS - 1 },
      { text: 'just inside', at: newestAt - WINDOW_MS },
      { text: 'newest', at: newestAt },
    ]
    expect(parseInterpretRequest({ segments, objects: [] })?.segments.map((s) => s.text)).toEqual([
      'just inside',
      'newest',
    ])
  })

  it('caps the number of segments, keeping the newest', () => {
    const segments = Array.from({ length: MAX_SEGMENTS + 5 }, (_, i) => ({ text: `s${i}`, at: i }))
    const window = parseInterpretRequest({ segments, objects: [] })?.segments ?? []
    expect(window).toHaveLength(MAX_SEGMENTS)
    expect(window.at(-1)?.text).toBe(`s${MAX_SEGMENTS + 4}`)
    expect(window[0].text).toBe('s5')
  })

  it('rejects missing, malformed or empty-newest segments', () => {
    expect(parseInterpretRequest(null)).toBeUndefined()
    expect(parseInterpretRequest({ segments: [], objects: [] })).toBeUndefined()
    expect(parseInterpretRequest({ segments: [{ text: 'hi', at: 0 }] })).toBeUndefined()
    expect(parseInterpretRequest({ segments: [{ text: 'hi' }], objects: [] })).toBeUndefined()
    expect(
      parseInterpretRequest({ segments: [{ text: 'hi', at: 0 }, { text: ' ', at: 1 }], objects: [] }),
    ).toBeUndefined()
  })
})

describe('interpretWithJev', () => {
  const arrayA: SemanticObject = { id: 'array-a', kind: 'array', shapeIds: [], props: { values: [5, 2, 8, 1] } }
  const pointerI: SemanticObject = {
    id: 'pointer-i',
    kind: 'pointer',
    shapeIds: [],
    props: { label: 'i', array: 'array-a', index: 0 },
  }
  const request = (newest: string): InterpretRequest => ({ segments: [{ text: newest, at: 0 }], objects: [arrayA, pointerI] })
  const choice = (value: string, confidence = 0.95): ChoiceAnswer => ({ type: 'choice', choice: value, confidence })
  const sure = (answers: Omit<JevAnswers, 'change'>): JevAnswers => ({ change: { type: 'noul', noul: 0.95 }, ...answers })
  const config = resolveModelConfig({})
  const gemma = () =>
    vi.fn(async (_request: ChatRequest, _signal?: AbortSignal) => ({
      choices: [{ finish_reason: 'stop', message: { content: null } }],
    }))

  it('returns Jev commands without calling Gemma when Jev settles the request', async () => {
    const chat = gemma()
    const jev = async () => ({
      answers: sure({ command: choice('move_pointer'), target: choice('pointer-i'), index: choice('1') }),
      usage: { cost: 0.00003 },
    })
    const result = await interpretWithJev(chat, jev, request('move it over one'), config)
    expect(result).toMatchObject({ path: 'jev', commands: [{ type: 'move_pointer', target: 'pointer-i', index: 1 }] })
    expect(result.jev.costUsd).toBe(0.00003)
    expect(chat).not.toHaveBeenCalled()
  })

  it('returns nothing below the gate without calling Gemma', async () => {
    const chat = gemma()
    const jev = async () => ({ answers: { change: { type: 'noul' as const, noul: 0.1 } } })
    expect(await interpretWithJev(chat, jev, request('it is simple'), config)).toMatchObject({ path: 'jev-none', commands: [] })
    expect(chat).not.toHaveBeenCalled()
  })

  it('falls back to Gemma when Jev is unsure or fails', async () => {
    const unsure = gemma()
    const low = async () => ({ answers: sure({ command: choice('swap', 0.4) }) })
    expect(await interpretWithJev(unsure, low, request('they trade places'), config)).toMatchObject({
      path: 'fallback',
      reason: 'command not confident',
    })
    expect(unsure).toHaveBeenCalledTimes(1)

    const failing = gemma()
    const broken = async () => {
      throw new Error('Jev 502')
    }
    const result = await interpretWithJev(failing, broken, request('move it over one'), config)
    expect(result).toMatchObject({ path: 'fallback', reason: 'jev error' })
    expect(result.jev.error).toContain('Jev 502')
  })
})
