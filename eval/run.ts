import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { interpret, parseInterpretRequest, resolveModelConfig, SYSTEM_PROMPT } from '../server/interpret.ts'
import { openRouterChat, type ChatCompletion } from '../server/openrouter.ts'
import { cases } from './cases.ts'
import { classify, summarize, type Attempt, type Summary } from './score.ts'

// Runs every eval case against the configured model and saves the results to
// eval/results/ so runs can be compared. Usage:
//   npm run eval -- [--repeats=5] [--label=baseline]
// Head-to-head comparisons: --repeats=5, runs back-to-back in one session.

const RESULTS_DIR = new URL('./results/', import.meta.url)
const SEGMENT_SPACING_MS = 5_000

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=') as [string, string]),
)
const repeats = Number(args.repeats ?? 5)
const label = args.label ?? 'run'

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (add it to .env)')
const config = resolveModelConfig(process.env)
const promptHash = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 12)
const realChat = openRouterChat(apiKey)

console.log(`${cases.length} cases × ${repeats} on ${config.model} via ${config.provider} (prompt ${promptHash})\n`)

const attempts: Attempt[] = []
for (const evalCase of cases) {
  const marks: string[] = []
  for (let r = 0; r < repeats; r++) {
    // Same trimming as the server applies to a real request.
    const request = parseInterpretRequest({
      segments: evalCase.segments.map((text, i) => ({ text, at: i * SEGMENT_SPACING_MS })),
      objects: evalCase.board,
    })
    if (!request) throw new Error(`Case ${evalCase.name} is not a valid request`)
    let costUsd = 0
    let finishReason: Attempt['finishReason']
    let tokens: Attempt['tokens']
    const chat: ChatCompletion = async (req, signal) => {
      const response = await realChat(req, signal)
      const { usage } = response
      costUsd += usage?.cost ?? 0
      finishReason = response.choices[0]?.finish_reason
      tokens = {
        prompt: usage?.prompt_tokens ?? 0,
        completion: usage?.completion_tokens ?? 0,
        reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      }
      return response
    }
    const started = performance.now()
    let got: Attempt['got']
    try {
      got = await interpret(chat, request, config)
    } catch (error) {
      got = { error: error instanceof Error ? error.message : String(error) }
    }
    const latencyMs = Math.round(performance.now() - started)
    const outcome = classify(evalCase.expected, Array.isArray(got) ? got : undefined)
    attempts.push({ case: evalCase.name, tag: evalCase.tag, outcome, latencyMs, costUsd, finishReason, tokens, got })
    marks.push(outcome === 'correct' ? '✓' : outcome === 'false_draw' ? 'D' : outcome === 'miss' ? 'M' : outcome === 'wrong' ? 'W' : 'E')
  }
  console.log(`${marks.join('')}  ${evalCase.tag.padEnd(11)} ${evalCase.name}`)
}

const summary = summarize(attempts)
const previous = latestResult()
mkdirSync(RESULTS_DIR, { recursive: true })
const file = `${new Date().toISOString().replace(/[:.]/g, '-')}_${label}.json`
writeFileSync(
  new URL(file, RESULTS_DIR),
  JSON.stringify({ runAt: new Date().toISOString(), label, ...config, promptHash, repeats, summary, attempts }, null, 2) + '\n',
)

console.log('\n✓ correct  D false draw  M miss  W wrong  E error\n')
printSummary('this run', summary)
if (previous) printSummary(`previous (${previous.file})`, previous.summary)
console.log(`\nSaved eval/results/${file}`)

function printSummary(title: string, s: Summary) {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const byTag = Object.entries(s.accuracyByTag).map(([tag, acc]) => `${tag} ${pct(acc ?? 0)}`).join(', ')
  console.log(`${title}:`)
  console.log(`  accuracy ${pct(s.accuracy)} (${s.counts.correct}/${s.attempts})  by tag: ${byTag}`)
  console.log(`  false draws ${s.counts.false_draw} (${pct(s.falseDrawRate)} of no-change attempts)  misses ${s.counts.miss} (${pct(s.missRate)} of change attempts)  wrong ${s.counts.wrong}  errors ${s.counts.error}`)
  console.log(`  latency p50 ${s.latencyMs.p50} ms  p95 ${s.latencyMs.p95} ms  cost $${s.totalCostUsd.toFixed(5)}`)
}

function latestResult(): { file: string; summary: Summary } | undefined {
  let files: string[]
  try {
    files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return undefined
  }
  const file = files.at(-1)
  if (!file) return undefined
  return { file, summary: JSON.parse(readFileSync(new URL(file, RESULTS_DIR), 'utf8')).summary }
}
