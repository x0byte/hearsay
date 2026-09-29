// Minimal client for OpenRouter's OpenAI-compatible chat completions API.
// Only the fields Hearsay uses are typed.

export type FunctionTool = {
  type: 'function'
  function: { name: string; description: string; parameters: object }
}

export type ChatRequest = {
  model: string
  messages: { role: 'system' | 'user'; content: string }[]
  tools: FunctionTool[]
  tool_choice: 'auto'
  provider: { order: string[]; allow_fallbacks: false }
  max_tokens: number
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatResponse = {
  model?: string
  provider?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
  choices: {
    finish_reason: string | null
    message: { content: string | null; tool_calls?: ToolCall[] }
  }[]
}

export type ChatCompletion = (request: ChatRequest, signal?: AbortSignal) => Promise<ChatResponse>

export class OpenRouterError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'OpenRouterError'
    this.status = status
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 30_000

export function openRouterChat(apiKey: string): ChatCompletion {
  return async (request, signal) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Hearsay',
      },
      body: JSON.stringify(request),
      // Stops on timeout, or as soon as the caller aborts (e.g. client left).
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      // metadata.raw carries the upstream provider's explanation, e.g. rate limits.
      const error = (body as { error?: { message?: string; metadata?: { raw?: string } } })?.error
      const message = error?.metadata?.raw ?? error?.message ?? response.statusText
      throw new OpenRouterError(response.status, `OpenRouter ${response.status}: ${message}`)
    }
    return body as ChatResponse
  }
}
