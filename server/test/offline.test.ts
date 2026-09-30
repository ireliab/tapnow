import { describe, expect, it } from 'vitest'
import { pickSkill, splitBeats, splitScenes } from '../src/agent/offline'

const input = (text: string, extra: Partial<{ skills: string[]; refs: any[] }> = {}) => ({ text, skills: [], refs: [], ...extra })

describe('pickSkill', () => {
  it('prefers an attached skill', () => {
    expect(pickSkill(input('anything', { skills: ['character-sheet'] }), 'auto')).toBe('character-sheet')
  })
  it('routes by intent', () => {
    expect(pickSkill(input('make a 20s teaser for a coffee shop'), 'auto')).toBe('storyboard')
    expect(pickSkill(input('explain how it was made'), 'auto')).toBe('explain-canvas')
    expect(pickSkill(input('INT. KITCHEN - DAY\nShe pours coffee.\nEXT. STREET\nRain.'), 'auto')).toBe('script-to-scenes')
    expect(pickSkill(input('product shots please', { refs: [{ kind: 'image' }] }), 'auto')).toBe('product-shots')
    expect(pickSkill(input('remember default aspect 9:16'), 'auto')).toBe('remember')
    expect(pickSkill(input('a cat'), 'brainstorm')).toBe('brainstorm')
  })
})

describe('splitBeats / splitScenes', () => {
  it('honours an explicit shot count', () => {
    expect(splitBeats('a fox in snow, 3 shots')).toHaveLength(3)
  })
  it('strips the shot count from beats and pads instead of repeating', () => {
    const b = splitBeats('A lighthouse keeper finds a message in a bottle, then sails into a storm, 3 shots')
    expect(b).toHaveLength(3)
    expect(b.slice(0, 2)).toEqual(['A lighthouse keeper finds a message in a bottle', 'sails into a storm'])
    expect(b[2]).toMatch(/^Establishing wide shot/)
    expect(b.join(' ')).not.toMatch(/3 shots/)
  })
  it('splits sequential beats', () => {
    expect(splitBeats('A door opens, then a dog runs in, then it jumps')).toEqual(['A door opens', 'a dog runs in', 'it jumps'])
  })
  it('splits scripts on scene headings', () => {
    expect(splitScenes('INT. ROOM\nHi.\nEXT. PARK\nBye.')).toEqual(['INT. ROOM\nHi.', 'EXT. PARK\nBye.'])
  })
})
