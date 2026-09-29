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

export const ARRAY_CELL_SIZE = 60

// One square cell per value, side by side from the origin.
export function arrayCellRects(origin: Point, count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    x: origin.x + i * ARRAY_CELL_SIZE,
    y: origin.y,
    w: ARRAY_CELL_SIZE,
    h: ARRAY_CELL_SIZE,
  }))
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
