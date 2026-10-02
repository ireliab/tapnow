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
  it('mock writer returns only the result, never the instruction', () => {
    const ask = 'genrate a simple script for ai video'
    const doc = mockDocument(ask, '', [])
    expect(doc).toContain('| Time | Visual | Voiceover |')
    expect(doc.toLowerCase()).not.toContain('simple script')
    const rewrite = mockDocument('add a closing line', 'Existing text', [])
    expect(rewrite).toMatch(/^Existing text/)
    expect(rewrite).not.toContain('closing line')
    // running it again doesn't stack the mock note
    expect(mockDocument('again', rewrite, []).match(/mock writer/g)).toHaveLength(1)
  })
})
