import { describe, expect, it } from 'vitest'
import { absolutize, canConnect, expandMentions, layoutBatch, resolveInputs, topoOrder, upstreamOf } from './graph'
import type { CanvasEdge, CanvasNode, NodeKind } from './types'

const node = (id: string, kind: NodeKind, y: number, extra: { prompt?: string; url?: string } = {}): CanvasNode => ({
  id, type: 'canvas', position: { x: 0, y },
  data: {
    kind, title: id, prompt: extra.prompt ?? '', model: 'm', params: {}, active: 0, status: 'idle',
    outputs: extra.url ? [{ id: id + 'o', kind, url: extra.url, createdAt: 0 }] : [],
  },
})
const edge = (source: string, target: string): CanvasEdge => ({ id: `${source}-${target}`, source, target })

describe('resolveInputs', () => {
  it('orders image inputs top-to-bottom (first frame, last frame)', () => {
    const nodes = [node('last', 'image', 200, { url: '/files/b.png' }), node('first', 'image', 0, { url: '/files/a.png' }), node('v', 'video', 100)]
    const r = resolveInputs('v', nodes, [edge('last', 'v'), edge('first', 'v')])
    expect(r.images).toEqual(['/files/a.png', '/files/b.png'])
  })
  it('collects text and skips empty upstream nodes', () => {
    const nodes = [node('t', 'text', 0, { prompt: ' neon style ' }), node('e', 'image', 50), node('i', 'image', 100)]
    const r = resolveInputs('i', nodes, [edge('t', 'i'), edge('e', 'i')])
    expect(r).toEqual({ texts: ['neon style'], images: [], videos: [], audios: [] })
  })
})

describe('topoOrder', () => {
  it('puts upstream nodes first', () => {
    const nodes = [node('v', 'video', 0), node('i', 'image', 0), node('t', 'text', 0)]
    const order = topoOrder(nodes, [edge('t', 'i'), edge('i', 'v')]).map(n => n.id)
    expect(order).toEqual(['t', 'i', 'v'])
  })
})

describe('canConnect', () => {
  it('allows image->video but not video->image', () => {
    expect(canConnect('image', 'video')).toBe(true)
    expect(canConnect('video', 'image')).toBe(false)
  })
})

describe('layoutBatch', () => {
  it('lays a storyboard out as style → keyframes → clips, style centred', () => {
    const specs = ['style', 'img0', 'vid0', 'img1', 'vid1'].map(ref => ({ ref }))
    const edges = [{ from: 'style', to: 'img0' }, { from: 'style', to: 'img1' }, { from: 'img0', to: 'vid0' }, { from: 'img1', to: 'vid1' }]
    const p = layoutBatch(specs, edges, { x: 0, y: 0 }, { col: 100, row: 10 })
    expect(p.img0).toEqual({ x: 100, y: 0 })
    expect(p.img1).toEqual({ x: 100, y: 10 })
    expect(p.vid0).toEqual({ x: 200, y: 0 })
    expect(p.vid1).toEqual({ x: 200, y: 10 })
    expect(p.style).toEqual({ x: 0, y: 5 })
  })
  it('ignores edges from existing nodes when computing columns', () => {
    const p = layoutBatch([{ ref: 'a' }], [{ from: 'existing-id', to: 'a' }], { x: 7, y: 9 })
    expect(p.a).toEqual({ x: 7, y: 9 })
  })
})

describe('expandMentions', () => {
  const t = node('style', 'text', 0, { prompt: 'neon noir' })
  t.data.title = 'Style'
  const a = node('a', 'image', 10, { url: '/files/a.png' }); a.data.title = 'Hero'
  const b = node('b', 'image', 20, { url: '/files/b.png' }); b.data.title = 'Hero 2'
  const v = node('v', 'video', 30)
  const edges = [edge('style', 'v'), edge('a', 'v'), edge('b', 'v')]
  const nodes = [t, a, b, v]
  it('orders mentioned images first and labels them; inlines text once', () => {
    const r = expandMentions('Start on @Hero 2, end on @Hero, look like @Style', upstreamOf('v', nodes, edges), resolveInputs('v', nodes, edges))
    expect(r.inputs.images).toEqual(['/files/b.png', '/files/a.png'])
    expect(r.prompt).toBe('Start on image 1, end on image 2, look like "neon noir"')
    expect(r.inputs.texts).toEqual([])
  })
  it('is a no-op without mentions', () => {
    const inputs = resolveInputs('v', nodes, edges)
    expect(expandMentions('plain', upstreamOf('v', nodes, edges), inputs)).toEqual({ prompt: 'plain', inputs })
  })
})

describe('absolutize', () => {
  it('adds the parent offset to children', () => {
    const [c] = absolutize([{ id: 'c', parentId: 'g', position: { x: 5, y: 6 } }], [{ id: 'g', position: { x: 100, y: 200 } }])
    expect(c.position).toEqual({ x: 105, y: 206 })
  })
})
