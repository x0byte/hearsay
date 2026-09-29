// Internal protocol for describing changes to the canvas.
// Each command is tagged by `type` so CanvasCommand can grow into a
// discriminated union as new commands are added.

export type CreateTextCommand = {
  type: 'create_text'
  id: string
  text: string
  x: number
  y: number
}

export type CanvasCommand = CreateTextCommand
