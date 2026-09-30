import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { summarize } from '../graph'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { AgentReply, Asset } from '../types'
import { useAutoResize } from './Chrome'

type Msg = { role: 'user' | 'assistant'; content: string; board?: AgentReply['storyboard']; applied?: boolean }

const SUGGESTIONS = [
  'A 20-second teaser for a cozy coffee shop at sunrise, 4 shots',
  'Astronaut discovers a glowing forest on an alien planet, then a creature appears, then she escapes',
  'Product ad for wireless earbuds, sleek and minimal, 5 shots',
]

export function AgentPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: "Hi! I'm your director agent. Describe a video idea and I'll lay out a storyboard of keyframe → clip nodes on the canvas." }])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ta = useAutoResize(text)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (message = text) => {
    if (!message.trim() || busy) return
    setText(''); setBusy(true)
    const history = msgs.slice(1).map(m => ({ role: m.role, content: m.content }))
    setMsgs(m => [...m, { role: 'user', content: message }])
    try {
      const { nodes, edges } = useStore.getState()
      const r = await api.agent(message, summarize(nodes, edges), history)
      setMsgs(m => [...m, { role: 'assistant', content: r.reply, board: r.storyboard }])
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally { setBusy(false) }
  }
  const apply = (i: number) => {
    const m = msgs[i]
    if (!m.board) return
    useStore.getState().buildStoryboard(m.board.style, m.board.shots)
    setMsgs(all => all.map((x, j) => (j === i ? { ...x, applied: true } : x)))
  }

  return (
    <aside className="side-panel">
      <div className="panel-head"><Icon name="bot" /> Agent</div>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.content}</div>
            {m.board && (
              <div className="board">
                <div className="board-style"><b>Style</b> {m.board.style}</div>
                {m.board.shots.map((s, k) => (
                  <div key={k} className="shot"><b>{k + 1}. {s.title}</b><span>{s.image_prompt}</span><em>🎥 {s.motion_prompt} · {s.duration}s</em></div>
                ))}
                {m.applied
                  ? <button className="btn primary" onClick={() => useStore.getState().runAll(true)}><Icon name="play" size={14} /> Run all shots</button>
                  : <button className="btn primary" onClick={() => apply(i)}><Icon name="plus" size={14} /> Add to canvas</button>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble typing"><i /><i /><i /></div></div>}
        {msgs.length === 1 && (
          <div className="suggestions">
            {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-input">
        <textarea ref={ta} rows={1} value={text} placeholder="Describe your video…" onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="icon-btn primary" disabled={busy || !text.trim()} onClick={() => send()}><Icon name="send" /></button>
      </div>
    </aside>
  )
}

export function AssetsPanel() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [filter, setFilter] = useState<'all' | Asset['kind']>('all')
  const nodes = useStore(s => s.nodes)
  const outputsCount = nodes.reduce((n, x) => n + x.data.outputs.length, 0)
  useEffect(() => { api.assets().then(setAssets) }, [outputsCount])
  const shown = assets.filter(a => filter === 'all' || a.kind === filter)
  const del = async (a: Asset) => {
    if (!confirm('Delete this file from disk? Nodes using it will show a broken preview.')) return
    await api.deleteAsset(a.id)
    setAssets(x => x.filter(y => y.id !== a.id))
  }
  return (
    <aside className="side-panel">
      <div className="panel-head"><Icon name="folder" /> Assets <span className="muted">{assets.length}</span></div>
      <div className="tabs">
        {(['all', 'image', 'video', 'audio'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      <div className="asset-grid">
        {shown.map(a => (
          <div key={a.id} className="asset" draggable title={a.prompt ?? a.name}
            onDragStart={e => { e.dataTransfer.setData('application/x-taplocal-asset', JSON.stringify(a)); e.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => useStore.getState().addAssetNode(a)}>
            {a.kind === 'audio' ? <div className="audio-tile"><Icon name="audio" size={24} /></div>
              : a.kind === 'video' && !a.mime.includes('svg') ? <video src={a.url} muted onMouseEnter={e => e.currentTarget.play()} onMouseLeave={e => e.currentTarget.pause()} />
              : <img src={a.url} alt="" loading="lazy" />}
            <span className="badge">{a.kind}</span>
            <button className="del" title="Delete file" onClick={e => { e.stopPropagation(); del(a) }}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        {!shown.length && <p className="muted pad">Nothing here yet. Generate or upload something — drag assets onto the canvas.</p>}
      </div>
    </aside>
  )
}
