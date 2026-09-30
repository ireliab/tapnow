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

/**
 * Lay out a batch of new nodes as a left-to-right DAG: column = depth among the
 * new nodes, a child shares its first parent's row when free, and a parent with
 * several children is centred on them. Returns top-left positions per ref.
 */
export function layoutBatch(
  specs: Array<{ ref: string }>, edges: Array<{ from: string; to: string }>,
  origin: { x: number; y: number }, gap = { col: 420, row: 320 },
) {
  const refs = new Set(specs.map(s => s.ref))
  const parents = new Map(specs.map(s => [s.ref, edges.filter(e => e.to === s.ref && refs.has(e.from)).map(e => e.from)]))
  const col = new Map<string, number>()
  const colOf = (r: string, seen = new Set<string>()): number => {
    if (col.has(r)) return col.get(r)!
    if (seen.has(r)) return 0
    seen.add(r)
    const ps = parents.get(r) ?? []
    const c = ps.length ? Math.max(...ps.map(p => colOf(p, seen))) + 1 : 0
    col.set(r, c)
    return c
  }
  specs.forEach(s => colOf(s.ref))
  const ordered = [...specs].sort((a, b) => col.get(a.ref)! - col.get(b.ref)!)
  const row = new Map<string, number>()
  const nextFree: number[] = []
  for (const s of ordered) {
    const c = col.get(s.ref)!
    const p = parents.get(s.ref)?.[0]
    const r = Math.max(p !== undefined ? row.get(p) ?? 0 : 0, nextFree[c] ?? 0)
    row.set(s.ref, r)
    nextFree[c] = r + 1
  }
  // centre parents over their children (deepest columns first)
  for (const s of [...ordered].reverse()) {
    const kids = specs.filter(k => parents.get(k.ref)?.includes(s.ref)).map(k => row.get(k.ref)!)
    if (kids.length > 1) row.set(s.ref, kids.reduce((a, b) => a + b, 0) / kids.length)
  }
  return Object.fromEntries(specs.map(s => [s.ref, { x: origin.x + col.get(s.ref)! * gap.col, y: origin.y + row.get(s.ref)! * gap.row }]))
}

/** Every upstream node of `ids` (transitively), excluding `ids` themselves. */
export function ancestors(ids: string[], edges: CanvasEdge[]) {
  const out = new Set<string>()
  const stack = [...ids]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of edges) if (e.target === id && !out.has(e.source) && !ids.includes(e.source)) { out.add(e.source); stack.push(e.source) }
  }
  return out
}
