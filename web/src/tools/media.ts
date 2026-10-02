import { api } from '../api'
import { activeOutput } from '../graph'
import { defaultModelWithImages, NODE_WIDTH, shown, useStore } from '../store'
import type { Asset, CanvasNode, CanvasNodeData, ModelInfo, NodeKind, Output } from '../types'

const S = () => useStore.getState()

export const node = (id: string) => S().nodes.find(n => n.id === id)
export const sourceUrl = (id: string) => { const n = node(id); return n ? activeOutput(n)?.url : undefined }
export const isMock = (o?: Output) => !!o?.mime?.includes('svg')

export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

/** Draw an image (SVG mocks included) to a canvas at its natural size. */
export async function rasterize(url: string, maxSide = 2048) {
  const img = await loadImage(url)
  const w0 = img.naturalWidth || 1024, h0 = img.naturalHeight || 1024
  const k = Math.min(1, maxSide / Math.max(w0, h0))
  const c = document.createElement('canvas')
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

export const canvasToFile = (c: HTMLCanvasElement, name: string, type = 'image/png') =>
  new Promise<File>((resolve, reject) => c.toBlob(b => (b ? resolve(new File([b], name, { type })) : reject(new Error('Encoding failed'))), type))

export async function uploadCanvas(c: HTMLCanvasElement, name: string) {
  const [asset] = await api.upload([await canvasToFile(c, `${name}.png`)], S().projectId)
  return asset
}

const toOutput = (a: Asset): Output => ({ id: a.id, kind: a.kind, url: a.url, mime: a.mime, prompt: a.prompt, createdAt: a.createdAt })

/**
 * Put results next to a source node as new nodes connected from it (TapNow tools
 * never overwrite the original). Returns the new node ids.
 */
export function addDerived(sourceId: string, items: Array<{ kind: NodeKind; title: string; asset?: Asset; data?: Partial<CanvasNodeData> }>, layout: 'row' | 'column' | 'grid' = 'column') {
  const src = node(sourceId)
  if (!src) return []
  const baseX = src.position.x + (src.measured?.width ?? NODE_WIDTH[src.data.kind]) + 120
  const cols = layout === 'grid' ? Math.ceil(Math.sqrt(items.length)) : layout === 'row' ? items.length : 1
  const ids: string[] = []
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const id = S().addNode(it.kind, { x: baseX + col * (NODE_WIDTH[it.kind] + 40), y: src.position.y + row * 300 }, {
      title: it.title,
      ...(it.asset ? { outputs: [toOutput(it.asset)], status: 'done' as const, prompt: '' } : {}),
      ...it.data,
    })
    // nodes created inside a group stay in that group
    if (src.parentId) useStore.setState(s => ({ nodes: s.nodes.map(n => (n.id === id ? { ...n, parentId: src.parentId } : n)) }))
    S().onConnect({ source: sourceId, target: id, sourceHandle: null, targetHandle: null })
    ids.push(id)
  })
  return ids
}

/** Models for an editing tool, real providers first. */
export const toolModels = (models: ModelInfo[], tool: string) =>
  models.filter(m => m.tool === tool && shown(m)).sort((a, b) => Number(b.available) - Number(a.available) || Number(a.provider === 'mock') - Number(b.provider === 'mock'))

/** Create a tool node downstream of `sourceId` and generate it. */
export function runToolNode(sourceId: string, o: { tool?: string; title: string; prompt?: string; model?: string; params?: CanvasNodeData['params']; kind?: NodeKind }) {
  const models = S().models
  const model = o.model
    ?? (o.tool ? toolModels(models, o.tool).find(m => m.available)?.id : defaultModelWithImages(models, o.kind ?? 'image'))
  if (!model) { S().notify(`No model available for ${o.tool ?? 'this tool'}`, 'error'); return }
  const src = node(sourceId)
  const [id] = addDerived(sourceId, [{ kind: o.kind ?? 'image', title: o.title, data: { tool: o.tool, model, prompt: o.prompt ?? '', params: { aspect: src?.data.params.aspect, ...o.params } } }])
  if (id) S().generate(id)
  return id
}

export async function videoOp(body: Record<string, unknown>) {
  const res = await fetch('/api/ops/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, projectId: S().projectId }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `ffmpeg op failed (${res.status})`)
  return data as { assets: Asset[]; cuts?: number[]; duration?: number }
}

export type { CanvasNode }
