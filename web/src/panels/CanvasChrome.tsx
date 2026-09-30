import { NodeToolbar, Position } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAgent } from '../agent/agentStore'
import { createGroup, createPlaylist, downloadZip, focusNode, PIN_COLORS, setPin, stackNodes } from '../canvasOps'
import { Icon, type IconName } from '../icons'
import { KIND_LABEL, useStore } from '../store'
import { SaveTemplateDialog } from './LibraryPanel'
import type { NodeKind } from '../types'

/** Floating toolbar over a multi-selection (TapNow's batch action toolbar). */
export function SelectionToolbar() {
  const selNodes = useStore(useShallow(s => s.nodes.filter(n => n.selected && !n.hidden)))
  const selExtras = useStore(useShallow(s => s.extras.filter(n => n.selected)))
  const [pinOpen, setPinOpen] = useState(false)
  const [tpl, setTpl] = useState(false)
  const readOnly = useStore(s => s.readOnly)
  const ids = [...selNodes.map(n => n.id), ...selExtras.map(n => n.id)]
  if (ids.length < 2 || readOnly) return tpl ? <SaveTemplateDialog ids={ids} onClose={() => setTpl(false)} /> : null
  const s = useStore.getState()
  const media = selNodes.filter(n => n.data.kind !== 'text')
  const downstream = (e: React.MouseEvent) => {
    const rf = s.rf
    if (!rf) return
    const right = Math.max(...selNodes.map(n => n.position.x + (n.measured?.width ?? 300)))
    const midY = selNodes.reduce((a, n) => a + n.position.y, 0) / selNodes.length
    s.set({ addMenu: { screen: { x: e.clientX, y: e.clientY + 20 }, flow: { x: right + 140, y: midY }, fromNodeIds: selNodes.map(n => n.id) } })
  }
  const toAgent = () => {
    const a = useAgent.getState()
    selNodes.forEach(n => a.addRef({ nodeId: n.id, title: n.data.title, kind: n.data.kind }))
    a.set({ tab: 'chat' }); a.focusComposer()
  }
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} className="cnode-toolbar static selection-toolbar">
      <span className="sel-count">{ids.length} selected</span>
      {selNodes.length > 0 && <button title="Create one downstream node connected to all selected" onClick={downstream}><Icon name="plus" /></button>}
      {selNodes.length > 1 && <button title="Stack" onClick={() => stackNodes(ids)}><Icon name="copy" /></button>}
      <button title="Group" onClick={() => createGroup(ids)}><Icon name="grid" /></button>
      {media.some(n => n.data.kind === 'video' || n.data.kind === 'image') && (
        <button title="Create playlist" onClick={() => createPlaylist(media.map(n => n.id))}><Icon name="timeline" /></button>
      )}
      <button title="Download media (zip)" onClick={() => downloadZip(ids)}><Icon name="download" /></button>
      <button title="Send to Agent as references" onClick={toAgent}><Icon name="bot" /></button>
      <span className="pin-wrap">
        <button title="Pin" onClick={() => setPinOpen(!pinOpen)}><Icon name="check" /></button>
        {pinOpen && (
          <span className="pin-pop">
            {PIN_COLORS.map(c => <button key={c} onClick={() => { setPin(selNodes.map(n => n.id), c); setPinOpen(false) }}><i className="swatch" style={{ background: c }} /></button>)}
            <button title="Remove pin" onClick={() => { setPin(selNodes.map(n => n.id), undefined); setPinOpen(false) }}><Icon name="x" size={12} /></button>
          </span>
        )}
      </span>
      <button title="Save as template" onClick={() => setTpl(true)}><Icon name="folder" /></button>
      {tpl && <SaveTemplateDialog ids={ids} onClose={() => setTpl(false)} />}
      <button title="Duplicate" onClick={() => s.duplicate(selNodes.map(n => n.id))}><Icon name="copy" /></button>
      <button title="Delete" onClick={() => s.onNodesChange(ids.map(id => ({ type: 'remove' as const, id })))}><Icon name="trash" /></button>
    </NodeToolbar>
  )
}

/** Pinned nodes, grouped by colour, at the top of the canvas. */
export function PinBar() {
  const pinned = useStore(useShallow(s => s.nodes.filter(n => n.data.pin)))
  if (!pinned.length) return null
  const byColor = PIN_COLORS.map(c => [c, pinned.filter(n => n.data.pin === c)] as const).filter(([, l]) => l.length)
  return (
    <div className="pin-bar">
      {byColor.map(([c, list]) => (
        <div key={c} className="pin-group">
          <i className="swatch" style={{ background: c }} />
          {list.map(n => <button key={n.id} onClick={() => focusNode(n.id)} title={n.data.prompt}><Icon name={n.data.kind} size={11} /> {n.data.title}</button>)}
        </div>
      ))}
    </div>
  )
}

const KINDS: Array<NodeKind | 'all'> = ['all', 'text', 'image', 'video', 'audio']

/** Ctrl+F node search by title, prompt and kind. */
export function SearchOverlay() {
  const open = useStore(s => s.searchOpen)
  const nodes = useStore(s => s.nodes)
  const set = useStore(s => s.set)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<NodeKind | 'all'>('all')
  const [hi, setHi] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setHi(0); setTimeout(() => input.current?.select(), 0) } }, [open])
  const results = useMemo(() => {
    const t = q.toLowerCase().trim()
    return nodes.filter(n => (kind === 'all' || n.data.kind === kind) && (!t || `${n.data.title} ${n.data.prompt}`.toLowerCase().includes(t))).slice(0, 30)
  }, [q, kind, nodes])
  if (!open) return null
  const go = (id: string) => { focusNode(id); set({ searchOpen: false }) }
  return (
    <>
      <div className="backdrop-clear" onPointerDown={() => set({ searchOpen: false })} />
      <div className="search-overlay">
        <div className="search-input"><Icon name="list" />
          <input ref={input} value={q} placeholder="Search nodes by title or prompt…" onChange={e => { setQ(e.target.value); setHi(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') set({ searchOpen: false })
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
              if (e.key === 'Enter' && results[hi]) go(results[hi].id)
            }} />
        </div>
        <div className="opts">{KINDS.map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]}</button>)}</div>
        <div className="search-results-list">
          {results.map((n, i) => (
            <button key={n.id} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => go(n.id)}>
              <Icon name={n.data.kind as IconName} size={13} /> <b>{n.data.title}</b>
              <span className="muted">{n.data.prompt.slice(0, 70)}</span>
              {n.hidden && <span className="chip ghost">in stack</span>}
              {n.data.pin && <i className="swatch" style={{ background: n.data.pin }} />}
            </button>
          ))}
          {!results.length && <p className="muted pad">No matching nodes</p>}
        </div>
      </div>
    </>
  )
}
