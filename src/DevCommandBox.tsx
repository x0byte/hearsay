import { useMemo, useRef, useState, type FormEvent } from 'react'
import type { Editor } from 'tldraw'
import { runCommands } from './canvas/executeCanvasCommand'
import type { SemanticStore } from './canvas/semanticStore'
import { createInterpreter } from './interpret/client'
import type { TranscriptSegment } from './interpret/protocol'

// Development-only stand-in for voice: each submitted line is a transcript
// segment. Earlier lines are sent too, as context.

const SESSION_START = Date.now()
// The server trims to its own window; this just keeps the request small.
const MAX_SEGMENTS = 20

type Props = { editor: Editor; store: SemanticStore }

export function DevCommandBox({ editor, store }: Props) {
  const interpret = useMemo(() => createInterpreter(), [])
  const segments = useRef<TranscriptSegment[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Type what you would say, then Enter.')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    segments.current = [...segments.current, { text, at: Date.now() - SESSION_START }].slice(-MAX_SEGMENTS)
    setText('')
    setStatus('Thinking…')
    const outcome = await interpret({ segments: segments.current, objects: store.list() })
    if (outcome.status === 'stale') return
    if (outcome.status === 'error') return setStatus(`Error: ${outcome.message}`)
    if (outcome.commands.length === 0) return setStatus('No change.')
    const result = runCommands(editor, store, outcome.commands)
    const types = outcome.commands.map((command) => command.type).join(', ')
    setStatus(result.ok ? `Applied: ${types}` : `Rejected ${types}: ${result.reason}`)
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="e.g. let's make an array with 3, 1, 4"
        style={styles.input}
        aria-label="Transcript segment"
      />
      <div style={styles.status}>{status}</div>
    </form>
  )
}

const styles = {
  form: {
    position: 'absolute',
    top: 56,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(480px, calc(100% - 32px))',
    zIndex: 1000,
    fontFamily: 'system-ui, sans-serif',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 8,
  },
  status: { marginTop: 4, fontSize: 12, color: '#666' },
} as const
