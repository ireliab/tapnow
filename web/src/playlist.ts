import type { PlaylistClip } from './types'

/**
 * Pure playlist-timeline maths (TapNow Playlist: reorder, trim edges, C split,
 * Q/E trim to playhead). `srcDur(nodeId)` is the full length of a clip's source.
 */
export interface ClipView { clip: PlaylistClip; index: number; start: number; dur: number; srcDur: number }

const uid = () => Math.random().toString(36).slice(2, 10)
const MIN = 0.2

export function layoutClips(clips: PlaylistClip[], srcDur: (nodeId: string) => number): ClipView[] {
  let t = 0
  return clips.map((clip, index) => {
    const full = Math.max(MIN, srcDur(clip.nodeId))
    const inn = Math.min(Math.max(0, clip.in), full - MIN)
    const out = Math.min(clip.out ?? full, full)
    const dur = Math.max(MIN, out - inn)
    const v = { clip, index, start: t, dur, srcDur: full }
    t += dur
    return v
  })
}

export const totalDuration = (views: ClipView[]) => views.reduce((a, v) => a + v.dur, 0)
export const clipAt = (views: ClipView[], t: number) => views.find(v => t >= v.start && t < v.start + v.dur) ?? (t >= totalDuration(views) ? views.at(-1) : undefined)

/** C: split the clip under the playhead into two. */
export function splitAt(clips: PlaylistClip[], views: ClipView[], t: number): PlaylistClip[] {
  const v = clipAt(views, t)
  if (!v) return clips
  const local = v.clip.in + (t - v.start)
  if (local - v.clip.in < MIN || (v.clip.in + v.dur) - local < MIN) return clips
  const a = { ...v.clip, out: local }
  const b = { ...v.clip, id: uid(), in: local }
  return [...clips.slice(0, v.index), a, b, ...clips.slice(v.index + 1)]
}

/** Q: drop everything of the current clip before the playhead. */
export function trimLeftTo(clips: PlaylistClip[], views: ClipView[], t: number): PlaylistClip[] {
  const v = clipAt(views, t)
  if (!v) return clips
  const local = v.clip.in + (t - v.start)
  if ((v.clip.in + v.dur) - local < MIN) return clips
  return clips.map((c, i) => (i === v.index ? { ...c, in: local } : c))
}

/** E: drop everything of the current clip after the playhead. */
export function trimRightTo(clips: PlaylistClip[], views: ClipView[], t: number): PlaylistClip[] {
  const v = clipAt(views, t)
  if (!v) return clips
  const local = v.clip.in + (t - v.start)
  if (local - v.clip.in < MIN) return clips
  return clips.map((c, i) => (i === v.index ? { ...c, out: local } : c))
}

/** Drag an edge: `edge` 'in' or 'out', `delta` seconds. */
export function trimEdge(clips: PlaylistClip[], views: ClipView[], index: number, edge: 'in' | 'out', delta: number): PlaylistClip[] {
  const v = views[index]
  if (!v) return clips
  const inn = v.clip.in, out = v.clip.in + v.dur
  const next = edge === 'in'
    ? { ...v.clip, in: Math.min(Math.max(0, inn + delta), out - MIN) }
    : { ...v.clip, out: Math.max(Math.min(v.srcDur, out + delta), inn + MIN) }
  return clips.map((c, i) => (i === index ? next : c))
}

export function moveClip(clips: PlaylistClip[], from: number, to: number): PlaylistClip[] {
  if (from === to || from < 0 || from >= clips.length) return clips
  const next = [...clips]
  const [c] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, c)
  return next
}

export const newClip = (nodeId: string): PlaylistClip => ({ id: uid(), nodeId, in: 0 })

export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
