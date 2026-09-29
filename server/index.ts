import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { interpret, parseInterpretRequest, resolveModelConfig } from './interpret.ts'
import { OpenRouterError, openRouterChat } from './openrouter.ts'

// Minimal backend that keeps the API key off the browser. The client posts
// { transcript, objects } to /api/interpret and gets back { commands }.

const PORT = Number(process.env.PORT ?? 8787)
const config = resolveModelConfig(process.env)
const MAX_BODY_BYTES = 64 * 1024

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Add it to .env (server only).')
  process.exit(1)
}
const chat = openRouterChat(apiKey)

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
    return sendJson(res, 400, { error: 'Expected { transcript: string, objects: array }' })
  }
  try {
    const commands = await interpret(chat, request, config)
    sendJson(res, 200, { commands })
  } catch (error) {
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
  console.log(`Hearsay server on http://localhost:${PORT} (${config.model} via ${config.provider})`)
})
