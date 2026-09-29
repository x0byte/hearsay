export type SemanticKind = 'text' | 'array' | 'pointer'

export interface SemanticObject {
    id : string     // 'array-a', 'pointer-i'
    kind : SemanticKind
    shapeIds: string[]  // one semantic object → many tldraw shapes
    props: Record<string, unknown> // e.g. { values: [3,1,4] }, loosened later

}