import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { memo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAgent } from '../agent/agentStore'
import { downloadZip, GROUP_COLORS, removeExtra, ungroup, unstack, updateExtra } from '../canvasOps'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { Modal } from '../panels/Chrome'
import { useStore } from '../store'
import type { CanvasNode, CommentNode, GroupNode, StackNode } from '../types'

function Thumb({ n }: { n: CanvasNode }) {
  const o = activeOutput(n)
  if (n.data.kind === 'text') return <div className="thumb-text">{n.data.prompt.slice(0, 120) || n.data.title}</div>
  if (!o?.url) return <div className="thumb-empty"><Icon name={n.data.kind} size={20} /></div>
  if (n.data.kind === 'audio') return <div className="thumb-empty"><Icon name="audio" size={20} /></div>
  if (n.data.kind === 'video' && !o.mime?.includes('svg')) return <video src={o.url} muted />
  return <img src={o.url} alt="" draggable={false} />
}

// ---------- group (frame) ----------
export const GroupNodeView = memo(function GroupNodeView({ id, data, selected }: NodeProps<GroupNode>) {
  return (
    <div className={`group-frame ${selected ? 'selected' : ''}`} style={{ '--g': data.color } as React.CSSProperties}>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={140} color={data.color} />
      <div className="group-head">
        <input className="nodrag" value={data.title} onChange={e => updateExtra(id, { title: e.target.value })} />
      </div>
      <NodeToolbar isVisible={selected} position={Position.Top} className="cnode-toolbar static">
        {GROUP_COLORS.map(c => <button key={c} title="Colour" onClick={() => updateExtra(id, { color: c })}><i className="swatch" style={{ background: c }} /></button>)}
        <button title="Download group media (zip)" onClick={() => downloadZip([id], data.title)}><Icon name="download" /></button>
        <button title="Ungroup (keeps nodes)" onClick={() => ungroup(id)}><Icon name="grid" /></button>
      </NodeToolbar>
    </div>
  )
})

// ---------- stack (pile) ----------
export const StackNodeView = memo(function StackNodeView({ id, data, selected }: NodeProps<StackNode>) {
  const members = useStore(useShallow(s => data.members.map(m => s.nodes.find(n => n.id === m)).filter(Boolean) as CanvasNode[]))
  const set = useStore(s => s.set)
  return (
    <div className={`stack-pile ${selected ? 'selected' : ''}`} onDoubleClick={() => set({ openStack: id })}>
      <div className="pile">
        {members.slice(0, 3).reverse().map((n, i, arr) => (
          <div key={n.id} className="pile-card" style={{ transform: `translate(${(arr.length - 1 - i) * 8}px, ${(arr.length - 1 - i) * -8}px) rotate(${(arr.length - 1 - i) * 2}deg)` }}>
            <Thumb n={n} />
          </div>
        ))}
      </div>
      <div className="pile-foot">
        <Icon name="copy" size={13} /> <input className="nodrag" value={data.title} onChange={e => updateExtra(id, { title: e.target.value })} />
        <span className="count">{members.length}</span>
      </div>
      <NodeToolbar isVisible={selected} position={Position.Top} className="cnode-toolbar static">
        <button title="Open gallery" onClick={() => set({ openStack: id })}><Icon name="expand" /></button>
        <button title="Download all (zip)" onClick={() => downloadZip([id], data.title)}><Icon name="download" /></button>
        <button title="Unstack" onClick={() => unstack(id)}><Icon name="grid" /></button>
        <button title="Delete stack and everything in it" onClick={() => confirm(`Delete this stack and its ${members.length} nodes?`) && removeExtra(id)}><Icon name="trash" /></button>
      </NodeToolbar>
    </div>
  )
})

export function StackGallery() {
  const openStack = useStore(s => s.openStack)
  const stack = useStore(s => s.extras.find((e): e is StackNode => e.id === openStack && e.type === 'stack'))
  const nodes = useStore(s => s.nodes)
  const set = useStore(s => s.set)
  if (!stack) return null
  const members = stack.data.members.map(m => nodes.find(n => n.id === m)).filter(Boolean) as CanvasNode[]
  const toAgent = () => {
    const a = useAgent.getState()
    members.filter(n => n.data.kind !== 'text').forEach(n => a.addRef({ nodeId: n.id, title: n.data.title, kind: n.data.kind }))
    a.set({ tab: 'chat' }); a.focusComposer()
    set({ openStack: undefined })
  }
  return (
    <Modal title={`${stack.data.title}`} onClose={() => set({ openStack: undefined })} wide>
      <div className="output-toolbar">
        <button className="btn" onClick={toAgent}><Icon name="bot" size={14} /> Send to Agent</button>
        <button className="btn" onClick={() => downloadZip([stack.id], stack.data.title)}><Icon name="download" size={14} /> Download all</button>
        <button className="btn" onClick={() => unstack(stack.id)}><Icon name="grid" size={14} /> Unstack all</button>
      </div>
      <div className="stack-gallery">
        {members.map(n => (
          <div key={n.id} className="gallery-item">
            <div className="gallery-media" onClick={() => { const o = activeOutput(n); if (o?.url) set({ lightbox: o }) }}><Thumb n={n} /></div>
            <div className="gallery-meta"><span title={n.data.prompt}>{n.data.title}</span>
              <button className="link" onClick={() => unstack(stack.id, [n.id])}>Take out</button></div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ---------- comment ----------
export const CommentNodeView = memo(function CommentNodeView({ id, data, selected }: NodeProps<CommentNode>) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(!data.text)
  const post = () => {
    const t = draft.trim().slice(0, 200)
    if (!t) return
    updateExtra(id, { replies: [...data.replies, { id: Math.random().toString(36).slice(2, 9), text: t, at: Date.now() }] })
    setDraft('')
  }
  return (
    <div className={`comment ${selected ? 'selected' : ''}`}>
      <div className="comment-pin"><Icon name="bot" size={12} /></div>
      <div className="comment-body nodrag nowheel">
        <div className="comment-head"><b>{data.author}</b><span className="muted">{new Date(data.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {selected && !editing && <button className="link" onClick={() => setEditing(true)}>Edit</button>}
          {selected && <button className="link" onClick={() => removeExtra(id)}>Delete</button>}
        </div>
        {editing ? (
          <textarea autoFocus maxLength={200} rows={2} defaultValue={data.text} placeholder="Add a comment… (Enter to post)"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const v = (e.target as HTMLTextAreaElement).value.trim()
                if (!v) return removeExtra(id)
                updateExtra(id, { text: v, at: Date.now() }); setEditing(false)
              }
              if (e.key === 'Escape') { if (!data.text) removeExtra(id); else setEditing(false) }
            }} />
        ) : <p>{data.text}</p>}
        {data.replies.map(r => (
          <div key={r.id} className="reply"><b>You</b> {r.text}
            {selected && <button className="link" onClick={() => updateExtra(id, { replies: data.replies.filter(x => x.id !== r.id) })}>×</button>}</div>
        ))}
        {selected && data.text && (
          <input className="reply-input" maxLength={200} value={draft} placeholder="Reply…" onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && post()} />
        )}
      </div>
    </div>
  )
})
