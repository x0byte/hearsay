import { describe, expect, it } from 'vitest'
import {
  ARRAY_CELL_SIZE,
  arrayCellRects,
  arrayCellWidth,
  CELL_CHAR_WIDTH,
  CELL_PADDING,
  GAP,
  INDEX_LABEL_SPACE,
  MARGIN,
  nextFreePosition,
  POINTER_ARROW_LENGTH,
  pointerGeometry,
} from './layout'

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

describe('arrayCellWidth', () => {
  const widthFor = (chars: number) => chars * CELL_CHAR_WIDTH + 2 * CELL_PADDING

  it('uses the minimum for single digits', () => {
    expect(arrayCellWidth([3, 1, 4, 1, 5])).toBe(ARRAY_CELL_SIZE)
  })

  it('fits the widest multi-digit value', () => {
    expect(arrayCellWidth([7, 100, 25000])).toBe(widthFor(5))
  })

  it('counts the minus sign of negative numbers', () => {
    expect(arrayCellWidth([-12, 3])).toBeGreaterThan(arrayCellWidth([12, 3]))
    expect(arrayCellWidth([-1200, 3])).toBe(widthFor(5))
  })

  it('fits a long string value', () => {
    expect(arrayCellWidth(['a', 'banana split'])).toBe(widthFor(12))
  })

  it('uses the minimum for an empty array', () => {
    expect(arrayCellWidth([])).toBe(ARRAY_CELL_SIZE)
  })
})

describe('arrayCellRects', () => {
  it('lays out one cell per value, side by side, all the same width', () => {
    const w = arrayCellWidth([5, 12345])
    expect(arrayCellRects({ x: 10, y: 20 }, [5, 12345])).toEqual([
      { x: 10, y: 20, w, h: ARRAY_CELL_SIZE },
      { x: 10 + w, y: 20, w, h: ARRAY_CELL_SIZE },
    ])
  })
})

describe('pointerGeometry', () => {
  it('points an upward arrow at the cell centre, below its index label', () => {
    const cell = { x: 100, y: 100, w: 60, h: 60 }
    const tipY = 160 + INDEX_LABEL_SPACE
    expect(pointerGeometry(cell)).toEqual({
      tip: { x: 130, y: tipY },
      tail: { x: 130, y: tipY + POINTER_ARROW_LENGTH },
      label: { x: 100, y: tipY + POINTER_ARROW_LENGTH + 4 },
      labelWidth: 60,
    })
  })
})
