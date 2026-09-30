import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, type OnConnectEnd } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useRef } from 'react'
import { api, connectJobs } from './api'
import CanvasNodeView from './nodes/CanvasNodeView'
import { AddMenu, Lightbox, ProjectsModal, Toast, Toolbar, TopBar } from './panels/Chrome'
import { SettingsModal } from './panels/SettingsModal'
import { AgentPanel, AssetsPanel } from './panels/SidePanels'
import { Timeline } from './panels/Timeline'
import { useStore } from './store'
import type { Asset, CanvasEdge, CanvasNode, NodeKind } from './types'

const nodeTypes = { canvas: CanvasNodeView }
let booted = false
const KEY_KIND: Record<string, NodeKind> = { t: 'text', i: 'image', v: 'video', a: 'audio' }
const isTyping = (e: Event) => {
  const t = e.target as HTMLElement
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

function Canvas() {
  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const panel = useStore(s => s.panel)
  const s = useStore.getState()
  const fileInput = useRef<HTMLInputElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  // boot: models, last project, live job updates
  useEffect(() => {
    if (!booted) {
      // module-level guard: StrictMode double-mount must not create two first projects
      booted = true
      s.loadModels().catch(e => s.notify(`Server unreachable: ${e.message}`, 'error'))
      s.openProject(localStorage.getItem('taplocal:project') ?? undefined).catch(() => s.openProject())
    }
    return connectJobs(job => useStore.getState().handleJob(job))
  }, [])

  // autosave
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = useStore.subscribe((st, prev) => {
      if (st.dirty && (st.nodes !== prev.nodes || st.edges !== prev.edges || st.timeline !== prev.timeline || st.projectName !== prev.projectName)) {
        clearTimeout(t)
        t = setTimeout(() => useStore.getState().save(), 1200)
      }
    })
    return () => { unsub(); clearTimeout(t) }
  }, [])

  const uploadFiles = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    const st = useStore.getState()
    const media = files.filter(f => /^(image|video|audio)\//.test(f.type))
    if (!media.length) return
    try {
      const assets = await api.upload(media, st.projectId)
      assets.forEach((a, i) => st.addAssetNode(a, at && { x: at.x + i * 40, y: at.y + i * 40 }))
      st.notify(`Uploaded ${assets.length} file(s)`)
    } catch (e: any) { st.notify(e.message, 'error') }
  }, [])

  // keyboard shortcuts + clipboard paste
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); st.save(); return }
      if (isTyping(e)) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); st.duplicate(st.nodes.filter(n => n.selected).map(n => n.id)) }
      else if (!mod && !e.altKey && KEY_KIND[e.key.toLowerCase()]) st.addNode(KEY_KIND[e.key.toLowerCase()])
      else if (e.key === 'Escape') st.set({ addMenu: null })
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e)) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) { e.preventDefault(); uploadFiles(files) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste) }
  }, [uploadFiles])

  const openAddMenu = (clientX: number, clientY: number, fromNodeId?: string) => {
    const st = useStore.getState()
    if (!st.rf) return
    st.set({ addMenu: { screen: { x: clientX, y: clientY }, flow: st.rf.screenToFlowPosition({ x: clientX, y: clientY }), fromNodeId } })
  }

  // drag a wire from an output into empty space -> pick a node to create & connect
  const onConnectEnd: OnConnectEnd = (event, conn) => {
    if (conn.isValid || !conn.fromNode || conn.fromHandle?.type !== 'source' || conn.toNode) return
    const p = 'changedTouches' in event ? event.changedTouches[0] : event
    openAddMenu(p.clientX, p.clientY, conn.fromNode.id)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const st = useStore.getState()
    const at = st.rf?.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const raw = e.dataTransfer.getData('application/x-taplocal-asset')
    if (raw) st.addAssetNode(JSON.parse(raw) as Asset, at)
    else uploadFiles([...e.dataTransfer.files], at)
  }

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Toolbar onUpload={() => fileInput.current?.click()} />
        <div className="canvas" ref={wrapper} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={onDrop}
          onDoubleClick={e => { if ((e.target as HTMLElement).classList.contains('react-flow__pane')) openAddMenu(e.clientX, e.clientY) }}>
          <ReactFlow<CanvasNode, CanvasEdge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={s.onNodesChange} onEdgesChange={s.onEdgesChange} onConnect={s.onConnect}
            isValidConnection={s.isValidConnection} onConnectEnd={onConnectEnd}
            onInit={rf => useStore.setState({ rf })}
            onNodeDragStart={() => s.checkpoint()}
            onMoveEnd={() => useStore.setState({ dirty: true })}
            zoomOnDoubleClick={false} minZoom={0.1} maxZoom={2.5} proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            selectionOnDrag panOnDrag={[1, 2]} panOnScroll selectionKeyCode={null}
            defaultEdgeOptions={{ type: 'default', animated: false }} colorMode="dark" fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#2c2c33" />
            <MiniMap pannable zoomable nodeColor={n => ({ text: '#8b8b95', image: '#5b8cff', video: '#b36bff', audio: '#2fc2a0' } as Record<string, string>)[(n.data as any).kind]} maskColor="rgba(10,10,12,.7)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <div className="empty-canvas">
              <h1>Start creating</h1>
              <p>Double-click the canvas to add a node, press <kbd>T</kbd> <kbd>I</kbd> <kbd>V</kbd> <kbd>A</kbd>, drop files here, or ask the Agent for a storyboard.</p>
              <div className="empty-actions">
                <button className="btn primary" onClick={() => s.set({ panel: 'agent' })}>Plan with Agent</button>
                <button className="btn" onClick={() => s.addNode('image')}>Add image node</button>
              </div>
            </div>
          )}
          <AddMenu />
        </div>
        {panel === 'agent' && <AgentPanel />}
        {panel === 'assets' && <AssetsPanel />}
      </div>
      <Timeline />
      <input ref={fileInput} type="file" multiple hidden accept="image/*,video/*,audio/*"
        onChange={e => { uploadFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      <ProjectsModal />
      <SettingsModal />
      <Lightbox />
      <Toast />
    </div>
  )
}

export default function App() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>
}
