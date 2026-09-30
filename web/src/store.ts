import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type ReactFlowInstance, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { api } from './api'
import { absolutize, ancestors, canConnect, expandElements, expandMentions, layoutBatch, nodeValue, resolveInputs, missingUpstream, topoOrder, upstreamOf } from './graph'
import { appendToPlaylist, placeResults } from './canvasOps'
import type { AnyNode, Asset, ElementItem, CanvasEdge, CanvasNode, CanvasNodeData, ExtraNode, Job, ModelInfo, NodeKind, NodeParams, Output, StackNode, TimelineClip } from './types'

const uid = () => Math.random().toString(36).slice(2, 10)

export const NODE_WIDTH: Record<NodeKind, number> = { text: 280, image: 300, video: 360, audio: 280 }
export const KIND_LABEL: Record<NodeKind, string> = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio' }

export interface BatchNode { ref: string; kind: NodeKind; title?: string; prompt?: string; model?: string; params?: NodeParams }

type Snapshot = { nodes: CanvasNode[]; edges: CanvasEdge[]; timeline: TimelineClip[]; extras: ExtraNode[] }
export type ResultMode = 'history' | 'spread' | 'stack'
export interface CanvasSettings { resultMode: ResultMode; snapToGrid: boolean }
const loadCanvasSettings = (): CanvasSettings => {
  try { return { resultMode: 'history', snapToGrid: false, ...JSON.parse(localStorage.getItem('taplocal:canvas') ?? '{}') } } catch { return { resultMode: 'history', snapToGrid: false } }
}

/** React Flow needs parents before children, so groups go first. */
export const combinedNodes = (nodes: CanvasNode[], extras: ExtraNode[]): AnyNode[] =>
  [...extras.filter(x => x.type === 'group'), ...nodes, ...extras.filter(x => x.type !== 'group')]
type Panel = 'agent' | 'assets' | 'jobs' | null
export type AddMenu = { screen: XYPosition; flow: XYPosition; fromNodeIds?: string[] } | null

interface State {
  projectId?: string
  projectName: string
  nodes: CanvasNode[]
  /** groups, stacks, comments, playlists */
  extras: ExtraNode[]
  edges: CanvasEdge[]
  timeline: TimelineClip[]
  models: ModelInfo[]
  rf?: ReactFlowInstance<AnyNode, CanvasEdge>
  canvasSettings: CanvasSettings
  commentMode: boolean
  searchOpen: boolean
  /** stack whose gallery is open */
  openStack?: string
  /** playlist shown in the bottom editor */
  activePlaylist?: string
  /** library elements (reusable character / product references, used as @Name) */
  elements: ElementItem[]
  /** shared view-only link (?view=1): nothing can be edited */
  readOnly: boolean
  shortcutsOpen: boolean
  /** hold-V voice input is recording */
  listening: boolean
  panel: Panel
  settingsOpen: boolean
  projectsOpen: boolean
  lightbox?: Output
  addMenu: AddMenu
  dirty: boolean
  saving: boolean
  runningAll: boolean
  toast?: { text: string; kind?: 'error' | 'info' }
  past: Snapshot[]
  future: Snapshot[]
}

interface Actions {
  set: (patch: Partial<State>) => void
  notify: (text: string, kind?: 'error' | 'info') => void
  loadModels: () => Promise<void>
  loadElements: () => Promise<void>
  openProject: (id?: string) => Promise<void>
  save: () => Promise<void>
  checkpoint: () => void
  undo: () => void
  redo: () => void
  onNodesChange: (c: NodeChange<AnyNode>[]) => void
  onEdgesChange: (c: EdgeChange<CanvasEdge>[]) => void
  onConnect: (c: Connection) => void
  isValidConnection: (c: Connection | CanvasEdge) => boolean
  addNode: (kind: NodeKind, pos?: XYPosition, patch?: Partial<CanvasNodeData>) => string
  addAssetNode: (asset: Asset, pos?: XYPosition) => string
  updateData: (id: string, patch: Partial<CanvasNodeData>) => void
  removeNode: (id: string) => void
  duplicate: (ids: string[]) => void
  generate: (id: string) => Promise<void>
  generateAndWait: (id: string) => Promise<boolean>
  cancel: (id: string) => void
  runAll: (onlyMissing?: boolean) => Promise<void>
  runNodes: (ids: string[]) => Promise<Array<{ id: string; title: string; status: string; output?: string; error?: string }>>
  addNodesBatch: (specs: BatchNode[], edges: Array<{ from: string; to: string }>) => { created: Record<string, string>; skipped: string[] }
  stopAll: () => void
  handleJob: (job: Job) => void
  mergeServerNodes: (projectId: string, nodes: CanvasNode[]) => void
  addToTimeline: (nodeId: string) => void
  moveClip: (id: string, dir: -1 | 1) => void
  removeClip: (id: string) => void
}

