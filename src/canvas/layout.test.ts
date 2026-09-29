import { describe, expect, it } from 'vitest'
import { ARRAY_CELL_SIZE, arrayCellRects, GAP, MARGIN, nextFreePosition } from './layout'

describe('nextFreePosition', () => {
  it('starts at the top-left margin on an empty page', () => {
    expect(nextFreePosition([])).toEqual({ x: MARGIN, y: MARGIN })
  })

  it('places the next object below the lowest existing one', () => {
    const occupied = [
      { x: 100, y: 100, w: 200, h: 50 },
      { x: 400, y: 80, w: 100, h: 300 },
    ]
    expect(nextFreePosition(occupied)).toEqual({ x: MARGIN, y: 380 + GAP })
  })
})

describe('arrayCellRects', () => {
  it('lays out one square cell per value, side by side', () => {
    const size = ARRAY_CELL_SIZE
    expect(arrayCellRects({ x: 10, y: 20 }, 2)).toEqual([
      { x: 10, y: 20, w: size, h: size },
      { x: 10 + size, y: 20, w: size, h: size },
    ])
  })
})
