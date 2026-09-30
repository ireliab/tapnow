import type { CanvasEdge, CanvasNode, NodeKind, Output } from './types'

export const activeOutput = (n: CanvasNode): Output | undefined => n.data.outputs[n.data.active] ?? n.data.outputs.at(-1)

/** What a node's downstream neighbours receive from it. */
export function nodeValue(n: CanvasNode): { kind: NodeKind; value: string } | undefined {
  if (n.data.kind === 'text') return n.data.prompt.trim() ? { kind: 'text', value: n.data.prompt.trim() } : undefined
  const o = activeOutput(n)
  return o?.url ? { kind: n.data.kind, value: o.url } : undefined
}

/**
 * Collect upstream inputs for a node. Sources are ordered top-to-bottom on the
 * canvas so "first frame / last frame" follows the visual layout.
 */
export function resolveInputs(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const sources = edges.filter(e => e.target === nodeId).map(e => byId.get(e.source)).filter((n): n is CanvasNode => !!n)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const inputs = { texts: [] as string[], images: [] as string[], videos: [] as string[], audios: [] as string[] }
  for (const s of sources) {
    const v = nodeValue(s)
    if (!v) continue
    ;({ text: inputs.texts, image: inputs.images, video: inputs.videos, audio: inputs.audios })[v.kind].push(v.value)
  }
  return inputs
}

/** Upstream nodes that are generative but have no output yet. */
export function missingUpstream(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges.filter(e => e.target === nodeId).map(e => byId.get(e.source)!).filter(n => n && !nodeValue(n))
}

/** Kahn topological sort; nodes in cycles are appended at the end. */
export function topoOrder(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const indeg = new Map(nodes.map(n => [n.id, 0]))
  for (const e of edges) if (indeg.has(e.target) && indeg.has(e.source)) indeg.set(e.target, indeg.get(e.target)! + 1)
  const ready = nodes.filter(n => indeg.get(n.id) === 0).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
  const out: CanvasNode[] = []
  const byId = new Map(nodes.map(n => [n.id, n]))
  while (ready.length) {
    const n = ready.shift()!
    out.push(n)
    for (const e of edges.filter(e => e.source === n.id)) {
      const d = indeg.get(e.target)! - 1
      indeg.set(e.target, d)
      if (d === 0 && byId.has(e.target)) ready.push(byId.get(e.target)!)
    }
  }
  return [...out, ...nodes.filter(n => !out.includes(n))]
}

/** Which node kinds may feed into which. */
const ACCEPTS: Record<NodeKind, NodeKind[]> = {
  text: ['text', 'image'],
  image: ['text', 'image'],
  video: ['text', 'image', 'video', 'audio'],
  audio: ['text'],
}
export const canConnect = (from: NodeKind, to: NodeKind) => ACCEPTS[to].includes(from)

/** Plain-text summary of the canvas for the agent. */
export function summarize(nodes: CanvasNode[], edges: CanvasEdge[]) {
  return nodes.map(n => {
    const ins = edges.filter(e => e.target === n.id).map(e => e.source)
    return `- ${n.id} [${n.data.kind}] "${n.data.title}": ${n.data.prompt.slice(0, 120) || '(empty)'}${ins.length ? ` <- ${ins.join(', ')}` : ''}${n.data.outputs.length ? ` (${n.data.outputs.length} outputs)` : ''}`
  }).join('\n')
}
