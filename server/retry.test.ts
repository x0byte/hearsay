import { describe, expect, it, vi } from 'vitest'
import { OpenRouterError, type ChatRequest, type ChatResponse } from './openrouter.ts'
import { retryingChat, type RetryEvent } from './retry.ts'

const request = { provider: { order: ['deepinfra/fp8'], allow_fallbacks: false } } as ChatRequest
const ok: ChatResponse = { choices: [{ finish_reason: 'stop', message: { content: null } }] }
const rateLimited = () => new OpenRouterError(429, 'OpenRouter 429: rate-limited upstream')

// A chat whose calls fail or succeed in the given order.
function scripted(...outcomes: (ChatResponse | Error)[]) {
  return vi.fn(async (_request: ChatRequest, _signal?: AbortSignal) => {
    const next = outcomes.shift()
    if (!next) throw new Error('unexpected extra call')
    if (next instanceof Error) throw next
    return next
  })
}

describe('retryingChat', () => {
  it('passes a first success straight through', async () => {
    const chat = scripted(ok)
    expect(await retryingChat(chat, { delayMs: 0 })(request)).toBe(ok)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('retries a rate limit once on the same provider', async () => {
    const chat = scripted(rateLimited(), ok)
    const events: RetryEvent[] = []
    expect(await retryingChat(chat, { delayMs: 0, onRetry: (e) => events.push(e) })(request)).toBe(ok)
    expect(chat.mock.calls[1][0].provider.order).toEqual(['deepinfra/fp8'])
    expect(events).toEqual([{ kind: 'retry', provider: 'deepinfra/fp8' }])
  })

  it('moves to the fallback provider if the retry is also rate-limited', async () => {
    const chat = scripted(rateLimited(), rateLimited(), ok)
    const events: RetryEvent[] = []
    const result = await retryingChat(chat, { delayMs: 0, fallbackProvider: 'novita/bf16', onRetry: (e) => events.push(e) })(request)
    expect(result).toBe(ok)
    expect(chat.mock.calls[2][0].provider).toEqual({ order: ['novita/bf16'], allow_fallbacks: false })
    expect(events.map((e) => e.kind)).toEqual(['retry', 'fallback-provider'])
  })

  it('stays pinned without a fallback provider, giving up after one retry', async () => {
    const chat = scripted(rateLimited(), rateLimited())
    await expect(retryingChat(chat, { delayMs: 0 })(request)).rejects.toThrow('429')
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('does not retry other errors', async () => {
    const chat = scripted(new OpenRouterError(502, 'bad gateway'))
    await expect(retryingChat(chat, { delayMs: 0 })(request)).rejects.toThrow('bad gateway')
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('stops at once, without retrying, when the request is superseded during the pause', async () => {
    const chat = scripted(rateLimited(), ok)
    const controller = new AbortController()
    const pending = retryingChat(chat, { delayMs: 10_000 })(request, controller.signal)
    await Promise.resolve()
    controller.abort(new DOMException('superseded', 'AbortError'))
    await expect(pending).rejects.toThrow('superseded')
    expect(chat).toHaveBeenCalledTimes(1)
  })
})