/** Default model for a node that has image inputs: prefer one that accepts reference images / first frames. */
// generation models only — editing tools (upscale, cutout, …) and lip-sync are never a node's default
const plain = (m: ModelInfo, kind: NodeKind) => m.kind === kind && m.available && !m.tool && !m.needs?.length && (kind !== 'audio' || !m.audioMode || m.audioMode === 'speech')

export const defaultModelWithImages = (models: ModelInfo[], kind: NodeKind) =>
  (models.find(m => plain(m, kind) && m.provider !== 'mock' && m.maxImages > 0)
    ?? models.find(m => plain(m, kind) && m.maxImages > 0))?.id ?? defaultModel(models, kind)

export const defaultModel = (models: ModelInfo[], kind: NodeKind) =>
  (models.find(m => plain(m, kind) && m.provider !== 'mock' && !m.requiresImage) ?? models.find(m => plain(m, kind)))?.id ?? `mock-${kind}`

const waiters = new Map<string, (ok: boolean) => void>()
let stopRequested = false

export const useStore = create<State & Actions>((set, get) => ({
  projectName: 'Untitled',
  nodes: [], extras: [], edges: [], timeline: [], models: [],
  canvasSettings: loadCanvasSettings(), commentMode: false, searchOpen: false, elements: [], shortcutsOpen: false, listening: false,
  readOnly: typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === '1',
  panel: null, settingsOpen: false, projectsOpen: false, addMenu: null,
  dirty: false, saving: false, runningAll: false, past: [], future: [],

  set: patch => set(patch),
  notify(text, kind = 'info') {
    set({ toast: { text, kind } })
    setTimeout(() => { if (get().toast?.text === text) set({ toast: undefined }) }, kind === 'error' ? 6000 : 3000)
  },

  async loadModels() { set({ models: await api.models() }) },
  async loadElements() { set({ elements: await api.elements() }) },

  async openProject(id) {
    let list = id ? null : await api.projects()
    const p = id ? await api.project(id) : list![0] ? await api.project(list![0].id) : await api.createProject('My first project')
    // never restore a transient running state from disk
    const nodes = p.nodes.map(n => n.data.status === 'queued' || n.data.status === 'running'
      ? { ...n, data: { ...n.data, status: 'idle' as const, progress: undefined, jobId: undefined } } : n)
    let extras: ExtraNode[] = p.extras ?? []
    if (p.timeline?.length && !extras.some(e => e.type === 'playlist')) {
      const firstClip = nodes.find(n => n.id === p.timeline[0].nodeId)
      extras = [...extras, {
        id: `playlist-${uid()}`, type: 'playlist', position: firstClip ? { x: firstClip.position.x, y: Math.max(...nodes.map(n => n.position.y)) + 420 } : { x: 0, y: 0 },
        data: { title: 'Playlist', clips: p.timeline.map(c => ({ id: c.id, nodeId: c.nodeId, in: 0 })) },
      }]
    }
    set({ projectId: p.id, projectName: p.name, nodes, extras, edges: p.edges, timeline: [], past: [], future: [], dirty: false, projectsOpen: false, openStack: undefined, activePlaylist: extras.find(e => e.type === 'playlist')?.id })
    if (!get().readOnly) localStorage.setItem('taplocal:project', p.id)
    requestAnimationFrame(() => {
      const rf = get().rf
      if (!rf) return
      if (p.viewport) rf.setViewport(p.viewport)
      else if (nodes.length) rf.fitView({ padding: 0.2 })
    })
  },

  async save() {
    const s = get()
    if (!s.projectId || s.readOnly) return
    set({ saving: true })
    try {
      await api.saveProject({ id: s.projectId, name: s.projectName, updatedAt: Date.now(), nodes: s.nodes, extras: s.extras, edges: s.edges, timeline: s.timeline, viewport: s.rf?.getViewport() })
      set({ dirty: false })
    } catch (e: any) { get().notify(`Save failed: ${e.message}`, 'error') }
    finally { set({ saving: false }) }
  },

  checkpoint() {
    const { nodes, edges, timeline, extras, past } = get()
    set({ past: [...past.slice(-49), { nodes, edges, timeline, extras }], future: [] })
  },
  undo() {
    const { past, future, nodes, edges, timeline, extras } = get()
    const prev = past.at(-1)
    if (!prev) return
    set({ ...prev, past: past.slice(0, -1), future: [{ nodes, edges, timeline, extras }, ...future], dirty: true })
  },
  redo() {
    const { past, future, nodes, edges, timeline, extras } = get()
    const next = future[0]
    if (!next) return
    set({ ...next, future: future.slice(1), past: [...past, { nodes, edges, timeline, extras }], dirty: true })
  },

  onNodesChange(changes) {
    const s = get()
    const removed = new Set(changes.flatMap(c => (c.type === 'remove' ? [c.id] : [])))
    if (removed.size) get().checkpoint()
    const structural = changes.some(c => c.type !== 'select' && c.type !== 'dimensions')
    const prevAll = combinedNodes(s.nodes, s.extras)
    const byId = new Map(prevAll.map(n => [n.id, n]))
    const groupsRemoved = new Set(s.extras.filter(x => x.type === 'group' && removed.has(x.id)).map(x => x.id))
    const stacksRemoved = s.extras.filter((x): x is StackNode => x.type === 'stack' && removed.has(x.id))
    // removing a group keeps its content: drop the auto-added child removals (unless the child itself was selected)
    const effective = changes.filter(c => {
      if (c.type !== 'remove') return true
      const n = byId.get(c.id)
      return !(n?.parentId && groupsRemoved.has(n.parentId) && !n.selected)
    })
    const all = applyNodeChanges(effective, prevAll)
    let nodes = all.filter((n): n is CanvasNode => n.type === 'canvas')
    let extras = all.filter((n): n is ExtraNode => n.type !== 'canvas')
    // unparent survivors of removed groups (positions become absolute)
    nodes = nodes.map(n => {
      if (!n.parentId || !groupsRemoved.has(n.parentId)) return n
      const g = byId.get(n.parentId)!
      return { ...n, parentId: undefined, position: { x: n.position.x + g.position.x, y: n.position.y + g.position.y } }
    })
    // removing a stack removes everything in it (as in TapNow)
    const gone = new Set(stacksRemoved.flatMap(st => st.data.members))
    for (const c of effective) if (c.type === 'remove') gone.add(c.id)
    nodes = nodes.filter(n => !gone.has(n.id))
    // drop deleted members from surviving stacks; an empty stack dissolves
    extras = extras.map(x => (x.type === 'stack' && x.data.members.some(m => gone.has(m)) ? { ...x, data: { ...x.data, members: x.data.members.filter(m => !gone.has(m)) } } : x))
      .filter(x => x.type !== 'stack' || x.data.members.length > 0)
      .map(x => (x.type === 'playlist' && x.data.clips.some(c => gone.has(c.nodeId)) ? { ...x, data: { ...x.data, clips: x.data.clips.filter(c => !gone.has(c.nodeId)) } } : x))
    const alive = new Set(nodes.map(n => n.id))
    set({
      nodes, extras,
      edges: gone.size ? s.edges.filter(e => alive.has(e.source) && alive.has(e.target)) : s.edges,
      timeline: s.timeline.filter(c => alive.has(c.nodeId)), dirty: s.dirty || structural,
    })
  },
  onEdgesChange(changes) {
    if (changes.some(c => c.type === 'remove')) get().checkpoint()
    set(s => ({ edges: applyEdgeChanges(changes, s.edges), dirty: s.dirty || changes.some(c => c.type !== 'select') }))
  },
  onConnect(c) {
    if (!get().isValidConnection(c)) return
    get().checkpoint()
    set(s => ({ edges: addEdge({ ...c, id: `e-${uid()}` }, s.edges), dirty: true }))
  },
  isValidConnection(c) {
    const { nodes, edges } = get()
    const a = nodes.find(n => n.id === c.source), b = nodes.find(n => n.id === c.target)
    if (!a || !b || a.id === b.id) return false
    if (edges.some(e => e.source === a.id && e.target === b.id)) return false
    return canConnect(a.data.kind, b.data.kind)
  },

  addNode(kind, pos, patch) {
    const { rf, models } = get()
    const center = rf ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : { x: 0, y: 0 }
    const position = pos ?? { x: center.x - NODE_WIDTH[kind] / 2 + (Math.random() - 0.5) * 60, y: center.y - 120 + (Math.random() - 0.5) * 60 }
    const id = `${kind}-${uid()}`
    const count = get().nodes.filter(n => n.data.kind === kind).length + 1
    const node: CanvasNode = {
      id, type: 'canvas', position, width: NODE_WIDTH[kind],
      data: {
        kind, title: `${KIND_LABEL[kind]} ${count}`, prompt: '', model: defaultModel(models, kind),
        params: kind === 'video' ? { aspect: '16:9', duration: 5 } : kind === 'image' ? { aspect: '16:9' } : {},
        outputs: [], active: 0, status: 'idle', ...patch,
      },
    }
    get().checkpoint()
    set(s => ({ nodes: [...s.nodes.map(n => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }], dirty: true }))
    return id
  },

  addAssetNode(asset, pos) {
    const output: Output = { id: asset.id, kind: asset.kind, url: asset.url, mime: asset.mime, prompt: asset.prompt, model: asset.model, createdAt: asset.createdAt }
    const title = asset.name?.replace(/\.[^.]+$/, '').slice(0, 30)
    return get().addNode(asset.kind, pos, { ...(title ? { title } : {}), outputs: [output], status: 'done', prompt: asset.prompt ?? '' })
  },

  updateData(id, patch) {
    set(s => ({ nodes: s.nodes.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), dirty: true }))
  },

  removeNode(id) {
    get().onNodesChange([{ type: 'remove', id }])
  },

  duplicate(ids) {
    const { nodes, edges } = get()
    const map = new Map<string, string>()
    const copies = nodes.filter(n => ids.includes(n.id)).map(n => {
      const id = `${n.data.kind}-${uid()}`
      map.set(n.id, id)
      return { ...n, id, selected: true, position: { x: n.position.x + 40, y: n.position.y + 40 }, data: { ...n.data, status: 'idle' as const, jobId: undefined, title: `${n.data.title} copy` } }
    })
    if (!copies.length) return
    const newEdges = edges.filter(e => map.has(e.source) && map.has(e.target)).map(e => ({ ...e, id: `e-${uid()}`, source: map.get(e.source)!, target: map.get(e.target)! }))
    get().checkpoint()
    set(s => ({ nodes: [...s.nodes.map(n => ({ ...n, selected: false })), ...copies], edges: [...s.edges, ...newEdges], dirty: true }))
  },

  async generate(id) {
    const { edges, projectId, extras } = get()
    // children of groups store relative positions; ordering (first/last frame) needs absolute ones
    const nodes = absolutize(get().nodes, extras)
    const n = nodes.find(x => x.id === id)
    if (!n || n.data.status === 'queued' || n.data.status === 'running') return
    const missing = missingUpstream(id, nodes, edges)
    if (missing.length) get().notify(`Upstream "${missing[0].data.title}" has no output yet — it will be ignored`, 'info')
    const mentioned = expandMentions(n.data.prompt, upstreamOf(id, nodes, edges), resolveInputs(id, nodes, edges))
    const maxImages = get().models.find(m => m.id === n.data.model)?.maxImages ?? 0
    const { prompt, inputs } = expandElements(mentioned.prompt, mentioned.inputs, get().elements, maxImages)
    if (n.data.kind !== 'text' && !prompt.trim() && !inputs.texts.length && !inputs.images.length) {
      get().notify('Write a prompt or connect an input first', 'error')
      waiters.get(id)?.(false)
      return
    }
    get().updateData(id, { status: 'queued', progress: 0, error: undefined, message: undefined })
    try {
      const job = await api.generate({ nodeId: id, projectId, kind: n.data.kind, model: n.data.model, prompt, params: n.data.params, inputs })
      // the WS "done" event can race the HTTP response — only record the job id if still pending
      const cur = get().nodes.find(x => x.id === id)
      if (cur && (cur.data.status === 'queued' || cur.data.status === 'running')) get().updateData(id, { jobId: job.id })
    } catch (e: any) {
      get().updateData(id, { status: 'error', error: e.message })
      waiters.get(id)?.(false)
    }
  },

  generateAndWait(id) {
    return new Promise<boolean>(resolve => {
      waiters.set(id, ok => { waiters.delete(id); resolve(ok) })
      get().generate(id)
    })
  },

  cancel(id) {
    const n = get().nodes.find(x => x.id === id)
    if (n?.data.jobId) api.cancel(n.data.jobId)
    get().updateData(id, { status: 'idle', progress: undefined, jobId: undefined })
    waiters.get(id)?.(false)
  },

  async runAll(onlyMissing = true) {
    const { nodes, edges } = get()
    const targets = topoOrder(nodes, edges).filter(n => n.data.kind !== 'text' && !(onlyMissing && n.data.outputs.length))
    if (!targets.length) return get().notify('Nothing to run — every node already has an output', 'info')
    const results = await get().runNodes(targets.map(t => t.id))
    const failed = results.filter(r => r.status !== 'done').length
    get().notify(stopRequested ? 'Run stopped' : failed ? `Run finished with ${failed} failed node(s)` : `Generated ${results.length} node(s)`, failed ? 'error' : 'info')
  },

  /**
   * Generate `ids`, first generating any upstream media nodes that still lack an
   * output. Independent branches run in parallel (the server caps concurrency).
   */
  async runNodes(ids) {
    const { nodes, edges } = get()
    const byId = new Map(nodes.map(n => [n.id, n]))
    const upstream = [...ancestors(ids, edges)].filter(id => { const n = byId.get(id); return n && n.data.kind !== 'text' && !nodeValue(n) })
    const targetIds = new Set([...ids.filter(id => byId.get(id)?.data.kind !== 'text'), ...upstream])
    stopRequested = false
    set({ runningAll: true })
    const memo = new Map<string, Promise<boolean>>()
    const run = (id: string): Promise<boolean> => {
      if (!memo.has(id)) {
        memo.set(id, (async () => {
          const ups = get().edges.filter(e => e.target === id).map(e => e.source).filter(s => targetIds.has(s))
          await Promise.all(ups.map(run))
          if (stopRequested) return false
          return get().generateAndWait(id)
        })())
      }
      return memo.get(id)!
    }
    await Promise.all([...targetIds].map(run))
    set({ runningAll: false })
    return ids.map(id => {
      const n = get().nodes.find(x => x.id === id)
      if (!n) return { id, title: '?', status: 'missing' }
      const v = nodeValue(n)
      return { id, title: n.data.title, status: n.data.status === 'done' ? 'done' : n.data.status, output: v?.value, error: n.data.error }
    })
  },

  addNodesBatch(specs, edgeSpecs) {
    const { nodes, rf, models } = get()
    const existing = nodes.filter(n => !n.hidden)
    const origin = existing.length
      ? { x: Math.max(...existing.map(n => n.position.x + (n.width ?? 300))) + 160, y: Math.min(...existing.map(n => n.position.y)) }
      : rf ? rf.screenToFlowPosition({ x: window.innerWidth * 0.25, y: window.innerHeight * 0.25 }) : { x: 0, y: 0 }
    const pos = layoutBatch(specs, edgeSpecs, origin)
    const created: Record<string, string> = {}
    const counts: Record<string, number> = {}
    const newNodes: CanvasNode[] = specs.map(sp => {
      const kind = sp.kind
      const id = `${kind}-${uid()}`
      created[sp.ref] = id
      counts[kind] = (counts[kind] ?? nodes.filter(n => n.data.kind === kind).length) + 1
      const model = sp.model && models.some(m => m.id === sp.model && m.kind === kind && m.available) ? sp.model : defaultModel(models, kind)
      return {
        id, type: 'canvas', position: pos[sp.ref], width: NODE_WIDTH[kind],
        data: {
          kind, title: sp.title || `${KIND_LABEL[kind]} ${counts[kind]}`, prompt: sp.prompt ?? '', model,
          params: { ...(kind === 'video' ? { aspect: '16:9', duration: 5 } : kind === 'image' ? { aspect: '16:9' } : {}), ...sp.params },
          outputs: [], active: 0, status: 'idle',
        },
      }
    })
    const all = [...nodes, ...newNodes]
    const kindOf = (id: string) => all.find(n => n.id === id)?.data.kind
    const skipped: string[] = []
    const newEdges: CanvasEdge[] = []
    for (const e of edgeSpecs) {
      const source = created[e.from] ?? e.from, target = created[e.to] ?? e.to
      const a = kindOf(source), b = kindOf(target)
      if (!a || !b || !canConnect(a, b)) { skipped.push(`${e.from}→${e.to}`); continue }
      newEdges.push({ id: `e-${uid()}`, source, target })
    }
    // nodes fed by an image get a model that actually uses it (e.g. image-to-video), unless one was chosen explicitly
    for (const n of newNodes) {
      const spec = specs.find(sp => created[sp.ref] === n.id)!
      const explicit = spec.model && n.data.model === spec.model
      const fedByImage = newEdges.some(e => e.target === n.id && kindOf(e.source) === 'image')
      if (!explicit && fedByImage && !(models.find(m => m.id === n.data.model)?.maxImages)) n.data.model = defaultModelWithImages(models, n.data.kind)
    }
    get().checkpoint()
    set(s => ({ nodes: [...s.nodes.map(n => (n.selected ? { ...n, selected: false } : n)), ...newNodes], edges: [...s.edges, ...newEdges], dirty: true }))
    requestAnimationFrame(() => get().rf?.fitView({ nodes: newNodes.map(n => ({ id: n.id })), padding: 0.15, duration: 600 }))
    return { created, skipped }
  },

  stopAll() {
    stopRequested = true
    for (const n of get().nodes) if (n.data.status === 'queued' || n.data.status === 'running') get().cancel(n.id)
  },

  handleJob(job) {
    const n = get().nodes.find(x => x.data.jobId === job.id || (x.id === job.nodeId && (x.data.status === 'queued' || x.data.status === 'running')))
    if (!n) return
    if (job.status === 'queued' || job.status === 'running') {
      get().updateData(n.id, { status: job.status, progress: job.progress, message: job.message, jobId: job.id })
      return
    }
    if (job.status === 'done' && job.result) {
      const r = job.result
      const assets = r.assets?.length ? r.assets : r.asset ? [r.asset] : []
      const media: Output[] = assets.map(a => ({ id: a.id, kind: n.data.kind, url: a.url, mime: a.mime, prompt: a.prompt, model: job.model, createdAt: Date.now() }))
      const out: Output = r.text !== undefined ? { id: job.id, kind: 'text', text: r.text, model: job.model, createdAt: Date.now() } : media[0]
      let outputs = n.data.outputs
      // text nodes: keep the pre-expansion text as the first history entry so it can be restored
      if (n.data.kind === 'text' && !outputs.length && n.data.prompt.trim())
        outputs = [{ id: uid(), kind: 'text', text: n.data.prompt, createdAt: Date.now() }]
      // batch results: keep them in this node's history, or place extras as new nodes (spread / stack)
      const mode = get().canvasSettings.resultMode
      outputs = [...outputs, ...(mode === 'history' || r.text !== undefined ? (r.text !== undefined ? [out] : media) : [out])]
      if (mode !== 'history' && media.length > 1) queueMicrotask(() => placeResults(n.id, media.slice(1), mode))
      get().updateData(n.id, {
        status: 'done', progress: 1, jobId: undefined, message: undefined, outputs, active: outputs.length - 1,
        ...(r.text !== undefined ? { prompt: r.text } : {}),
      })
      waiters.get(n.id)?.(true)
    } else {
      get().updateData(n.id, { status: job.status === 'error' ? 'error' : 'idle', error: job.error, jobId: undefined, progress: undefined })
      if (job.status === 'error') get().notify(`${n.data.title}: ${job.error}`, 'error')
      waiters.get(n.id)?.(false)
    }
  },

  /** Nodes created outside the browser (MCP agents) appear live on the open canvas. */
  mergeServerNodes(projectId, incoming) {
    if (projectId !== get().projectId || !incoming.length) return
    set(s => {
      const byId = new Map(s.nodes.map(n => [n.id, n]))
      const nodes = s.nodes.map(n => {
        const inc = incoming.find(x => x.id === n.id)
        // keep local state while the browser itself tracks the job
        // the server's copy wins; dropping a finished job's id stops handleJob appending the same output twice
        return inc && !(n.data.status === 'running' && inc.data.status !== 'done') ? { ...n, data: { ...n.data, ...inc.data, ...(inc.data.jobId ? {} : { jobId: undefined }) } } : n
      })
      const added = incoming.filter(n => !byId.has(n.id)).map(n => ({ ...n, selected: false }))
      return { nodes: [...nodes, ...added], dirty: true }
    })
    if (incoming.some(n => n.data.status === 'queued')) get().notify(`An agent added "${incoming[0].data.title}" to this canvas`)
  },

  addToTimeline(nodeId) {
    appendToPlaylist([nodeId])
  },
  moveClip(id, dir) {
    set(s => {
      const t = [...s.timeline], i = t.findIndex(c => c.id === id), j = i + dir
      if (i < 0 || j < 0 || j >= t.length) return {}
      ;[t[i], t[j]] = [t[j], t[i]]
      return { timeline: t, dirty: true }
    })
  },
  removeClip(id) { set(s => ({ timeline: s.timeline.filter(c => c.id !== id), dirty: true })) },
}))
