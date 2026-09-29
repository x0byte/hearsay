// Semantic view of the canvas: what exists, by domain-level ID, independent of
// tldraw. One semantic object may be drawn with many tldraw shapes.

export type SemanticKind = 'text' | 'array' | 'pointer'

export interface SemanticObject {
  id: string // 'array-a', 'pointer-i'
  kind: SemanticKind
  shapeIds: string[] // one semantic object → many tldraw shapes
  props: Record<string, unknown> // e.g. { values: [3,1,4] }, loosened later
}

export class SemanticStore {
  private readonly objects = new Map<string, SemanticObject>()

  add(object: SemanticObject): void {
    if (this.objects.has(object.id)) {
      throw new Error(`Semantic object already exists: ${object.id}`)
    }
    this.objects.set(object.id, object)
  }

  get(id: string): SemanticObject | undefined {
    return this.objects.get(id)
  }

  updateProps(id: string, props: Record<string, unknown>): void {
    const object = this.objects.get(id)
    if (!object) throw new Error(`Semantic object not found: ${id}`)
    this.objects.set(id, { ...object, props })
  }

  remove(id: string): boolean {
    return this.objects.delete(id)
  }

  clear(): void {
    this.objects.clear()
  }

  list(): SemanticObject[] {
    return [...this.objects.values()]
  }
}
