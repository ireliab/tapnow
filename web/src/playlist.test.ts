import { describe, expect, it } from 'vitest'
import { clipAt, layoutClips, moveClip, splitAt, totalDuration, trimEdge, trimLeftTo, trimRightTo } from './playlist'
import type { PlaylistClip } from './types'

const clips: PlaylistClip[] = [{ id: 'a', nodeId: 'A', in: 0 }, { id: 'b', nodeId: 'B', in: 1, out: 4 }]
const dur = (id: string) => ({ A: 5, B: 6 } as Record<string, number>)[id]

describe('playlist timeline', () => {
  it('lays clips out end to end, honouring in/out', () => {
    const v = layoutClips(clips, dur)
    expect(v.map(x => [x.start, x.dur])).toEqual([[0, 5], [5, 3]])
    expect(totalDuration(v)).toBe(8)
    expect(clipAt(v, 6)?.clip.id).toBe('b')
  })
  it('C splits the clip under the playhead', () => {
    const next = splitAt(clips, layoutClips(clips, dur), 6)
    expect(next).toHaveLength(3)
    expect(next[1]).toMatchObject({ nodeId: 'B', in: 1, out: 2 })
    expect(next[2]).toMatchObject({ nodeId: 'B', in: 2, out: 4 })
    expect(totalDuration(layoutClips(next, dur))).toBe(8)
  })
  it('Q / E trim the current clip to the playhead', () => {
    const v = layoutClips(clips, dur)
    expect(trimLeftTo(clips, v, 2)[0]).toMatchObject({ in: 2 })
    expect(trimRightTo(clips, v, 6.5)[1]).toMatchObject({ in: 1, out: 2.5 })
  })
  it('edge trims clamp to the source and a minimum length', () => {
    const v = layoutClips(clips, dur)
    expect(trimEdge(clips, v, 1, 'out', 10)[1].out).toBe(6)
    expect(trimEdge(clips, v, 1, 'in', 10)[1].in).toBeCloseTo(3.8)
  })
  it('reorders', () => {
    expect(moveClip(clips, 0, 1).map(c => c.id)).toEqual(['b', 'a'])
  })
})
