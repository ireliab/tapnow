import { describe, expect, it } from 'vitest'
import { anglePrompt, centeredCrop, gridCells, lightPrompt, outpaintLayout } from './geometry'

describe('geometry', () => {
  it('crops the largest centred rect', () => {
    expect(centeredCrop(1600, 900, '1:1')).toEqual({ x: 350, y: 0, w: 900, h: 900 })
    expect(centeredCrop(1000, 1000, '16:9')).toEqual({ x: 0, y: 219, w: 1000, h: 563 })
  })
  it('splits a grid row-major', () => {
    const cells = gridCells(900, 900, 3)
    expect(cells).toHaveLength(9)
    expect(cells[4]).toEqual({ x: 300, y: 300, w: 300, h: 300 })
  })
  it('grows the canvas to the target aspect without shrinking', () => {
    const l = outpaintLayout(1024, 1024, '16:9')
    expect(l.height).toBe(1024)
    expect(l.width).toBe(1824)
    expect(l.x).toBe(400)
    expect(l.y).toBe(0)
    // landscape → portrait
    const p = outpaintLayout(1600, 900, '9:16')
    expect(p.width).toBe(1600)
    expect(p.y).toBeGreaterThan(0)
  })
  it('builds readable camera and light prompts', () => {
    expect(anglePrompt({ rotate: -45, tilt: 20, distance: 'close', wide: true })).toContain('45° to the left')
    expect(lightPrompt({ direction: 'left', brightness: 80, temperature: 3200, rim: true })).toBe('bright, high-key warm 3200K light coming from the left, with a subtle rim light outlining the subject')
  })
})
