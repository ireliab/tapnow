import type { XYPosition } from '@xyflow/react'
import { nodeValue } from './graph'
import { combinedNodes, useStore, type ResultMode } from './store'
import { newClip } from './playlist'
import { defaultModel, NODE_WIDTH } from './store'
import type { AnyNode, CanvasEdge, CanvasNode, CommentData, ExtraNode, GroupNode, Output, PlaylistClip, PlaylistNode, StackNode, Template, TemplateNode } from './types'

/**
 * Canvas organisation actions (TapNow "Organize your canvas" / "Stack nodes" / groups /
 * comments / pins / copy-paste / batch download). They work on the zustand store directly.
 */
const S = () => useStore.getState()
const uid = () => Math.random().toString(36).slice(2, 10)
const MAX_STACK = 50
export const PIN_COLORS = ['#ff5d6c', '#f5b94a', '#2fc2a0', '#5b8cff', '#b36bff']
export const GROUP_COLORS = ['#7c6cff', '#5b8cff', '#2fc2a0', '#f5b94a', '#ff5d6c', '#8b8b95']

const all = () => combinedNodes(S().nodes, S().extras)
export const selected = () => all().filter(n => n.selected)
const size = (n: AnyNode) => ({ w: n.measured?.width ?? n.width ?? 300, h: n.measured?.height ?? n.height ?? 240 })
function absPos(n: AnyNode): XYPosition {
  const p = n.parentId ? all().find(x => x.id === n.parentId) : undefined
  return p ? { x: n.position.x + p.position.x, y: n.position.y + p.position.y } : n.position
}
function commit(patch: { nodes?: CanvasNode[]; extras?: ExtraNode[]; edges?: CanvasEdge[] }) {
  S().checkpoint()
  useStore.setState({ ...patch, dirty: true })
}

// ---------- groups ----------
export function createGroup(ids: string[]) {
  const items = all().filter(n => ids.includes(n.id) && n.type !== 'group' && !n.parentId && !n.hidden)
  if (!items.length) return
  const boxes = items.map(n => ({ ...absPos(n), ...size(n) }))
  const x = Math.min(...boxes.map(b => b.x)) - 40, y = Math.min(...boxes.map(b => b.y)) - 70
  const w = Math.max(...boxes.map(b => b.x + b.w)) - x + 40, h = Math.max(...boxes.map(b => b.y + b.h)) - y + 40
  const g: GroupNode = {
    id: `group-${uid()}`, type: 'group', position: { x, y }, width: w, height: h, zIndex: -1,
    data: { title: 'Group', color: GROUP_COLORS[S().extras.filter(e => e.type === 'group').length % GROUP_COLORS.length] }, selected: true,
  }
  const reparent = <T extends AnyNode>(n: T): T => (items.some(i => i.id === n.id) ? { ...n, parentId: g.id, position: { x: n.position.x - x, y: n.position.y - y }, selected: false } : { ...n, selected: false })
  commit({ extras: [g, ...S().extras.map(reparent)], nodes: S().nodes.map(reparent) })
}

export function ungroup(groupId: string) {
  const g = S().extras.find(e => e.id === groupId)
  if (!g) return
  const free = <T extends AnyNode>(n: T): T => (n.parentId === groupId ? { ...n, parentId: undefined, position: { x: n.position.x + g.position.x, y: n.position.y + g.position.y } } : n)
  commit({ extras: S().extras.filter(e => e.id !== groupId).map(free), nodes: S().nodes.map(free) })
}

// ---------- stacks ----------
export function stackNodes(ids: string[]) {
  const s = S()
  const stacks = s.extras.filter((e): e is StackNode => e.type === 'stack' && ids.includes(e.id))
  const members = [...new Set([...stacks.flatMap(st => st.data.members), ...s.nodes.filter(n => ids.includes(n.id) && !n.hidden).map(n => n.id)])]
  if (members.length < 2) return s.notify('Select at least two nodes to stack', 'info')
  if (members.length > MAX_STACK) return s.notify(`A stack holds up to ${MAX_STACK} nodes`, 'error')
  const first = s.nodes.find(n => n.id === members[0]) ?? stacks[0]
  const st: StackNode = {
    id: `stack-${uid()}`, type: 'stack', position: first ? { ...first.position } : { x: 0, y: 0 }, parentId: first?.parentId, selected: true,
    data: { title: `Stack · ${members.length}`, members },
  }
  commit({
    nodes: s.nodes.map(n => (members.includes(n.id) ? { ...n, hidden: true, selected: false, data: { ...n.data, stackId: st.id } } : n)),
    extras: [...s.extras.filter(e => !stacks.includes(e as StackNode)), st],
  })
}

