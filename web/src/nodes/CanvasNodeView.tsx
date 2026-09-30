import { Handle, Position, useStore as useFlow, type NodeProps } from '@xyflow/react'
import { memo, useRef } from 'react'
import { api } from '../api'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { KIND_LABEL, useStore } from '../store'
import type { CanvasNode, Output } from '../types'
import { Composer } from './Composer'

export function Media({ output, controls = true }: { output: Output; controls?: boolean }) {
  if (!output.url) return null
  if (output.kind === 'audio') return <audio className="nodrag" src={output.url} controls />
  // mock videos are animated SVGs
  if (output.kind === 'video' && !output.mime?.includes('svg'))
    return <video src={output.url} controls={controls} muted loop playsInline className={controls ? 'nodrag' : undefined} />
  return <img src={output.url} alt={output.prompt ?? ''} draggable={false} />
}

const ASPECT: Record<string, string> = { '1:1': '1 / 1', '16:9': '16 / 9', '9:16': '9 / 16', '4:3': '4 / 3', '3:4': '3 / 4' }

function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateData, removeNode, duplicate, addToTimeline, set, projectId, notify } = useStore.getState()
  const inTimeline = useStore(s => s.timeline.some(c => c.nodeId === id))
  const zoom = useFlow(s => s.transform[2])
  const fileRef = useRef<HTMLInputElement>(null)
  const out = activeOutput({ data } as CanvasNode)
  const busy = data.status === 'queued' || data.status === 'running'
  // only show the composer for a single selected node
  const soloSelected = useStore(s => selected && s.nodes.filter(n => n.selected).length === 1)

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const [a] = await api.upload([files[0]], projectId)
      if (a.kind !== data.kind) return notify(`That is ${a.kind}, not ${data.kind}`, 'error')
      const o: Output = { id: a.id, kind: a.kind, url: a.url, mime: a.mime, createdAt: a.createdAt }
      updateData(id, { outputs: [...data.outputs, o], active: data.outputs.length, status: 'done' })
    } catch (e: any) { notify(e.message, 'error') }
  }

  return (
    <div className={`cnode kind-${data.kind} ${selected ? 'selected' : ''} status-${data.status}`}>
      <div className="cnode-label" style={{ visibility: zoom < 0.35 ? 'hidden' : undefined }}>
        <Icon name={data.kind} size={13} />
        <input className="nodrag title-input" value={data.title} onChange={e => updateData(id, { title: e.target.value })} />
      </div>

      {selected && (
        <div className="cnode-toolbar nodrag" style={{ transform: `translateX(-50%) scale(${Math.min(2.5, Math.max(1, 1 / zoom))})` }}>
          {data.kind !== 'text' && <button title="Upload file" onClick={() => fileRef.current?.click()}><Icon name="upload" /></button>}
          {out?.url && <button title="View" onClick={() => set({ lightbox: out })}><Icon name="expand" /></button>}
          {out?.url && <a title="Download" href={out.url} download><Icon name="download" /></a>}
          {(data.kind === 'video' || data.kind === 'image') && (
            <button title={inTimeline ? 'In timeline' : 'Add to timeline'} disabled={inTimeline} onClick={() => addToTimeline(id)}><Icon name={inTimeline ? 'check' : 'timeline'} /></button>
          )}
          <button title="Duplicate (Ctrl+D)" onClick={() => duplicate([id])}><Icon name="copy" /></button>
          <button title="Delete" onClick={() => removeNode(id)}><Icon name="trash" /></button>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="port port-in"><Icon name="plus" size={12} /></Handle>
      <Handle type="source" position={Position.Right} className="port port-out"><Icon name="plus" size={12} /></Handle>

      <div className="cnode-card">
        {data.kind === 'text' ? (
          <textarea
            className="nodrag nowheel text-body" value={data.prompt} placeholder="Write a prompt, script or style notes…"
            onChange={e => updateData(id, { prompt: e.target.value })}
          />
        ) : (
          <div className="media" style={{ aspectRatio: data.kind === 'audio' ? undefined : ASPECT[data.params.aspect ?? '16:9'] }}
            onDoubleClick={() => out?.url && set({ lightbox: out })}>
            {out ? <Media output={out} /> : (
              <div className="empty">
                <Icon name={data.kind} size={28} />
                <span>{busy ? '' : `${KIND_LABEL[data.kind]} · describe it below or connect inputs`}</span>
                {!busy && <button className="nodrag link" onClick={() => fileRef.current?.click()}>or upload</button>}
              </div>
            )}
            {busy && (
              <div className="progress">
                <div className="shimmer" />
                <span>{data.status === 'queued' ? 'Queued' : `${Math.round((data.progress ?? 0) * 100)}%`}{data.message ? ` · ${data.message}` : ''}</span>
                <div className="bar"><i style={{ width: `${(data.progress ?? 0) * 100}%` }} /></div>
              </div>
            )}
          </div>
        )}
        {data.status === 'error' && data.error && <div className="cnode-error" title={data.error}>{data.error}</div>}
        {data.outputs.length > 1 && (
          <div className="history nodrag nowheel">
            {data.outputs.map((o, i) => (
              <button key={o.id + i} className={i === data.active ? 'on' : ''}
                onClick={() => updateData(id, { active: i, ...(o.text !== undefined ? { prompt: o.text } : {}) })}
                title={o.prompt ?? o.text ?? ''}>
                {o.kind === 'image' || (o.kind === 'video' && o.mime?.includes('svg')) ? <img src={o.url} alt="" />
                  : o.kind === 'video' ? <video src={o.url} muted /> : <span>{i + 1}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" hidden accept={`${data.kind}/*`} onChange={e => { onUpload(e.target.files); e.target.value = '' }} />
      {soloSelected && <Composer id={id} data={data} zoom={zoom} />}
    </div>
  )
}

export default memo(CanvasNodeView)
