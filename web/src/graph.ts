import type { CanvasEdge, CanvasNode, NodeKind, Output } from './types'

export const activeOutput = (n: CanvasNode): Output | undefined => n.data.outputs[n.data.active] ?? n.data.outputs.at(-1)

/** What a node's downstream neighbours receive from it. */
export function nodeValue(n: CanvasNode): { kind: NodeKind; value: string } | undefined {
  if (n.data.kind === 'text') return n.data.prompt.trim() ? { kind: 'text', value: n.data.prompt.trim() } : undefined
  const o = activeOutput(n)
  return o?.url ? { kind: n.data.kind, value: o.url } : undefined
}

/** Upstream nodes of `nodeId`, ordered top-to-bottom so "first frame / last frame" follows the layout. */
export function upstreamOf(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges.filter(e => e.target === nodeId).map(e => byId.get(e.source)).filter((n): n is CanvasNode => !!n)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
}

/**
 * Collect upstream inputs for a node. Sources are ordered top-to-bottom on the
 * canvas so "first frame / last frame" follows the visual layout.
 */
export function resolveInputs(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const inputs = { texts: [] as string[], images: [] as string[], videos: [] as string[], audios: [] as string[] }
  for (const s of upstreamOf(nodeId, nodes, edges)) {
    const v = nodeValue(s)
    if (!v) continue
    ;({ text: inputs.texts, image: inputs.images, video: inputs.videos, audio: inputs.audios })[v.kind].push(v.value)
  }
  return inputs
}

type Inputs = ReturnType<typeof resolveInputs>

/**
 * Resolve `@Title` mentions of upstream nodes in a prompt (TapNow-style references):
 * mentioned media come first in their input list, in mention order, and the mention
 * becomes "image 1" / "video 1" / "audio 1"; a mentioned text node is inlined in place
 * (and not prepended again).
 */
export function expandMentions(prompt: string, sources: CanvasNode[], inputs: Inputs): { prompt: string; inputs: Inputs } {
  // longest titles claim their text first, so "@Hero" is not found inside "@Hero 2"
  const claimed: Array<[number, number]> = []
  const firstAt = (token: string) => {
    let at = -1
    for (let i = prompt.indexOf(token); i >= 0; i = prompt.indexOf(token, i + 1)) {
      if (claimed.some(([s, e]) => i < e && i + token.length > s)) continue
      claimed.push([i, i + token.length])
      if (at < 0) at = i
    }
    return at
  }
  const found = [...sources].sort((a, b) => b.data.title.length - a.data.title.length)
    .map(n => ({ n, at: firstAt(`@${n.data.title}`), v: nodeValue(n) }))
    .filter(x => x.at >= 0 && x.v)
    .sort((a, b) => a.at - b.at)
  if (!found.length) return { prompt, inputs }
  const out: Inputs = { texts: [...inputs.texts], images: [...inputs.images], videos: [...inputs.videos], audios: [...inputs.audios] }
  const lists = { image: out.images, video: out.videos, audio: out.audios } as const
  // move mentioned media to the front, preserving mention order
  for (const kind of ['image', 'video', 'audio'] as const) {
    const ment = found.filter(f => f.v!.kind === kind).map(f => f.v!.value)
    const rest = lists[kind].filter(u => !ment.includes(u))
    lists[kind].splice(0, lists[kind].length, ...ment, ...rest)
  }
  let text = prompt
  // longest titles first so "@Shot 10" is not eaten by "@Shot 1"
  for (const f of [...found].sort((a, b) => b.n.data.title.length - a.n.data.title.length)) {
    const kind = f.v!.kind
    const label = kind === 'text' ? `"${f.v!.value}"` : `${kind} ${(lists[kind as 'image' | 'video' | 'audio'].indexOf(f.v!.value)) + 1}`
    text = text.split(`@${f.n.data.title}`).join(label)
    if (kind === 'text') out.texts = out.texts.filter(t => t !== f.v!.value)
  }
  return { prompt: text, inputs: out }
}

/** Copy of `nodes` with positions made absolute (children of groups are stored relative to the group). */
export function absolutize<T extends { id: string; position: { x: number; y: number }; parentId?: string }>(nodes: T[], parents: Array<{ id: string; position: { x: number; y: number } }>): T[] {
  const byId = new Map(parents.map(p => [p.id, p]))
  return nodes.map(n => {
    const p = n.parentId ? byId.get(n.parentId) : undefined
    return p ? { ...n, position: { x: n.position.x + p.position.x, y: n.position.y + p.position.y } } : n
  })
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
