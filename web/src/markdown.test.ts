import { describe, expect, it } from 'vitest'
import { plainText, renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings, emphasis, lists and rules', () => {
    expect(renderMarkdown('# Title\n**bold** and *it*\n\n- a\n- b\n\n1. one\n---')).toBe(
      '<h1>Title</h1><p><strong>bold</strong> and <em>it</em></p><ul><li>a</li><li>b</li></ul><ol><li>one</li></ol><hr>',
    )
  })
  it('escapes html and only links http(s)', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.b)')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('href="https://a.b"')
  })
})

describe('plainText', () => {
  it('strips markdown syntax and table rules', () => {
    expect(plainText('**Title:** Hero  \n| Time | Visual |\n| --- | --- |\n| 0:00 | Wide |')).toBe('Title: Hero Time Visual 0:00 Wide')
    expect(plainText('## Notes\n- [link](http://x) and *more*')).toBe('Notes link and more')
  })
})
