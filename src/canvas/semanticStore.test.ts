import { describe, expect, it } from 'vitest'
import { SemanticStore, type SemanticObject } from './semanticStore'

const arrayA: SemanticObject = {
  id: 'array-a',
  kind: 'array',
  shapeIds: ['shape:1', 'shape:2'],
  props: { values: [3, 1, 4] },
}

describe('SemanticStore', () => {
  it('adds and gets an object by semantic ID', () => {
    const store = new SemanticStore()
    store.add(arrayA)
    expect(store.get('array-a')).toEqual(arrayA)
    expect(store.get('missing')).toBeUndefined()
  })

  it('rejects a duplicate semantic ID', () => {
    const store = new SemanticStore()
    store.add(arrayA)
    expect(() => store.add(arrayA)).toThrow('Semantic object already exists: array-a')
  })

  it('removes an object and reports whether it existed', () => {
    const store = new SemanticStore()
    store.add(arrayA)
    expect(store.remove('array-a')).toBe(true)
    expect(store.remove('array-a')).toBe(false)
    expect(store.get('array-a')).toBeUndefined()
  })

  it('lists objects in insertion order', () => {
    const store = new SemanticStore()
    const pointerI: SemanticObject = { id: 'pointer-i', kind: 'pointer', shapeIds: [], props: {} }
    store.add(arrayA)
    store.add(pointerI)
    expect(store.list().map((o) => o.id)).toEqual(['array-a', 'pointer-i'])
  })

  it('clears all objects', () => {
    const store = new SemanticStore()
    store.add(arrayA)
    store.clear()
    expect(store.list()).toEqual([])
  })
})
