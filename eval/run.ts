import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  interpret,
  interpretWithJev,
  resolveModelConfig,
  SYSTEM_PROMPT,
  type JevTrace,
} from '../server/interpret.ts'
import { DEFAULT_THRESHOLDS, JEV_QUESTION_TEXT, openRouterJev, type JevDecide, type JevThresholds } from '../server/jev.ts'
import { openRouterChat, type ChatCompletion } from '../server/openrouter.ts'
import { cases } from './cases.ts'
import type { InterpretRequest } from '../src/interpret/protocol.ts'
import { requestFor } from './request.ts'
import { classify, summarize, type Attempt, type GemmaTrace, type Summary } from './score.ts'

// Runs every eval case against the configured model and saves the results to
// eval/results/ so runs can be compared. Usage:
//   npm run eval -- [--repeats=5] [--label=baseline] [--compare=<label>]
//                   [--jev [--gate=0.5] [--confidence=0.8]]
// --compare picks the latest saved run with that label; otherwise the latest run.
// Head-to-head comparisons: --repeats=5, runs back-to-back in one session.

const RESULTS_DIR = new URL('./results/', import.meta.url)

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
const useJev = 'jev' in args
const thresholds: JevThresholds = {
  gate: Number(args.gate ?? process.env.JEV_GATE ?? DEFAULT_THRESHOLDS.gate),
  confidence: Number(args.confidence ?? process.env.JEV_CONFIDENCE ?? DEFAULT_THRESHOLDS.confidence),
}
// Covers everything a model reads: Gemma's prompt and Jev's question wording.
const promptHash = createHash('sha256')
  .update(SYSTEM_PROMPT)
  .update(JSON.stringify(JEV_QUESTION_TEXT))
  .digest('hex')
  .slice(0, 12)
const realChat = openRouterChat(apiKey)
const realJev = openRouterJev(apiKey)
const mode = useJev ? `Jev (gate ${thresholds.gate}, confidence ${thresholds.confidence}) + ` : ''

console.log(`${cases.length} cases × ${repeats} on ${mode}${config.model} via ${config.provider} (prompt ${promptHash})\n`)

const attempts: Attempt[] = []
for (const evalCase of cases) {
  const marks: string[] = []
  for (let r = 0; r < repeats; r++) {
    const request = requestFor(evalCase)
    const attempt = useJev ? await runWithJev(request) : await runGemmaOnly(request)
    const outcome = classify(evalCase.expected, Array.isArray(attempt.got) ? attempt.got : undefined)
    attempts.push({ case: evalCase.name, tag: evalCase.tag, expectsChange: evalCase.expected.length > 0, outcome, ...attempt })
    marks.push(outcome === 'correct' ? '✓' : outcome === 'false_draw' ? 'D' : outcome === 'miss' ? 'M' : outcome === 'wrong' ? 'W' : 'E')
  }
  console.log(`${marks.join('')}  ${evalCase.tag.padEnd(11)} ${evalCase.name}`)
}

type Run = Omit<Attempt, 'case' | 'tag' | 'expectsChange' | 'outcome'>

// A chat function that records Gemma's cost, finish reason and token counts.
function recordingChat() {
  const record: Pick<Run, 'finishReason' | 'tokens'> & { costUsd: number } = { costUsd: 0 }
  const chat: ChatCompletion = async (req, signal) => {
    const response = await realChat(req, signal)
    const { usage } = response
    record.costUsd += usage?.cost ?? 0
    record.finishReason = response.choices[0]?.finish_reason
    record.tokens = {
      prompt: usage?.prompt_tokens ?? 0,
      completion: usage?.completion_tokens ?? 0,
      reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    }
    return response
  }
  return { chat, record }
}

function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runGemma(request: InterpretRequest, shadow: boolean): Promise<GemmaTrace & Pick<Run, 'finishReason' | 'tokens'>> {
  const { chat, record } = recordingChat()
  const started = performance.now()
  try {
    const result = await interpret(chat, request, config)
    return { latencyMs: Math.round(performance.now() - started), shadow, ...record, ...result }
  } catch (error) {
    return { latencyMs: Math.round(performance.now() - started), shadow, ...record, error: errorOf(error) }
  }
}

async function runGemmaOnly(request: InterpretRequest): Promise<Run> {
  const gemma = await runGemma(request, false)
  return {
    path: 'gemma',
    latencyMs: gemma.latencyMs,
    costUsd: gemma.costUsd,
    finishReason: gemma.finishReason,
    tokens: gemma.tokens,
    got: gemma.error ? { error: gemma.error } : (gemma.commands ?? []),
    dropped: gemma.dropped ?? [],
  }
}

async function runWithJev(request: InterpretRequest): Promise<Run> {
  const { chat, record } = recordingChat()
  // Keep Jev's answers even if the Gemma fallback then fails.
  let jevTrace: JevTrace | undefined
  const jev: JevDecide = async (body, signal) => {
    const started = performance.now()
    const response = await realJev(body, signal)
    jevTrace = { answers: response.answers, latencyMs: Math.round(performance.now() - started), costUsd: response.usage?.cost ?? 0 }
    return response
  }
  const started = performance.now()
  let run: Run
  try {
    const result = await interpretWithJev(chat, jev, request, config, thresholds)
    const jevUsed = { ...result.jev, latencyMs: Math.round(result.jev.latencyMs) }
    const gemma: GemmaTrace | undefined =
      result.path === 'fallback'
        ? { latencyMs: Math.round(result.gemmaLatencyMs ?? 0), costUsd: record.costUsd, shadow: false, commands: result.commands, dropped: result.dropped }
        : undefined
    run = {
      path: result.path,
      reason: result.reason,
      latencyMs: Math.round(performance.now() - started),
      costUsd: jevUsed.costUsd + record.costUsd,
      finishReason: record.finishReason,
      tokens: record.tokens,
      got: result.commands,
      dropped: result.dropped,
      jev: jevUsed,
      gemma,
    }
  } catch (error) {
    // Gemma fallback failed (e.g. cut off); Jev's answers are still recorded.
    run = {
      path: 'fallback',
      reason: 'gemma error',
      latencyMs: Math.round(performance.now() - started),
      costUsd: (jevTrace?.costUsd ?? 0) + record.costUsd,
      finishReason: record.finishReason,
      tokens: record.tokens,
      got: { error: errorOf(error) },
      dropped: [],
      jev: jevTrace,
      gemma: { latencyMs: 0, costUsd: record.costUsd, shadow: false, error: errorOf(error) },
    }
  }
  // Jev settled it: ask Gemma anyway, untimed, so the run can be re-scored.
  if (!run.gemma) {
    const { finishReason: _f, tokens: _t, ...shadow } = await runGemma(request, true)
    run.gemma = shadow
  }
  return run
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
  JSON.stringify(
    { runAt: new Date().toISOString(), label, ...config, jev: useJev ? thresholds : undefined, promptHash, repeats, summary, holdoutSummary, attempts },
    null,
    2,
  ) + '\n',
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
  // Older result files predate paths and simulated parallel latency.
  if (s.paths && s.parallelLatencyMs) {
    const paths = Object.entries(s.paths).map(([path, n]) => `${path} ${n}`).join(', ')
    console.log(`  paths: ${paths}  simulated parallel latency p50 ${s.parallelLatencyMs.p50} ms  p95 ${s.parallelLatencyMs.p95} ms`)
  }
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