/** Restore members (all, or the given ones) to the canvas next to the stack. */
export function unstack(stackId: string, only?: string[]) {
  const s = S()
  const st = s.extras.find((e): e is StackNode => e.id === stackId && e.type === 'stack')
  if (!st) return
  const out = only ?? st.data.members
  const rest = st.data.members.filter(m => !out.includes(m))
  let i = 0
  commit({
    nodes: s.nodes.map(n => {
      if (!out.includes(n.id)) return n
      const pos = { x: st.position.x + (i % 4) * 340, y: st.position.y + 300 + Math.floor(i / 4) * 300 }
      i++
      return { ...n, hidden: false, parentId: st.parentId, position: pos, data: { ...n.data, stackId: undefined } }
    }),
    extras: rest.length
      ? s.extras.map(e => (e.id === stackId ? { ...st, data: { ...st.data, members: rest, title: `Stack · ${rest.length}` } } : e))
      : s.extras.filter(e => e.id !== stackId),
  })
  if (!rest.length) useStore.setState({ openStack: undefined })
}

export function addToStack(stackId: string, ids: string[]) {
  const s = S()
  const st = s.extras.find((e): e is StackNode => e.id === stackId && e.type === 'stack')
  if (!st) return
  const others = s.extras.filter((e): e is StackNode => e.type === 'stack' && ids.includes(e.id) && e.id !== stackId)
  const add = [...s.nodes.filter(n => ids.includes(n.id) && !n.hidden).map(n => n.id), ...others.flatMap(o => o.data.members)]
  const members = [...new Set([...st.data.members, ...add])].slice(0, MAX_STACK)
  commit({
    nodes: s.nodes.map(n => (members.includes(n.id) ? { ...n, hidden: true, selected: false, data: { ...n.data, stackId } } : n)),
    extras: s.extras.filter(e => !others.includes(e as StackNode)).map(e => (e.id === stackId ? { ...st, data: { ...st.data, members, title: `Stack · ${members.length}` } } : e)),
  })
}

// ---------- batch results (Canvas setting: spread / stack) ----------
export function placeResults(nodeId: string, outputs: Output[], mode: ResultMode) {
  const s = S()
  const n = s.nodes.find(x => x.id === nodeId)
  if (!n || !outputs.length) return
  const { h } = size(n)
  const copies: CanvasNode[] = outputs.map((o, i) => ({
    ...n, id: `${n.data.kind}-${uid()}`, selected: false,
    position: { x: n.position.x, y: n.position.y + (h + 60) * (i + 1) },
    data: { ...n.data, title: `${n.data.title} · ${i + 2}`, outputs: [o], active: 0, status: 'done', jobId: undefined, progress: undefined },
  }))
  const edges = copies.flatMap(c => s.edges.filter(e => e.target === nodeId).map(e => ({ ...e, id: `e-${uid()}`, target: c.id })))
  useStore.setState({ nodes: [...s.nodes, ...copies], edges: [...s.edges, ...edges], dirty: true })
  if (mode === 'stack' && copies.length > 1) stackNodes(copies.map(c => c.id))
}

// ---------- comments ----------
export function addComment(at: XYPosition) {
  const c: ExtraNode = { id: `comment-${uid()}`, type: 'comment', position: at, selected: true, data: { text: '', author: 'You', at: Date.now(), replies: [] } }
  commit({ extras: [...S().extras.map(e => ({ ...e, selected: false })), c], nodes: S().nodes.map(n => ({ ...n, selected: false })) })
  useStore.setState({ commentMode: false })
}

export function updateExtra(id: string, patch: Record<string, unknown>) {
  useStore.setState(s => ({ extras: s.extras.map(e => (e.id === id ? ({ ...e, data: { ...e.data, ...patch } } as ExtraNode) : e)), dirty: true }))
}
export const removeExtra = (id: string) => S().onNodesChange([{ type: 'remove', id }])
export const commentData = (id: string) => S().extras.find(e => e.id === id)?.data as CommentData | undefined

// ---------- pins ----------
export function setPin(ids: string[], color?: string) {
  commit({ nodes: S().nodes.map(n => (ids.includes(n.id) ? { ...n, data: { ...n.data, pin: color } } : n)) })
}

