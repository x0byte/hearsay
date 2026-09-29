import { describe, expect, it, vi } from 'vitest'
import { commandTools, draftFromToolCall } from './commandTools.ts'
import {
  DEFAULT_MODEL,
  interpret,
  parseInterpretRequest,
  resolveModelConfig,
} from './interpret.ts'
import type { ChatRequest, ToolCall } from './openrouter.ts'

const call = (name: string, args: unknown): ToolCall => ({
  id: `call-${name}`,
  type: 'function',
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
})

// A fake chat completion that replies with the given tool calls.
function fakeChat(toolCalls: ToolCall[] | undefined, finishReason = 'tool_calls') {
  return vi.fn(async (_request: ChatRequest) => ({
    choices: [{ finish_reason: finishReason, message: { content: null, tool_calls: toolCalls } }],
  }))
}

const request = {
  transcript: 'Let me draw the array 3 1 4 and put i at the start',
  objects: [{ id: 'hello', kind: 'text' as const, shapeIds: ['shape:1'], props: { text: 'Hi' } }],
}

describe('interpret', () => {
  it('turns valid tool calls into commands, in order, with IDs assigned in code', async () => {
    const chat = fakeChat([
      call('create_array', { values: [3, 1, 4] }),
      call('create_pointer', { label: 'i', array: 'new', index: 0 }),
    ])

    expect(await interpret(chat, request)).toEqual([
      { type: 'create_array', id: 'array-a', values: [3, 1, 4] },
      { type: 'create_pointer', id: 'pointer-i', label: 'i', array: 'array-a', index: 0 },
    ])
  })

  it('returns no commands when "new" has nothing to refer to', async () => {
    const chat = fakeChat([call('highlight', { target: 'new' })])
    expect(await interpret(chat, request)).toEqual([])
  })

  it('returns no commands when the model calls no tools', async () => {
    expect(await interpret(fakeChat(undefined, 'stop'), request)).toEqual([])
  })

  it('returns no commands at all if any one call is malformed', async () => {
    const chat = fakeChat([
      call('create_array', { values: [3, 1, 4] }),
      call('create_pointer', { label: 'i', array: 'new', index: '0' }),
    ])
    expect(await interpret(chat, request)).toEqual([])
  })

  it('sends the board, transcript, tools and pinned provider', async () => {
    const chat = fakeChat([], 'stop')
    await interpret(chat, request)

    const sent = chat.mock.calls[0][0]
    expect(sent.model).toBe(DEFAULT_MODEL)
    expect(sent.provider).toEqual({ order: ['deepinfra/fp8'], allow_fallbacks: false })
    expect(sent.tools).toBe(commandTools)
    expect(sent.messages[1].content).toContain('- hello (text): {"text":"Hi"}')
    expect(sent.messages[1].content).toContain(request.transcript)
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
      'create_pointer',
      'move_pointer',
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
  it('accepts a transcript with board objects', () => {
    expect(parseInterpretRequest(request)).toEqual(request)
  })

  it('rejects missing or empty fields', () => {
    expect(parseInterpretRequest(null)).toBeUndefined()
    expect(parseInterpretRequest({ transcript: '  ', objects: [] })).toBeUndefined()
    expect(parseInterpretRequest({ transcript: 'hi' })).toBeUndefined()
  })
})
