import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

// The canvas is saved to the browser (IndexedDB) under this key, so drawings
// survive page reloads. Changing the key starts a fresh, empty board.
const PERSISTENCE_KEY = 'visual-scribe-canvas'

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey={PERSISTENCE_KEY} />
    </div>
  )
}
