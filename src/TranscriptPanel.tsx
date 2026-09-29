import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Editor } from 'tldraw'
import { runCommands } from './canvas/executeCanvasCommand'
import type { SemanticStore } from './canvas/semanticStore'
import { createInterpreter } from './interpret/client'
import { createTranscriptSession, describeStatus } from './interpret/session'
import { createSpeechListener, findRecognition } from './voice/speech'

type Props = { editor: Editor; store: SemanticStore }

// Voice (and, in development, typed lines) feeding one shared transcript.
// Each final spoken phrase is a segment; earlier ones are sent as context.
export function TranscriptPanel({ editor, store }: Props) {
  const [status, setStatus] = useState('Press the mic and talk through your explanation.')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [text, setText] = useState('')

  const session = useMemo(
    () =>
      createTranscriptSession({
        interpret: createInterpreter(),
        apply: (commands) => runCommands(editor, store, commands),
        objects: () => store.list(),
        onStatus: (s) => setStatus(describeStatus(s)),
      }),
    [editor, store],
  )

  const Recognition = useMemo(() => findRecognition(), [])
  const listener = useMemo(
    () =>
      Recognition &&
      createSpeechListener(
        {
          onInterim: setInterim,
          onFinal: (phrase) => void session.addSegment(phrase),
          onError: setStatus,
          onListeningChange: setListening,
        },
        Recognition,
      ),
    [Recognition, session],
  )
  useEffect(() => () => listener?.stop(), [listener])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void session.addSegment(text)
    setText('')
  }

  return (
    <div style={styles.panel}>
      <div style={styles.row}>
        {listener ? (
          <button
            type="button"
            onClick={() => (listening ? listener.stop() : listener.start())}
            style={{ ...styles.mic, ...(listening ? styles.micOn : {}) }}
            aria-pressed={listening}
            aria-label="Voice input"
          >
            {listening ? '● Listening — click to stop' : '🎤 Start listening'}
          </button>
        ) : (
          <span style={styles.note}>Voice needs Chrome, Edge or Safari (this browser has no speech recognition).</span>
        )}
        {import.meta.env.DEV && (
          <form onSubmit={handleSubmit} style={styles.form}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="or type what you would say"
              style={styles.input}
              aria-label="Transcript segment"
            />
          </form>
        )}
      </div>
      {interim && (
        <div style={styles.interim} aria-label="Hearing">
          {interim}
        </div>
      )}
      <div style={styles.status} role="status" aria-label="Voice status">
        {status}
      </div>
    </div>
  )
}

const styles = {
  panel: {
    position: 'absolute',
    top: 56,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(560px, calc(100% - 32px))',
    boxSizing: 'border-box',
    padding: 8,
    background: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 10,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
    zIndex: 1000,
    fontFamily: 'system-ui, sans-serif',
  },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  mic: {
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
  },
  micOn: { borderColor: '#e8590c', color: '#e8590c' },
  form: { flex: 1, minWidth: 180 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 8,
  },
  note: { fontSize: 13, color: '#666' },
  interim: { marginTop: 4, fontSize: 13, color: '#333', fontStyle: 'italic' },
  status: { marginTop: 4, fontSize: 12, color: '#666' },
} as const
