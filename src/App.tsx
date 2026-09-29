import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { CanvasCommand } from './canvas/commands'
import { executeCanvasCommand } from './canvas/executeCanvasCommand'

// The canvas is saved to the browser (IndexedDB) under this key, so drawings
// survive page reloads. Changing the key starts a fresh, empty board.
const PERSISTENCE_KEY = 'visual-scribe-canvas'

const HELLO_COMMAND: CanvasCommand = {
  type: 'create_text',
  id: 'hello',
  text: 'Hello from Hearsay',
  x: 100,
  y: 100,
}

// Only seed an empty page, so reloading a persisted board doesn't add a copy.
function handleMount(editor: Editor) {
  if (editor.getCurrentPageShapeIds().size === 0) {
    executeCanvasCommand(editor, HELLO_COMMAND)
  }
}

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey={PERSISTENCE_KEY} onMount={handleMount} />
    </div>
  )
}
