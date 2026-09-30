import { describe, expect, it } from 'vitest'
import { applyFormat } from './TextBody'

describe('applyFormat', () => {
  it('wraps the selection in bold', () => {
    expect(applyFormat('make it pop', 8, 11, 'b')).toEqual({ value: 'make it **pop**', start: 10, end: 13 })
  })
  it('toggles a heading on the current line', () => {
    const on = applyFormat('Title\nbody', 2, 2, 'h1')
    expect(on.value).toBe('# Title\nbody')
    expect(applyFormat(on.value, 3, 3, 'h1').value).toBe('Title\nbody')
  })
  it('numbers every selected line', () => {
    expect(applyFormat('a\nb\nc', 0, 5, 'ol').value).toBe('1. a\n2. b\n3. c')
  })
  it('replaces an existing list marker instead of stacking', () => {
    expect(applyFormat('- a', 0, 3, 'ol').value).toBe('1. a')
  })
})
