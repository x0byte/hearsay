import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { interpret, interpretWithJev, parseInterpretRequest, resolveModelConfig } from './interpret.ts'
import { DEFAULT_THRESHOLDS, openRouterJev } from './jev.ts'
import { OpenRouterError, openRouterChat } from './openrouter.ts'
import { retryingChat } from './retry.ts'

// Minimal backend that keeps the API key off the browser. The client posts an
// InterpretRequest to /api/interpret and gets back { commands }.

const PORT = Number(process.env.PORT ?? 8787)
const config = resolveModelConfig(process.env)
const MAX_BODY_BYTES = 64 * 1024

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Add it to .env (server only).')
  process.exit(1)
}
// A rate-limited Gemma call is retried once, then sent to a second provider.
// A superseded request (client gone) aborts even during the pause.
const chat = retryingChat(openRouterChat(apiKey), {
  fallbackProvider: config.fallbackProvider,
  onRetry: ({ kind, provider }) => console.warn(`Gemma rate-limited: ${kind} via ${provider}`),
})
// Jev in front of Gemma, adopted per the eval decision rule (eval/results/*_jev-s1.json).
// HEARSAY_JEV=0 turns it off, leaving Gemma alone.
const jev = process.env.HEARSAY_JEV === '0' ? undefined : openRouterJev(apiKey)
const thresholds = {
  gate: Number(process.env.JEV_GATE ?? DEFAULT_THRESHOLDS.gate),
  confidence: Number(process.env.JEV_CONFIDENCE ?? DEFAULT_THRESHOLDS.confidence),
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/interpret') {
    return sendJson(res, 404, { error: 'Not found' })
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: 'Body must be JSON, at most 64 KB' })
  }
  const request = parseInterpretRequest(body)
  if (!request) {
    return sendJson(res, 400, {
      error: 'Expected { segments: [{ text, at }] (newest last, non-empty), objects: array }',
    })
  }
  // A newer request from the same client aborts this one's connection; stop
  // the model call too instead of paying for an answer nobody reads.
  const clientGone = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) clientGone.abort()
  })
  try {
    const { commands } = jev
      ? await interpretWithJev(chat, jev, request, config, thresholds, clientGone.signal)
      : await interpret(chat, request, config, clientGone.signal)
    sendJson(res, 200, { commands })
  } catch (error) {
    if (clientGone.signal.aborted) return
    // Never forward provider error details to the browser; log them here.
    console.error('interpret failed:', error)
    const status = error instanceof OpenRouterError && error.status === 429 ? 429 : 502
    sendJson(res, status, { error: 'Interpretation failed' })
  }
})

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

server.listen(PORT, () => {
  const mode = jev ? `Jev (gate ${thresholds.gate}, confidence ${thresholds.confidence}) + ` : ''
  console.log(`Hearsay server on http://localhost:${PORT} (${mode}${config.model} via ${config.provider})`)
})