// ---------- navigation ----------
export function focusNode(id: string) {
  const s = S()
  const n = s.nodes.find(x => x.id === id)
  const target = n?.hidden && n.data.stackId ? n.data.stackId : id
  useStore.setState({
    nodes: s.nodes.map(x => ({ ...x, selected: x.id === target })),
    extras: s.extras.map(x => ({ ...x, selected: x.id === target })),
    ...(n?.hidden && n.data.stackId ? { openStack: n.data.stackId } : {}),
  })
  s.rf?.fitView({ nodes: [{ id: target }], duration: 450, maxZoom: 1.1, padding: 0.4 })
}

// ---------- copy / paste ----------
const MARK = 'taplocal/nodes+json:'
export function copySelection(): string | null {
  const s = S()
  const nodes = s.nodes.filter(n => n.selected && !n.hidden)
  if (!nodes.length) return null
  const ids = new Set(nodes.map(n => n.id))
  const edges = s.edges.filter(e => ids.has(e.source) && ids.has(e.target))
  return MARK + JSON.stringify({ nodes: nodes.map(n => ({ ...n, position: absPos(n), parentId: undefined })), edges })
}
export function pasteNodes(text: string, at?: XYPosition): boolean {
  if (!text.startsWith(MARK)) return false
  const { nodes, edges } = JSON.parse(text.slice(MARK.length)) as { nodes: CanvasNode[]; edges: CanvasEdge[] }
  if (!nodes.length) return true
  const minX = Math.min(...nodes.map(n => n.position.x)), minY = Math.min(...nodes.map(n => n.position.y))
  const origin = at ?? { x: minX + 60, y: minY + 60 }
  const map = new Map<string, string>()
  const copies = nodes.map(n => {
    const id = `${n.data.kind}-${uid()}`
    map.set(n.id, id)
    return { ...n, id, selected: true, position: { x: origin.x + n.position.x - minX, y: origin.y + n.position.y - minY }, data: { ...n.data, status: n.data.outputs.length ? 'done' as const : 'idle' as const, jobId: undefined, stackId: undefined } }
  })
  const newEdges = edges.map(e => ({ ...e, id: `e-${uid()}`, source: map.get(e.source)!, target: map.get(e.target)! }))
  commit({ nodes: [...S().nodes.map(n => ({ ...n, selected: false })), ...copies], edges: [...S().edges, ...newEdges] })
  return true
}

// ---------- batch download ----------
/** Media files behind a selection (stacks and first-level group members included). */
export function mediaFiles(ids: string[]) {
  const s = S()
  const want = new Set<string>()
  for (const id of ids) {
    const x = all().find(n => n.id === id)
    if (!x) continue
    if (x.type === 'stack') (x as StackNode).data.members.forEach(m => want.add(m))
    else if (x.type === 'group') all().filter(n => n.parentId === id).forEach(n => (n.type === 'stack' ? (n as StackNode).data.members.forEach(m => want.add(m)) : want.add(n.id)))
    else want.add(id)
  }
  return s.nodes.filter(n => want.has(n.id) && n.data.kind !== 'text').flatMap(n => {
    const v = nodeValue(n)
    return v ? [{ url: v.value, name: n.data.title }] : []
  })
}

export async function downloadZip(ids: string[], name = S().projectName) {
  const files = mediaFiles(ids)
  if (!files.length) return S().notify('Nothing to download — select generated or uploaded media', 'info')
  const res = await fetch('/api/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, files }) })
  if (!res.ok) return S().notify((await res.json().catch(() => ({}))).error ?? 'Download failed', 'error')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = `${name.replace(/[^\w .-]+/g, '_') || 'taplocal'}.zip`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  S().notify(`Downloading ${files.length} file${files.length > 1 ? 's' : ''}`)
}

// ---------- playlists ----------
const playable = (ids: string[]) => ids.filter(id => ['video', 'image'].includes(S().nodes.find(n => n.id === id)?.data.kind ?? ''))
export const playlists = () => S().extras.filter((e): e is PlaylistNode => e.type === 'playlist')

/** New Playlist node from nodes (ordered left→right, top→bottom), placed below them. */
export function createPlaylist(ids: string[], title?: string) {
  const s = S()
  const nodes = s.nodes.filter(n => playable(ids).includes(n.id)).map(n => ({ n, p: absPos(n) }))
    .sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y)
  const below = nodes.length ? { x: Math.min(...nodes.map(x => x.p.x)), y: Math.max(...nodes.map(x => x.p.y + size(x.n).h)) + 80 }
    : s.rf?.screenToFlowPosition({ x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 80 }) ?? { x: 0, y: 0 }
  const pl: PlaylistNode = {
    id: `playlist-${uid()}`, type: 'playlist', position: below, selected: true,
    data: { title: title ?? `Playlist ${playlists().length + 1}`, clips: nodes.map(x => newClip(x.n.id)) },
  }
  commit({ extras: [...s.extras.map(e => ({ ...e, selected: false })), pl], nodes: s.nodes.map(n => ({ ...n, selected: false })) })
  useStore.setState({ activePlaylist: pl.id })
  return pl.id
}

