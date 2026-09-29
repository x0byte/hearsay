// Decides where new objects go, so commands never need coordinates.

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const MARGIN = 100
export const GAP = 40

// Stacks new objects top to bottom along the left margin, below everything
// already on the page.
export function nextFreePosition(occupied: Rect[]): Point {
  if (occupied.length === 0) return { x: MARGIN, y: MARGIN }
  const bottom = Math.max(...occupied.map((r) => r.y + r.h))
  return { x: MARGIN, y: bottom + GAP }
}

// Cells are ARRAY_CELL_SIZE tall and at least that wide.
export const ARRAY_CELL_SIZE = 60
// Estimated width of one character of a cell label (a digit in tldraw's draw
// font at the default size is ~16) and the padding either side (tldraw pads
// geo labels by ~16). A generous estimate, so layout stays pure and labels
// don't wrap.
export const CELL_CHAR_WIDTH = 16
export const CELL_PADDING = 20

// Every cell of an array has the same width: enough for its widest value.
export function arrayCellWidth(values: (number | string)[]): number {
  const longest = Math.max(0, ...values.map((value) => String(value).length))
  return Math.max(ARRAY_CELL_SIZE, longest * CELL_CHAR_WIDTH + 2 * CELL_PADDING)
}

// One cell per value, side by side from the origin.
export function arrayCellRects(origin: Point, values: (number | string)[]): Rect[] {
  const w = arrayCellWidth(values)
  return values.map((_, i) => ({ x: origin.x + i * w, y: origin.y, w, h: ARRAY_CELL_SIZE }))
}

// Space under a cell for its index label, then the pointer arrow and its label.
export const INDEX_LABEL_SPACE = 28
export const POINTER_ARROW_LENGTH = 40

export type PointerGeometry = { tip: Point; tail: Point; label: Point; labelWidth: number }

// An upward arrow under `cell`, with its label below the tail.
export function pointerGeometry(cell: Rect): PointerGeometry {
  const centerX = cell.x + cell.w / 2
  const tip = { x: centerX, y: cell.y + cell.h + INDEX_LABEL_SPACE }
  const tail = { x: centerX, y: tip.y + POINTER_ARROW_LENGTH }
  return { tip, tail, label: { x: cell.x, y: tail.y + 4 }, labelWidth: cell.w }
}
