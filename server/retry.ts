import { OpenRouterError, type ChatCompletion } from './openrouter.ts'

export type RetryOptions = {
  delayMs?: number
  // Provider to try if the pinned one is still rate-limited after the retry.
  // Leave out to stay pinned (the eval does, so runs stay comparable).
  fallbackProvider?: string
  onRetry?: (event: RetryEvent) => void
}

export type RetryEvent = { kind: 'retry' | 'fallback-provider'; provider: string }

export const RETRY_DELAY_MS = 300

// Wraps a chat completion so an upstream rate limit (429) is retried once
// after a short pause, then sent to a second provider if one is given. Other
// errors are not retried. An abort (the request was superseded) stops
// everything at once, including the pause.
export function retryingChat(chat: ChatCompletion, options: RetryOptions = {}): ChatCompletion {
  const { delayMs = RETRY_DELAY_MS, fallbackProvider, onRetry } = options
  return async (request, signal) => {
    try {
      return await chat(request, signal)
    } catch (error) {
      if (!isRateLimit(error)) throw error
    }
    await pause(delayMs, signal)
    onRetry?.({ kind: 'retry', provider: request.provider.order[0] })
    try {
      return await chat(request, signal)
    } catch (error) {
      if (!isRateLimit(error) || !fallbackProvider) throw error
    }
    onRetry?.({ kind: 'fallback-provider', provider: fallbackProvider })
    return chat({ ...request, provider: { ...request.provider, order: [fallbackProvider] } }, signal)
  }
}

function isRateLimit(error: unknown): boolean {
  return error instanceof OpenRouterError && error.status === 429
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
