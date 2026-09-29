import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createSpeechListener, type RecognitionConstructor, type SpeechEvents } from './speech'

beforeAll(() => {
  vi.stubGlobal('navigator', { language: 'en-AU' })
})

// A stand-in for the browser's SpeechRecognition that tests drive by hand.
class FakeRecognition {
  static last: FakeRecognition
  continuous = false
  interimResults = false
  lang = ''
  starts = 0
  stops = 0
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    this.starts++
  }
  stop() {
    this.stops++
    this.onend?.()
  }
  // Results from resultIndex on; each is [text, isFinal].
  emit(resultIndex: number, results: [string, boolean][]) {
    this.onresult?.({
      resultIndex,
      results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    })
  }
}

function setup() {
  const events = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onListeningChange: vi.fn() } satisfies SpeechEvents
  const listener = createSpeechListener(events, FakeRecognition as unknown as RecognitionConstructor)
  return { events, listener, recognition: FakeRecognition.last }
}

describe('createSpeechListener', () => {
  it('listens continuously with interim results in the browser language', () => {
    const { recognition, listener, events } = setup()
    listener.start()
    expect(recognition).toMatchObject({ continuous: true, interimResults: true, lang: 'en-AU', starts: 1 })
    expect(events.onListeningChange).toHaveBeenCalledWith(true)
  })

  it('turns each final result into a segment and shows interim text meanwhile', () => {
    const { recognition, listener, events } = setup()
    listener.start()
    recognition.emit(0, [['let us make', false]])
    expect(events.onInterim).toHaveBeenLastCalledWith('let us make')
    recognition.emit(0, [[' let us make an array ', true], ['with three', false]])
    expect(events.onFinal).toHaveBeenCalledWith('let us make an array')
    expect(events.onInterim).toHaveBeenLastCalledWith('with three')
  })

  it('restarts after the browser ends a session on its own, until stopped', () => {
    const { recognition, listener, events } = setup()
    listener.start()
    recognition.onend?.() // e.g. Chrome after a silence
    expect(recognition.starts).toBe(2)
    listener.stop()
    expect(recognition.starts).toBe(2)
    expect(events.onListeningChange).toHaveBeenLastCalledWith(false)
  })

  it('stops with a readable message on fatal errors, and ignores routine ones', () => {
    const { recognition, listener, events } = setup()
    listener.start()
    recognition.onerror?.({ error: 'no-speech' })
    expect(events.onError).not.toHaveBeenCalled()
    recognition.onerror?.({ error: 'network' })
    expect(events.onError).toHaveBeenCalledWith(expect.stringContaining('Brave blocks it'))
    expect(events.onListeningChange).toHaveBeenLastCalledWith(false) // even before 'end' arrives
    recognition.onend?.()
    expect(recognition.starts).toBe(1) // no restart after a fatal error
    expect(events.onListeningChange).toHaveBeenLastCalledWith(false)
  })
})
