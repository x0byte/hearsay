import { readdirSync, readFileSync } from 'node:fs'
import { cases } from './cases.ts'
import { rescoreAttempt } from './rescoring.ts'
import { summarize, type Attempt } from './score.ts'

// Re-scores a saved Jev run at other thresholds, offline (no API calls), on
// the tuned set only. Usage:
//   node eval/rescore.ts --label=<jev run label> [--gate=0.3,0.5,0.7] [--confidence=0.6,0.8,0.9]

const RESULTS_DIR = new URL('./results/', import.meta.url)
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=') as [string, string]))
if (!args.label) throw new Error('Pass --label=<label of a saved Jev run>')
const list = (value: string | undefined, fallback: number[]) => (value ? value.split(',').map(Number) : fallback)
const gates = list(args.gate, [0.3, 0.4, 0.5, 0.6, 0.7])
const confidences = list(args.confidence, [0.6, 0.7, 0.8, 0.9])

const file = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(`_${args.label}.json`)).sort().at(-1)
if (!file) throw new Error(`No saved run labelled "${args.label}"`)
const run = JSON.parse(readFileSync(new URL(file, RESULTS_DIR), 'utf8'))
if (!run.jev) throw new Error(`${file} is not a Jev run`)
const byName = new Map(cases.map((c) => [c.name, c]))
const tuned: Attempt[] = run.attempts.filter((a: Attempt) => a.tag !== 'holdout')

console.log(`${file}: ${tuned.length} tuned attempts, recorded at gate ${run.jev.gate}, confidence ${run.jev.confidence}\n`)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6)
console.log('gate  conf  accuracy  false-draws  rescues  misses  wrong  errors  fallback  p50-seq  p50-par')
for (const gate of gates) {
  for (const confidence of confidences) {
    const rescored = tuned.map((a) => rescoreAttempt(a, byName.get(a.case)!, { gate, confidence }))
    const s = summarize(rescored)
    const fallback = (s.paths.fallback ?? 0) / s.attempts
    const marker = gate === run.jev.gate && confidence === run.jev.confidence ? '  <- as run' : ''
    console.log(
      `${gate.toFixed(2)}  ${confidence.toFixed(2)}  ${pct(s.accuracy)}  ${String(s.counts.false_draw).padStart(11)}  ${String(s.noOps.rescued).padStart(7)}  ${String(s.counts.miss).padStart(6)}  ${String(s.counts.wrong).padStart(5)}  ${String(s.counts.error).padStart(6)}  ${pct(fallback)}    ${String(s.latencyMs.p50).padStart(5)}    ${String(s.parallelLatencyMs.p50).padStart(5)}${marker}`,
    )
  }
}
