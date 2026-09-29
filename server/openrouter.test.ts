import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterError, openRouterChat, type ChatRequest } from './openrouter.ts'

const request = {} as ChatRequest

afterEach(() => vi.unstubAllGlobals())

describe('openRouterChat', () => {
  it('returns a completion body', async () => {
    const body = { choices: [{ finish_reason: 'stop', message: { content: null } }] }
    vi.stubGlobal('fetch', async () => Response.json(body))
    expect(await openRouterChat('key')(request)).toEqual(body)
  })

  it('throws when a 200 body cannot be read, instead of returning nothing', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"choices": [', { status: 200 }))
    await expect(openRouterChat('key')(request)).rejects.toThrow('no completion')
  })

  it('throws with the upstream explanation on an error status', async () => {
    const error = { error: { message: 'Provider returned error', metadata: { raw: 'rate-limited upstream' } } }
    vi.stubGlobal('fetch', async () => Response.json(error, { status: 429 }))
    const failure = openRouterChat('key')(request)
    await expect(failure).rejects.toBeInstanceOf(OpenRouterError)
    await expect(failure).rejects.toThrow('OpenRouter 429: rate-limited upstream')
  })
})
