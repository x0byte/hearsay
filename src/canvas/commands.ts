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

export type CanvasCommand = CreateTextCommand | CreateArrayCommand
