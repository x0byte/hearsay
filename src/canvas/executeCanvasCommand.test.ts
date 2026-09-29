import { describe, expect, it } from 'vitest'
import type { Editor } from 'tldraw'
import type { CanvasCommand } from './commands'
import { executeCanvasCommand } from './executeCanvasCommand'

describe('executeCanvasCommand', () => {
  it('throws on an unknown command type', () => {
    const unknown = { type: 'not_a_command' } as unknown as CanvasCommand
    expect(() => executeCanvasCommand({} as Editor, unknown)).toThrow(
      'Unhandled canvas command type: not_a_command',
    )
  })
})
