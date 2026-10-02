import { describe, expect, it } from 'vitest'
import { mockDocument } from '../src/providers/mock'
import { textMessages } from '../src/providers/openai'
import type { GenRequest } from '../src/providers/types'

const req = (prompt: string, document?: string, texts: string[] = []): GenRequest =>
  ({ kind: 'text', model: 'llm', prompt, params: { document }, inputs: { texts, images: [], videos: [], audios: [] } })

describe('text node generation', () => {
  it('an instruction writes or rewrites the document, with connected notes as reference', () => {
    const [sys, user] = textMessages(req('make it punchier', '# Draft\nslow intro', ['Brand: Acme']))
    expect(sys.content).toMatch(/rewrite or extend it/)
    expect(user.content).toContain('Reference material from connected nodes:\nBrand: Acme')
    expect(user.content).toContain('Current document:\n# Draft\nslow intro')
    expect(user.content.endsWith('Instruction: make it punchier')).toBe(true)
  })
  it('no instruction keeps the old "expand into a prompt" behaviour', () => {
    const [sys, user] = textMessages(req('', 'a fox in snow'))
    expect(sys.content).toMatch(/prompt engineer/)
    expect(user.content).toBe('a fox in snow')
  })
  it('mock writer produces a markdown script table offline', () => {
    const doc = mockDocument('genrate a simple script for ai video', '', [])
    expect(doc).toMatch(/^\*\*Title:\*\* Simple script for ai video/)
    expect(doc).toContain('| Time | Visual | Voiceover |')
    expect(mockDocument('add a closing line', 'Existing text', [])).toMatch(/^Existing text/)
  })
})
