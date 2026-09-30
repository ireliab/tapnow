import { useEffect, useState } from 'react'
import { api } from '../api'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { Asset } from '../types'

export function AssetsPanel({ embedded = false }: { embedded?: boolean }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [filter, setFilter] = useState<'all' | Asset['kind']>('all')
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const projectId = useStore(s => s.projectId)
  const nodes = useStore(s => s.nodes)
  const outputsCount = nodes.reduce((n, x) => n + x.data.outputs.length, 0)
  useEffect(() => { api.assets().then(setAssets) }, [outputsCount])
  // History: everything ever generated or uploaded, so outputs of deleted nodes can be recovered
  const shown = assets.filter(a => (filter === 'all' || a.kind === filter) && (scope === 'all' || (a as Asset & { projectId?: string }).projectId === projectId)
    && (!q || `${a.name ?? ''} ${a.prompt ?? ''} ${a.model ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const del = async (a: Asset) => {
    if (!confirm('Delete this file from disk? Nodes using it will show a broken preview.')) return
    await api.deleteAsset(a.id)
    setAssets(x => x.filter(y => y.id !== a.id))
  }
  return (
    <Wrap embedded={embedded}>
      {!embedded && <div className="panel-head"><Icon name="folder" /> Assets <span className="muted">{assets.length}</span></div>}
      <div className="skills-head">
        <input placeholder="Search prompts, names, models…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={scope} onChange={e => setScope(e.target.value as 'project' | 'all')} title="History scope">
          <option value="project">This project</option><option value="all">All projects</option>
        </select>
      </div>
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
    </Wrap>
  )
}

const Wrap = ({ embedded, children }: { embedded: boolean; children: React.ReactNode }) =>
  embedded ? <div className="library-body">{children}</div> : <aside className="side-panel">{children}</aside>
