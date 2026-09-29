import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { interpret, parseInterpretRequest, resolveModelConfig, SYSTEM_PROMPT } from '../server/interpret.ts'
import { openRouterChat, type ChatCompletion } from '../server/openrouter.ts'
import { cases } from './cases.ts'
import { classify, summarize, type Attempt, type Summary } from './score.ts'

// Runs every eval case against the configured model and saves the results to
// eval/results/ so runs can be compared. Usage:
//   npm run eval -- [--repeats=5] [--label=baseline] [--compare=<label>]
// --compare picks the latest saved run with that label; otherwise the latest run.
// Head-to-head comparisons: --repeats=5, runs back-to-back in one session.

const RESULTS_DIR = new URL('./results/', import.meta.url)
const SEGMENT_SPACING_MS = 5_000

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=') as [string, string]),
)
const repeats = Number(args.repeats ?? 5)
const label = args.label ?? 'run'
const compareLabel: string | undefined = args.compare

// Looked up before any model calls, so a bad --compare fails fast and free.
const previous = latestResult(compareLabel)
if (compareLabel && !previous) throw new Error(`No saved run labelled "${compareLabel}" in eval/results/`)

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
    let dropped: Attempt['dropped'] = []
    try {
      const result = await interpret(chat, request, config)
      got = result.commands
      dropped = result.dropped
    } catch (error) {
      got = { error: error instanceof Error ? error.message : String(error) }
    }
    const latencyMs = Math.round(performance.now() - started)
    const outcome = classify(evalCase.expected, Array.isArray(got) ? got : undefined)
    const expectsChange = evalCase.expected.length > 0
    attempts.push({ case: evalCase.name, tag: evalCase.tag, expectsChange, outcome, latencyMs, costUsd, finishReason, tokens, got, dropped })
    marks.push(outcome === 'correct' ? '✓' : outcome === 'false_draw' ? 'D' : outcome === 'miss' ? 'M' : outcome === 'wrong' ? 'W' : 'E')
  }
  console.log(`${marks.join('')}  ${evalCase.tag.padEnd(11)} ${evalCase.name}`)
}

// `summary` covers the tuned set only, so it stays comparable across runs;
// held-out cases get their own summary.
const summary = summarize(attempts.filter((a) => a.tag !== 'holdout'))
const holdout = attempts.filter((a) => a.tag === 'holdout')
const holdoutSummary = holdout.length ? summarize(holdout) : undefined
mkdirSync(RESULTS_DIR, { recursive: true })
const file = `${new Date().toISOString().replace(/[:.]/g, '-')}_${label}.json`
writeFileSync(
  new URL(file, RESULTS_DIR),
  JSON.stringify({ runAt: new Date().toISOString(), label, ...config, promptHash, repeats, summary, holdoutSummary, attempts }, null, 2) + '\n',
)

console.log('\n✓ correct  D false draw  M miss  W wrong  E error\n')
printSummary('this run, tuned set', summary)
if (previous) printSummary(`compared with, tuned set (${previous.file})`, previous.summary)
if (holdoutSummary) printSummary('this run, HELD-OUT set (report separately)', holdoutSummary)
if (holdoutSummary && previous?.holdoutSummary) printSummary('compared with, held-out set', previous.holdoutSummary)
console.log(`\nSaved eval/results/${file}`)

function printSummary(title: string, s: Summary) {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const byTag = Object.entries(s.accuracyByTag).map(([tag, acc]) => `${tag} ${pct(acc ?? 0)}`).join(', ')
  console.log(`${title}:`)
  console.log(`  accuracy ${pct(s.accuracy)} (${s.counts.correct}/${s.attempts})  by tag: ${byTag}`)
  console.log(`  false draws ${s.counts.false_draw} (${pct(s.falseDrawRate)} of no-change attempts)  misses ${s.counts.miss} (${pct(s.missRate)} of change attempts)  wrong ${s.counts.wrong}  errors ${s.counts.error}`)
  console.log(`  latency p50 ${s.latencyMs.p50} ms  p95 ${s.latencyMs.p95} ms  cost $${s.totalCostUsd.toFixed(5)}`)
  // Older result files predate no-op dropping.
  if (s.noOps) {
    console.log(`  no-op drops: ${s.noOps.commands} commands in ${s.noOps.attempts} attempts; ${s.noOps.rescued} no-change attempts correct only because of a drop`)
  }
}

// Result files are named <timestamp>_<label>.json, so sorting by name is by time.
function latestResult(withLabel?: string): { file: string; summary: Summary; holdoutSummary?: Summary } | undefined {
  let files: string[]
  try {
    files = readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith(withLabel ? `_${withLabel}.json` : '.json'))
      .sort()
  } catch {
    return undefined
  }
  const file = files.at(-1)
  if (!file) return undefined
  const { summary, holdoutSummary } = JSON.parse(readFileSync(new URL(file, RESULTS_DIR), 'utf8'))
  return { file, summary, holdoutSummary }
}
