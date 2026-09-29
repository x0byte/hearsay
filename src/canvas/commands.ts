// Internal protocol for describing changes to the canvas.
// Each command is tagged by `type` so CanvasCommand can grow into a
// discriminated union as new commands are added.

export type CreateTextCommand = {
  type: 'create_text'
  id: string
  text: string
  // Optional: when omitted, the layout module picks the position.
  x?: number
  y?: number
}

export type CreateArrayCommand = {
  type: 'create_array'
  id: string
  values: (number | string)[]
  // Optional: when omitted, the layout module picks the position.
  x?: number
  y?: number
}

// Highlights an existing object, or a single cell when `index` is given
// (arrays only). Highlights are exclusive per object: a new one replaces the
// object's previous highlight.
export type HighlightCommand = {
  type: 'highlight'
  target: string
  index?: number
}

// Removes an object's highlight.
export type ClearHighlightCommand = {
  type: 'clear_highlight'
  target: string
}

// An object's current highlight, stored in its props as `highlight`: the whole
// object, or one array cell. Absent means not highlighted.
export type Highlight = 'all' | number

// A labelled arrow under one cell of an array, e.g. loop index `i`.
export type CreatePointerCommand = {
  type: 'create_pointer'
  id: string
  label: string
  array: string
  index: number
}

// Moves a pointer to another cell of the same array.
export type MovePointerCommand = {
  type: 'move_pointer'
  target: string
  index: number
}

// Removes an object. Deleting an array also removes the pointers on it.
export type DeleteCommand = {
  type: 'delete'
  target: string
}

export type CanvasCommand =
  | CreateTextCommand
  | CreateArrayCommand
  | HighlightCommand
  | ClearHighlightCommand
  | CreatePointerCommand
  | MovePointerCommand
  | DeleteCommand
