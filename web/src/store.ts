import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type ReactFlowInstance, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { api } from './api'
import { canConnect, resolveInputs, missingUpstream, topoOrder } from './graph'
import type { Asset, CanvasEdge, CanvasNode, CanvasNodeData, Job, ModelInfo, NodeKind, Output, Shot, TimelineClip } from './types'

const uid = () => Math.random().toString(36).slice(2, 10)

export const NODE_WIDTH: Record<NodeKind, number> = { text: 280, image: 300, video: 360, audio: 280 }
export const KIND_LABEL: Record<NodeKind, string> = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio' }

type Snapshot = { nodes: CanvasNode[]; edges: CanvasEdge[]; timeline: TimelineClip[] }
type Panel = 'agent' | 'assets' | 'jobs' | null
export type AddMenu = { screen: XYPosition; flow: XYPosition; fromNodeId?: string } | null

interface State {
  projectId?: string
  projectName: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  timeline: TimelineClip[]
  models: ModelInfo[]
  rf?: ReactFlowInstance<CanvasNode, CanvasEdge>
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
  openProject: (id?: string) => Promise<void>
  save: () => Promise<void>
  checkpoint: () => void
  undo: () => void
  redo: () => void
  onNodesChange: (c: NodeChange<CanvasNode>[]) => void
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
  stopAll: () => void
  handleJob: (job: Job) => void
  addToTimeline: (nodeId: string) => void
  moveClip: (id: string, dir: -1 | 1) => void
  removeClip: (id: string) => void
  buildStoryboard: (style: string, shots: Shot[]) => void
}

export const defaultModel = (models: ModelInfo[], kind: NodeKind) =>
  (models.find(m => m.kind === kind && m.available && m.provider !== 'mock') ?? models.find(m => m.kind === kind && m.available))?.id ?? `mock-${kind}`

const waiters = new Map<string, (ok: boolean) => void>()
let stopRequested = false