/** Append clips to a playlist (the active or first one; created when there is none). */
export function appendToPlaylist(ids: string[], playlistId?: string) {
  const ok = playable(ids)
  if (!ok.length) return undefined
  const target = playlists().find(p => p.id === (playlistId ?? S().activePlaylist)) ?? playlists()[0]
  if (!target) return createPlaylist(ok)
  setClips(target.id, [...target.data.clips, ...ok.map(newClip)])
  useStore.setState({ activePlaylist: target.id })
  return target.id
}

export function setClips(playlistId: string, clips: PlaylistClip[]) {
  useStore.setState(s => ({ extras: s.extras.map(e => (e.id === playlistId && e.type === 'playlist' ? { ...e, data: { ...e.data, clips } } : e)), dirty: true }))
}

// ---------- templates ----------
/** Add a template's nodes at the viewport centre (never replaces the canvas). */
export function applyTemplate(t: Template) {
  const s = S()
  const center = s.rf ? s.rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : { x: 0, y: 0 }
  const xs = t.nodes.map(n => n.x ?? 0), ys = t.nodes.map(n => n.y ?? 0)
  const w = Math.max(...xs) - Math.min(...xs) + 360, h = Math.max(...ys) - Math.min(...ys) + 300
  const origin = { x: center.x - w / 2 - Math.min(...xs), y: center.y - h / 2 - Math.min(...ys) }
  const ids: Record<string, string> = {}
  const nodes: CanvasNode[] = t.nodes.map((tn, i) => {
    const id = `${tn.kind}-${uid()}`
    ids[tn.ref] = id
    const model = tn.model && s.models.some(m => m.id === tn.model && m.available) ? tn.model : defaultModel(s.models, tn.kind)
    return {
      id, type: 'canvas', position: { x: origin.x + (tn.x ?? i * 380), y: origin.y + (tn.y ?? 0) }, width: NODE_WIDTH[tn.kind], selected: true,
      data: {
        kind: tn.kind, title: tn.title ?? tn.kind, prompt: tn.prompt ?? '', model,
        params: { ...(tn.kind === 'video' ? { aspect: '16:9', duration: 5 } : tn.kind === 'image' ? { aspect: '16:9' } : {}), ...tn.params },
        outputs: tn.outputs ?? [], active: Math.max(0, (tn.outputs?.length ?? 1) - 1), status: tn.outputs?.length ? 'done' : 'idle',
      },
    }
  })
  const edges = t.edges.filter(e => ids[e.from] && ids[e.to]).map(e => ({ id: `e-${uid()}`, source: ids[e.from], target: ids[e.to] }))
  commit({ nodes: [...s.nodes.map(n => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges] })
  requestAnimationFrame(() => S().rf?.fitView({ nodes: nodes.map(n => ({ id: n.id })), padding: 0.2, duration: 500 }))
  s.notify(`Added "${t.name}" — ${nodes.length} nodes`)
}

/** Selected media nodes (+ their connections) as a template. */
export function selectionAsTemplate(ids: string[], includeOutputs: boolean): Pick<Template, 'nodes' | 'edges'> {
  const s = S()
  const nodes = s.nodes.filter(n => ids.includes(n.id) && !n.hidden)
  const pos = new Map(nodes.map(n => [n.id, absPos(n)]))
  const minX = Math.min(...[...pos.values()].map(p => p.x)), minY = Math.min(...[...pos.values()].map(p => p.y))
  const tnodes: TemplateNode[] = nodes.map((n, i) => ({
    ref: `n${i}`, kind: n.data.kind, title: n.data.title, prompt: n.data.prompt, model: n.data.model,
    params: { ...n.data.params, mask: undefined }, x: pos.get(n.id)!.x - minX, y: pos.get(n.id)!.y - minY,
    ...(includeOutputs && n.data.outputs.length ? { outputs: [n.data.outputs[n.data.active] ?? n.data.outputs.at(-1)!] } : {}),
  }))
  const ref = new Map(nodes.map((n, i) => [n.id, `n${i}`]))
  const edges = s.edges.filter(e => ref.has(e.source) && ref.has(e.target)).map(e => ({ from: ref.get(e.source)!, to: ref.get(e.target)! }))
  return { nodes: tnodes, edges }
}
