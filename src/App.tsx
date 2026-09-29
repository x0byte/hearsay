import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { CanvasCommand } from './canvas/commands'
import { executeCanvasCommand } from './canvas/executeCanvasCommand'
import { SemanticStore } from './canvas/semanticStore'
import { rebuildSemanticStore } from './canvas/syncSemanticStore'
import { validateCommand } from './canvas/validateCommand'

// The canvas is saved to the browser (IndexedDB) under this key, so drawings
// survive page reloads. Changing the key starts a fresh, empty board.
const PERSISTENCE_KEY = 'visual-scribe-canvas'

const semanticStore = new SemanticStore()

const HELLO_COMMAND: CanvasCommand = {
  type: 'create_text',
  id: 'hello',
  text: 'Hello from Hearsay',
}

// Restore the semantic store from the persisted canvas, then seed an empty
// page only, so reloading a persisted board doesn't add a copy.
function handleMount(editor: Editor) {
  rebuildSemanticStore(editor, semanticStore)
  if (editor.getCurrentPageShapeIds().size === 0) {
    runCommand(editor, HELLO_COMMAND)
  }
}

function runCommand(editor: Editor, command: CanvasCommand) {
  const result = validateCommand(command, semanticStore)
  if (!result.ok) {
    console.warn(`Rejected ${command.type}: ${result.reason}`)
    return
  }
  executeCanvasCommand(editor, semanticStore, command)
}

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey={PERSISTENCE_KEY} onMount={handleMount} />
    </div>
  )
}
