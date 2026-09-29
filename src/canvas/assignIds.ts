// Explicit .ts extension: this module is also loaded by the Node server.
import type { CanvasCommand } from './commands.ts'

// A command as a model produces it: create commands carry no `id`, and any
// reference may be NEW_REF, meaning "the object created most recently in this
// batch". assignIds turns drafts into real commands.
export type DraftCommand = CanvasCommand extends infer C
  ? C extends { id: string }
    ? Omit<C, 'id'>
    : C
  : never

export const NEW_REF = 'new'

// Gives each create command the next free semantic ID for its kind and
// resolves NEW_REF references. Returns undefined if a NEW_REF has nothing to
// refer to. `existingIds` are the IDs already on the board.
export function assignIds(drafts: DraftCommand[], existingIds: string[]): CanvasCommand[] | undefined {
  const taken = new Set(existingIds)
  let lastCreated: string | undefined
  const resolve = (ref: string) => (ref === NEW_REF ? lastCreated : ref)
  const commands: CanvasCommand[] = []

  for (const draft of drafts) {
    switch (draft.type) {
      case 'create_text':
      case 'create_array':
      case 'create_pointer': {
        const array = draft.type === 'create_pointer' ? resolve(draft.array) : undefined
        if (draft.type === 'create_pointer' && !array) return undefined
        const id = nextId(draft, taken)
        taken.add(id)
        lastCreated = id
        commands.push({ ...draft, id, ...(array && { array }) } as CanvasCommand)
        break
      }
      case 'highlight':
      case 'move_pointer':
      case 'delete': {
        const target = resolve(draft.target)
        if (!target) return undefined
        commands.push({ ...draft, target })
        break
      }
      default: {
        // Fails to compile if a new command type is added without a case above.
        const unhandled: never = draft
        throw new Error(`Unhandled command type: ${(unhandled as CanvasCommand).type}`)
      }
    }
  }
  return commands
}

type CreateDraft = Extract<DraftCommand, { type: 'create_text' | 'create_array' | 'create_pointer' }>

function nextId(draft: CreateDraft, taken: Set<string>): string {
  switch (draft.type) {
    case 'create_array':
      return firstFree(taken, (n) => `array-${n < 26 ? String.fromCharCode(97 + n) : n + 1}`)
    case 'create_text':
      return firstFree(taken, (n) => `text-${n + 1}`)
    case 'create_pointer': {
      const slug = draft.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const base = `pointer-${slug || 'p'}`
      return firstFree(taken, (n) => (n === 0 ? base : `${base}-${n + 1}`))
    }
  }
}

function firstFree(taken: Set<string>, candidate: (n: number) => string): string {
  for (let n = 0; ; n++) {
    const id = candidate(n)
    if (!taken.has(id)) return id
  }
}
