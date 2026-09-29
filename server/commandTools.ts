import type { DraftCommand } from '../src/canvas/assignIds.ts'
import type { CanvasCommand } from '../src/canvas/commands.ts'
import type { FunctionTool, ToolCall } from './openrouter.ts'

// One tool per canvas command. The tool name is the command's `type` and its
// arguments are the rest of the command, so a tool call maps straight onto a
// DraftCommand (see src/canvas/assignIds.ts). Left out on purpose: coordinates
// (the layout module places objects) and new IDs (assigned in code).

type Schema = {
  type: 'object' | 'array' | 'string' | 'integer' | 'number'
  description?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: false
  items?: { anyOf: Schema[] }
}

const REF_HELP = 'An ID listed on the board, or "new" for the object created most recently in this reply.'
const target: Schema = { type: 'string', description: REF_HELP }
const cellIndex: Schema = { type: 'integer', description: 'Zero-based array cell index.' }

function tool(
  name: CanvasCommand['type'],
  description: string,
  properties: Record<string, Schema>,
  required: string[],
): FunctionTool & { function: { parameters: Schema } } {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  }
}

export const commandTools = [
  tool('create_text', 'Write a short piece of text on the board.', { text: { type: 'string' } }, ['text']),
  tool(
    'create_array',
    'Draw an array as a row of cells with their indices.',
    { values: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } } },
    ['values'],
  ),
  tool(
    'highlight',
    'Highlight an existing object, or one cell of an array when index is given. Replaces the object\'s current highlight.',
    { target, index: cellIndex },
    ['target'],
  ),
  tool('clear_highlight', 'Remove the highlight from an existing object.', { target }, ['target']),
  tool(
    'create_pointer',
    'Draw a labelled pointer (e.g. loop variable "i") under a cell of an existing array.',
    {
      label: { type: 'string', description: 'Short label, usually the variable name.' },
      array: { type: 'string', description: `The array to point into. ${REF_HELP}` },
      index: cellIndex,
    },
    ['label', 'array', 'index'],
  ),
  tool('move_pointer', 'Move an existing pointer to another cell of its array.', { target, index: cellIndex }, [
    'target',
    'index',
  ]),
  tool('delete', 'Remove an existing object. Removing an array also removes its pointers.', { target }, [
    'target',
  ]),
]

// Turns a model tool call into a draft command, or undefined if the call doesn't
// match a command tool's schema exactly (unknown name, bad JSON, missing or
// extra fields, wrong types).
export function draftFromToolCall(call: ToolCall): DraftCommand | undefined {
  const tool = commandTools.find((t) => t.function.name === call.function.name)
  if (!tool) return undefined
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return undefined
  }
  if (!matches(tool.function.parameters, args)) return undefined
  return { type: tool.function.name, ...(args as object) } as DraftCommand
}

// Checks a value against the small JSON Schema subset used above.
function matches(schema: Schema, value: unknown): boolean {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && value.trim() !== ''
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'array':
      return (
        Array.isArray(value) &&
        value.every((item) => schema.items?.anyOf.some((option) => matches(option, item)) ?? true)
      )
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const properties = schema.properties ?? {}
      const record = value as Record<string, unknown>
      if (!Object.keys(record).every((key) => key in properties)) return false
      if (!(schema.required ?? []).every((key) => key in record)) return false
      return Object.entries(record).every(([key, v]) => matches(properties[key], v))
    }
  }
}
