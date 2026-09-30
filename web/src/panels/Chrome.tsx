import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { createPlaylist } from '../canvasOps'
import { canConnect } from '../graph'
import { Icon, type IconName } from '../icons'
import { Media } from '../nodes/CanvasNodeView'
import { KIND_LABEL, useStore } from '../store'
import type { NodeKind, ProjectMeta } from '../types'

export function TopBar() {
  const { projectName, dirty, saving, runningAll, past, future } = useStore()
  const { set, runAll, stopAll, undo, redo } = useStore.getState()
  return (
    <header className="topbar">
      <div className="brand" onClick={() => set({ projectsOpen: true })} title="Projects">
        <div className="logo">T</div><span>TapLocal</span><Icon name="chevron" size={14} />
      </div>
      <input className="project-name" value={projectName} onChange={e => set({ projectName: e.target.value, dirty: true })} />
      <span className="save-state">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
      <div className="spacer" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}><Icon name="undo" /></button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}><Icon name="redo" /></button>
      {runningAll
        ? <button className="btn danger" onClick={stopAll}><Icon name="stop" size={14} /> Stop</button>
        : <button className="btn" onClick={() => runAll(true)} title="Generate every node without an output, in dependency order"><Icon name="play" size={14} /> Run all</button>}
      <button className="icon-btn" title="Settings" onClick={() => set({ settingsOpen: true })}><Icon name="settings" /></button>
    </header>
  )
}

const TOOLS: Array<{ kind: NodeKind; icon: IconName; key: string }> = [
  { kind: 'text', icon: 'text', key: 'T' }, { kind: 'image', icon: 'image', key: 'I' },
  { kind: 'video', icon: 'video', key: 'V' }, { kind: 'audio', icon: 'audio', key: 'A' },
]

export function Toolbar({ onUpload }: { onUpload: () => void }) {
  const panel = useStore(s => s.panel)
  const commentMode = useStore(s => s.commentMode)
  const { addNode, set } = useStore.getState()
  const toggle = (p: 'agent' | 'assets') => set({ panel: panel === p ? null : p })
  return (
    <nav className="toolbar">
      {TOOLS.map(t => (
        <button key={t.kind} title={`${KIND_LABEL[t.kind]} node (${t.key})`} onClick={() => addNode(t.kind)}>
          <Icon name={t.icon} size={18} /><span>{KIND_LABEL[t.kind]}</span>
        </button>
      ))}
      <button title="Upload files" onClick={onUpload}><Icon name="upload" size={18} /><span>Upload</span></button>
      <hr />
      <button className={commentMode ? 'on' : ''} title="Comment mode (C)" onClick={() => set({ commentMode: !commentMode })}><Icon name="bot" size={18} /><span>Comment</span></button>
      <button title="Search nodes (Ctrl+F)" onClick={() => set({ searchOpen: true })}><Icon name="list" size={18} /><span>Search</span></button>
      <button title="New playlist (from selected clips)" onClick={() => createPlaylist(useStore.getState().nodes.filter(n => n.selected).map(n => n.id))}><Icon name="timeline" size={18} /><span>Playlist</span></button>
      <hr />
      <button className={panel === 'assets' ? 'on' : ''} title="Assets" onClick={() => toggle('assets')}><Icon name="folder" size={18} /><span>Assets</span></button>
      <button className={panel === 'agent' ? 'on' : ''} title="Agent" onClick={() => toggle('agent')}><Icon name="bot" size={18} /><span>Agent</span></button>
    </nav>
  )
}

/** Quick-add menu (double-click canvas, or drop a connection on empty space). */
export function AddMenu() {
  const menu = useStore(s => s.addMenu)
  const nodes = useStore(s => s.nodes)
  const { addNode, set, onConnect } = useStore.getState()
  if (!menu) return null
  const from = (menu.fromNodeIds ?? []).map(id => nodes.find(n => n.id === id)).filter(Boolean) as typeof nodes
  const kinds = TOOLS.filter(t => from.every(f => canConnect(f.data.kind, t.kind)))
  const pick = (kind: NodeKind) => {
    const id = addNode(kind, { x: menu.flow.x, y: menu.flow.y - 60 })
    for (const f of from) onConnect({ source: f.id, target: id, sourceHandle: null, targetHandle: null })
    set({ addMenu: null })
  }
  const title = from.length === 1 ? 'Connect "' + from[0].data.title + '" to…' : from.length ? 'Connect ' + from.length + ' nodes to…' : 'Add node'
  return (
    <>
      <div className="backdrop-clear" onPointerDown={() => set({ addMenu: null })} />
      <div className="add-menu" style={{ left: Math.min(menu.screen.x, window.innerWidth - 220), top: Math.min(menu.screen.y, window.innerHeight - 230) }}>
        <div className="menu-title">{title}</div>
        {kinds.map(t => (
          <button key={t.kind} onClick={() => pick(t.kind)}><Icon name={t.icon} /> {KIND_LABEL[t.kind]} <kbd>{t.key}</kbd></button>
        ))}
        {!kinds.length && <div className="menu-title">No node type accepts all of these inputs</div>}
      </div>
    </>
  )
}

export function ProjectsModal() {
  const open = useStore(s => s.projectsOpen)
  const current = useStore(s => s.projectId)
  const { set, openProject, save, notify } = useStore.getState()
  const [list, setList] = useState<ProjectMeta[]>([])
  const refresh = () => api.projects().then(setList)
  useEffect(() => { if (open) refresh() }, [open])
  if (!open) return null
  const create = async () => { await save(); const p = await api.createProject('Untitled'); await openProject(p.id) }
  const openOne = async (id: string) => { await save(); await openProject(id) }
  const remove = async (p: ProjectMeta) => {
    if (!confirm(`Delete project "${p.name}"? Generated files stay in Assets.`)) return
    await api.deleteProject(p.id)
    if (p.id === current) await openProject()
    refresh(); notify('Project deleted')
  }
  return (
    <Modal onClose={() => set({ projectsOpen: false })} title="Projects" wide>
      <div className="project-grid">
        <button className="project-card new" onClick={create}><Icon name="plus" size={28} /><span>New project</span></button>
        {list.map(p => (
          <div key={p.id} className={`project-card ${p.id === current ? 'current' : ''}`} onClick={() => openOne(p.id)}>
            <div className="thumb">{p.thumb ? <img src={p.thumb} alt="" /> : <Icon name="grid" size={28} />}</div>
            <div className="meta"><b>{p.name}</b><span>{p.nodeCount} nodes · {new Date(p.updatedAt).toLocaleString()}</span></div>
            <button className="icon-btn del" title="Delete" onClick={e => { e.stopPropagation(); remove(p) }}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // portal: modals opened from inside a node must escape React Flow's transformed viewport
  return createPortal(
    <div className="modal-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}
      onKeyDown={e => e.stopPropagation()} onCopy={e => e.stopPropagation()} onPaste={e => e.stopPropagation()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Lightbox() {
  const out = useStore(s => s.lightbox)
  const set = useStore(s => s.set)
  if (!out) return null
  return (
    <Modal title={out.prompt?.slice(0, 80) || 'Preview'} onClose={() => set({ lightbox: undefined })} wide>
      <div className="lightbox"><Media output={out} /></div>
      {out.model && <p className="muted">Model: {out.model}</p>}
    </Modal>
  )
}

export function Toast() {
  const toast = useStore(s => s.toast)
  if (!toast) return null
  return <div className={`toast ${toast.kind ?? ''}`}>{toast.text}</div>
}

export function useAutoResize<T extends HTMLTextAreaElement>(value: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
  }, [value])
  return ref
}
