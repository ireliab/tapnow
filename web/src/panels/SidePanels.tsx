import { useEffect, useState } from 'react'
import { api } from '../api'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { Asset } from '../types'

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
