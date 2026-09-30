import { describe, expect, it } from 'vitest'
import { canConnect, resolveInputs, topoOrder } from './graph'
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
