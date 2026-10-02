import { useState } from 'react'
import { PIN_COLORS, setPin } from '../canvasOps'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { CanvasNode, CanvasNodeData } from '../types'
import { ToolsMenu } from '../tools/ToolsMenu'

const TEXT_BGS = ['#2a2438', '#1f2d3d', '#1f3329', '#3a3222', '#3a2227']

type Pop = 'color' | 'tags' | 'more' | null

/** TapNow-style pill above the selected node: colour · tags · tools · duplicate · save · fullscreen · more. */
export function NodeActions({ id, data, scale, onUpload, onSave, onFullscreen }: {
  id: string; data: CanvasNodeData; scale: number
  onUpload: () => void; onSave: () => void; onFullscreen: () => void
}) {
  const { updateData, removeNode, duplicate, addToTimeline, notify } = useStore.getState()
  const inPlaylist = useStore(s => s.extras.some(e => e.type === 'playlist' && e.data.clips.some(c => c.nodeId === id)))
  const [pop, setPop] = useState<Pop>(null)
  const [tag, setTag] = useState('')
  const out = activeOutput({ data } as CanvasNode)
  const tags = data.tags ?? []
  const toggle = (p: Pop) => setPop(pop === p ? null : p)
  const addTag = () => {
    const t = tag.trim().replace(/^#/, '').slice(0, 24)
    if (t && !tags.includes(t)) updateData(id, { tags: [...tags, t] })
    setTag('')
  }
  const canFull = data.kind === 'text' || !!out?.url

  return (
    <div className="node-actions nodrag nowheel" style={{ transform: `translateX(-50%) scale(${scale})` }} onPointerDown={e => e.stopPropagation()}>
      <button data-tip="Colour" className="na-color" onClick={() => toggle('color')}>
        <i style={{ background: data.pin ?? (data.kind === 'text' ? data.bg : undefined) ?? '#f2f2f5' }} />
      </button>
      <span className="na-sep" />
      <button data-tip="Tags" className={tags.length ? 'has' : ''} onClick={() => toggle('tags')}><Icon name="tag" size={18} /></button>
      {(data.kind === 'image' || data.kind === 'video') && <ToolsMenu id={id} data={data} />}
      <button data-tip="Duplicate" onClick={() => duplicate([id])}><Icon name="copy" size={18} /></button>
      <button data-tip="Save to library" onClick={onSave}><Icon name="folder-plus" size={18} /></button>
      <button data-tip="Fullscreen" className="na-full" disabled={!canFull} onClick={onFullscreen}><Icon name="expand" size={18} /></button>
      <button data-tip="More" onClick={() => toggle('more')}><Icon name="more" size={18} /></button>

      {pop && <div className="backdrop-clear" onPointerDown={() => setPop(null)} />}
      {pop === 'color' && (
        <div className="na-pop">
          <div className="na-pop-label">Label colour</div>
          <div className="na-swatches">
            <button title="None" className={!data.pin ? 'on' : ''} onClick={() => setPin([id], undefined)}><i className="none" /></button>
            {PIN_COLORS.map(c => <button key={c} className={data.pin === c ? 'on' : ''} onClick={() => setPin([id], c)}><i style={{ background: c }} /></button>)}
          </div>
          {data.kind === 'text' && <>
            <div className="na-pop-label">Background</div>
            <div className="na-swatches">
              <button title="Default" className={!data.bg ? 'on' : ''} onClick={() => updateData(id, { bg: undefined })}><i style={{ background: 'var(--card)' }} /></button>
              {TEXT_BGS.map(c => <button key={c} className={data.bg === c ? 'on' : ''} onClick={() => updateData(id, { bg: c })}><i style={{ background: c }} /></button>)}
            </div>
          </>}
        </div>
      )}
      {pop === 'tags' && (
        <div className="na-pop">
          <div className="na-pop-label">Tags · find them with Ctrl+F</div>
          {tags.length > 0 && <div className="na-tags">{tags.map(t => (
            <span key={t} className="chip">#{t}<button title="Remove" onClick={() => updateData(id, { tags: tags.filter(x => x !== t) })}><Icon name="x" size={10} /></button></span>
          ))}</div>}
          <input autoFocus value={tag} placeholder="Add a tag and press Enter" onChange={e => setTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') setPop(null) }} />
        </div>
      )}
      {pop === 'more' && (
        <div className="na-pop na-menu" onClick={() => setPop(null)}>
          {data.kind !== 'text' && <button onClick={onUpload}><Icon name="upload" size={15} /> Upload file</button>}
          {out?.url && <a href={out.url} download><Icon name="download" size={15} /> Download</a>}
          {data.kind === 'text' && <button onClick={() => { navigator.clipboard.writeText(data.prompt); notify('Copied') }}><Icon name="copy" size={15} /> Copy text</button>}
          {(data.kind === 'image' || data.kind === 'video') && (
            <button disabled={inPlaylist} onClick={() => addToTimeline(id)}><Icon name={inPlaylist ? 'check' : 'timeline'} size={15} /> {inPlaylist ? 'In a playlist' : 'Add to playlist'}</button>
          )}
          <button className="danger" onClick={() => removeNode(id)}><Icon name="trash" size={15} /> Delete</button>
        </div>
      )}
    </div>
  )
}