export const useStore = create<State & Actions>((set, get) => ({
  projectName: 'Untitled',
  nodes: [], edges: [], timeline: [], models: [],
  panel: null, settingsOpen: false, projectsOpen: false, addMenu: null,
  dirty: false, saving: false, runningAll: false, past: [], future: [],

  set: patch => set(patch),
  notify(text, kind = 'info') {
    set({ toast: { text, kind } })
    setTimeout(() => { if (get().toast?.text === text) set({ toast: undefined }) }, kind === 'error' ? 6000 : 3000)
  },

  async loadModels() { set({ models: await api.models() }) },

  async openProject(id) {
    let list = id ? null : await api.projects()
    const p = id ? await api.project(id) : list![0] ? await api.project(list![0].id) : await api.createProject('My first project')
    // never restore a transient running state from disk
    const nodes = p.nodes.map(n => n.data.status === 'queued' || n.data.status === 'running'
      ? { ...n, data: { ...n.data, status: 'idle' as const, progress: undefined, jobId: undefined } } : n)
    set({ projectId: p.id, projectName: p.name, nodes, edges: p.edges, timeline: p.timeline ?? [], past: [], future: [], dirty: false, projectsOpen: false })
    localStorage.setItem('taplocal:project', p.id)
    requestAnimationFrame(() => {
      const rf = get().rf
      if (!rf) return
      if (p.viewport) rf.setViewport(p.viewport)
      else if (nodes.length) rf.fitView({ padding: 0.2 })
    })
  },

  async save() {
    const s = get()
    if (!s.projectId) return
    set({ saving: true })
    try {
      await api.saveProject({ id: s.projectId, name: s.projectName, updatedAt: Date.now(), nodes: s.nodes, edges: s.edges, timeline: s.timeline, viewport: s.rf?.getViewport() })
      set({ dirty: false })
    } catch (e: any) { get().notify(`Save failed: ${e.message}`, 'error') }
    finally { set({ saving: false }) }
  },

  checkpoint() {
    const { nodes, edges, timeline, past } = get()
    set({ past: [...past.slice(-49), { nodes, edges, timeline }], future: [] })
  },
  undo() {
    const { past, future, nodes, edges, timeline } = get()
    const prev = past.at(-1)
    if (!prev) return
    set({ ...prev, past: past.slice(0, -1), future: [{ nodes, edges, timeline }, ...future], dirty: true })
  },
  redo() {
    const { past, future, nodes, edges, timeline } = get()
    const next = future[0]
    if (!next) return
    set({ ...next, future: future.slice(1), past: [...past, { nodes, edges, timeline }], dirty: true })
  },

  onNodesChange(changes) {
    if (changes.some(c => c.type === 'remove')) get().checkpoint()
    const structural = changes.some(c => c.type !== 'select' && c.type !== 'dimensions')
    set(s => {
      const nodes = applyNodeChanges(changes, s.nodes)
      const alive = new Set(nodes.map(n => n.id))
      return { nodes, timeline: s.timeline.filter(c => alive.has(c.nodeId)), dirty: s.dirty || structural }
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
    get().checkpoint()
    set(s => ({
      nodes: s.nodes.filter(n => n.id !== id), edges: s.edges.filter(e => e.source !== id && e.target !== id),
      timeline: s.timeline.filter(c => c.nodeId !== id), dirty: true,
    }))
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
    const { nodes, edges, projectId } = get()
    const n = nodes.find(x => x.id === id)
    if (!n || n.data.status === 'queued' || n.data.status === 'running') return
    const missing = missingUpstream(id, nodes, edges)
    if (missing.length) get().notify(`Upstream "${missing[0].data.title}" has no output yet — it will be ignored`, 'info')
    const inputs = resolveInputs(id, nodes, edges)
    if (n.data.kind !== 'text' && !n.data.prompt.trim() && !inputs.texts.length && !inputs.images.length) {
      get().notify('Write a prompt or connect an input first', 'error')
      waiters.get(id)?.(false)
      return
    }
    get().updateData(id, { status: 'queued', progress: 0, error: undefined, message: undefined })
    try {
      const job = await api.generate({ nodeId: id, projectId, kind: n.data.kind, model: n.data.model, prompt: n.data.prompt, params: n.data.params, inputs })
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
    stopRequested = false
    set({ runningAll: true })
    const memo = new Map<string, Promise<boolean>>()
    const targetIds = new Set(targets.map(t => t.id))
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
    const results = await Promise.all(targets.map(t => run(t.id)))
    set({ runningAll: false })
    const failed = results.filter(r => !r).length
    get().notify(stopRequested ? 'Run stopped' : failed ? `Run finished with ${failed} failed node(s)` : `Generated ${results.length} node(s)`, failed ? 'error' : 'info')
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
      const out: Output = r.text !== undefined
        ? { id: job.id, kind: 'text', text: r.text, model: job.model, createdAt: Date.now() }
        : { id: r.asset!.id, kind: n.data.kind, url: r.asset!.url, mime: r.asset!.mime, prompt: r.asset!.prompt, model: job.model, createdAt: Date.now() }
      let outputs = n.data.outputs
      // text nodes: keep the pre-expansion text as the first history entry so it can be restored
      if (n.data.kind === 'text' && !outputs.length && n.data.prompt.trim())
        outputs = [{ id: uid(), kind: 'text', text: n.data.prompt, createdAt: Date.now() }]
      outputs = [...outputs, out]
      get().updateData(n.id, {
        status: 'done', progress: 1, jobId: undefined, message: undefined, outputs, active: outputs.length - 1,
        ...(r.text !== undefined ? { prompt: r.text } : {}),
      })
      if (n.data.kind === 'video' && !get().timeline.some(c => c.nodeId === n.id)) get().addToTimeline(n.id)
      waiters.get(n.id)?.(true)
    } else {
      get().updateData(n.id, { status: job.status === 'error' ? 'error' : 'idle', error: job.error, jobId: undefined, progress: undefined })
      if (job.status === 'error') get().notify(`${n.data.title}: ${job.error}`, 'error')
      waiters.get(n.id)?.(false)
    }
  },

  addToTimeline(nodeId) {
    set(s => ({ timeline: [...s.timeline, { id: uid(), nodeId }], dirty: true }))
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

  buildStoryboard(style, shots) {
    const { nodes, models } = get()
    const maxX = nodes.length ? Math.max(...nodes.map(n => n.position.x + (n.width ?? 300))) + 160 : 0
    const minY = nodes.length ? Math.min(...nodes.map(n => n.position.y)) : 0
    const rowH = 300
    const newNodes: CanvasNode[] = []
    const newEdges: CanvasEdge[] = []
    const clips: TimelineClip[] = []
    const mk = (kind: NodeKind, x: number, y: number, data: Partial<CanvasNodeData>): CanvasNode => ({
      id: `${kind}-${uid()}`, type: 'canvas', position: { x, y }, width: NODE_WIDTH[kind],
      data: { kind, title: '', prompt: '', model: defaultModel(models, kind), params: {}, outputs: [], active: 0, status: 'idle', ...data },
    })
    const styleNode = mk('text', maxX, minY + ((shots.length - 1) * rowH) / 2, { title: 'Style', prompt: style })
    newNodes.push(styleNode)
    // prefer an image-to-video model for the animation step when one is available
    const i2v = models.find(m => m.kind === 'video' && m.available && m.maxImages > 0 && m.provider !== 'mock')?.id ?? defaultModel(models, 'video')
    shots.forEach((s, i) => {
      const y = minY + i * rowH
      const img = mk('image', maxX + 380, y, { title: `${s.title} · keyframe`, prompt: s.image_prompt, params: { aspect: '16:9' } })
      const vid = mk('video', maxX + 760, y, { title: `${s.title} · clip`, prompt: s.motion_prompt, model: i2v, params: { aspect: '16:9', duration: s.duration } })
      newNodes.push(img, vid)
      newEdges.push({ id: `e-${uid()}`, source: styleNode.id, target: img.id }, { id: `e-${uid()}`, source: img.id, target: vid.id })
      clips.push({ id: uid(), nodeId: vid.id })
    })
    get().checkpoint()
    set(s => ({ nodes: [...s.nodes, ...newNodes], edges: [...s.edges, ...newEdges], timeline: [...s.timeline, ...clips], dirty: true }))
    requestAnimationFrame(() => get().rf?.fitView({ nodes: newNodes.map(n => ({ id: n.id })), padding: 0.15, duration: 600 }))
  },
}))
