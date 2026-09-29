import { useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { CanvasCommand } from './canvas/commands'
import { runCommands } from './canvas/executeCanvasCommand'
import { SemanticStore } from './canvas/semanticStore'
import { rebuildSemanticStore, syncSemanticStore } from './canvas/syncSemanticStore'
import { DevCommandBox } from './DevCommandBox'

// The canvas is saved to the browser (IndexedDB) under this key, so drawings
// survive page reloads. Changing the key starts a fresh, empty board.
const PERSISTENCE_KEY = 'hearsay-canvas'

const semanticStore = new SemanticStore()

const HELLO_COMMAND: CanvasCommand = {
  type: 'create_text',
  id: 'hello',
  text: 'Hello from Hearsay',
}

// Restore the semantic store from the persisted canvas, keep it in sync with
// later canvas changes, then seed an empty page only, so reloading a persisted
// board doesn't add a copy.
function handleMount(editor: Editor) {
  rebuildSemanticStore(editor, semanticStore)
  const stopSync = syncSemanticStore(editor, semanticStore)
  if (editor.getCurrentPageShapeIds().size === 0) {
    const result = runCommands(editor, semanticStore, [HELLO_COMMAND])
    if (!result.ok) console.warn(`Seed command rejected: ${result.reason}`)
  }
  return stopSync
}

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)

  function onMount(mounted: Editor) {
    setEditor(mounted)
    // TEMP dev console hook — do not commit. In the browser console:
    //   hearsay.run({ type: 'create_array', id: 'array-a', values: [3, 1, 4] })
    //   hearsay.run([{ ... }, { ... }])   // one batch, one undo step
    //   hearsay.objects()                 // semantic store contents
    if (import.meta.env.DEV) {
      Object.assign(window, {
        hearsay: {
          run: (commands: CanvasCommand | CanvasCommand[]) =>
            runCommands(mounted, semanticStore, Array.isArray(commands) ? commands : [commands]),
          objects: () => semanticStore.list(),
          editor: mounted,
        },
      })
    }
    return handleMount(mounted)
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey={PERSISTENCE_KEY} onMount={onMount} />
      {import.meta.env.DEV && editor && <DevCommandBox editor={editor} store={semanticStore} />}
    </div>
  )
}
