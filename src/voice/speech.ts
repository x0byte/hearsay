// Thin wrapper around the browser's Web Speech API. Each final result is one
// transcript segment; interim results are shown while the speaker is talking.

export type SpeechEvents = {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onListeningChange: (listening: boolean) => void
}

// The part of SpeechRecognition used here. TypeScript's DOM library has the
// event types but not the recognizer itself (current Chrome has it unprefixed,
// older Chrome and Safari only as webkitSpeechRecognition).
export type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
export type RecognitionConstructor = new () => Recognition

export function findRecognition(): RecognitionConstructor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

// Errors that end listening, with what the speaker can do about them. Others
// ('no-speech', 'aborted') are routine and the listener just carries on.
const FATAL_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied.',
  'service-not-allowed': 'Speech recognition is not allowed here.',
  'audio-capture': 'No microphone was found.',
  network: 'The speech recognition service is unreachable. Brave blocks it; try Chrome or Edge.',
}

export function createSpeechListener(events: SpeechEvents, Recognition: RecognitionConstructor) {
  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'
  // Whether the speaker wants to be listened to. Chrome ends a continuous
  // session on its own after a silence; while this is true, restart it.
  let wanted = false

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const text = result[0].transcript.trim()
      if (result.isFinal) {
        if (text) events.onFinal(text)
      } else {
        interim += `${result[0].transcript} `
      }
    }
    events.onInterim(interim.trim())
  }
  recognition.onerror = (event) => {
    const fatal = FATAL_ERRORS[event.error]
    if (!fatal) return
    wanted = false
    events.onError(fatal)
    // Browsers normally follow an error with 'end'; don't rely on it.
    events.onInterim('')
    events.onListeningChange(false)
  }
  recognition.onend = () => {
    if (wanted) {
      recognition.start()
      return
    }
    events.onInterim('')
    events.onListeningChange(false)
  }

  return {
    start() {
      if (wanted) return
      wanted = true
      recognition.start()
      events.onListeningChange(true)
    },
    stop() {
      wanted = false
      recognition.stop()
    },
  }
}
