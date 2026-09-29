// Explicit .ts extension: this module is also loaded by the Node server.
import type { CanvasCommand, CreateArrayCommand } from './commands.ts'

// A command as a model produces it: create commands carry no `id`, and any
// reference may be NEW_REF, meaning "the object created most recently in this
// batch". A create_array draft may also carry pointers to put on the new array
// (a compound create), which become separate create_pointer commands.
// assignIds turns drafts into real commands.
export type DraftCommand =
  | Exclude<WithoutId<CanvasCommand>, { type: 'create_array' }>
  | (Omit<CreateArrayCommand, 'id'> & { pointers?: DraftPointer[] })

export type DraftPointer = { label: string; index: number }

type WithoutId<C> = C extends { id: string } ? Omit<C, 'id'> : C

export const NEW_REF = 'new'

// Gives each create command the next free semantic ID for its kind, expands
// compound creates, and resolves NEW_REF references. After a compound create,
// NEW_REF means the array, not its last pointer. Returns undefined if a NEW_REF
// has nothing to refer to. `existingIds` are the IDs already on the board.
export function assignIds(drafts: DraftCommand[], existingIds: string[]): CanvasCommand[] | undefined {
  const taken = new Set(existingIds)
  let lastCreated: string | undefined
  const resolve = (ref: string) => (ref === NEW_REF ? lastCreated : ref)
  const commands: CanvasCommand[] = []

  for (const draft of drafts) {
    switch (draft.type) {
      case 'create_array': {
        const { pointers = [], ...array } = draft
        const id = nextId(array, taken)
        taken.add(id)
        commands.push({ ...array, id })
        for (const { label, index } of pointers) {
          const pointer = { type: 'create_pointer' as const, label, array: id, index }
          const pointerId = nextId(pointer, taken)
          taken.add(pointerId)
          commands.push({ ...pointer, id: pointerId })
        }
        lastCreated = id
        break
      }
      case 'create_text':
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
      case 'clear_highlight':
      case 'move_pointer':
      case 'swap':
      case 'set_value':
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

type CreateDraft = Extract<WithoutId<CanvasCommand>, { type: 'create_text' | 'create_array' | 'create_pointer' }>

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
