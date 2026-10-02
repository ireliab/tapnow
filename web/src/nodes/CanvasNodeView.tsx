import { Handle, NodeResizer, Position, useStore as useFlow, type NodeProps } from '@xyflow/react'
import { memo, useRef, useState } from 'react'
import { api } from '../api'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { KIND_LABEL, useStore } from '../store'
import type { CanvasNode, Output } from '../types'
import { Composer } from './Composer'
import { SaveToLibraryDialog } from '../panels/LibraryPanel'
import { NodeActions } from './NodeActions'
import { FullscreenDoc, RichText } from './RichText'
import { Waveform } from '../tools/Waveform'
import './nodes.css'

function AudioPlayer({ url }: { url: string }) {
  const [p, setP] = useState(0)
  return (
    <div className="audio-player nodrag">
      <Waveform url={url} progress={p} />
      <audio src={url} controls onTimeUpdate={e => setP(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} />
    </div>
  )
}

export function Media({ output, controls = true }: { output: Output; controls?: boolean }) {
  if (!output.url) return null
  if (output.kind === 'audio') return <AudioPlayer url={output.url} />
  // mock videos are animated SVGs
  if (output.kind === 'video' && !output.mime?.includes('svg'))
    return <video src={output.url} controls={controls} muted loop playsInline className={controls ? 'nodrag' : undefined} />
  return <img src={output.url} alt={output.prompt ?? ''} draggable={false} />
}

const ASPECT: Record<string, string> = { '1:1': '1 / 1', '16:9': '16 / 9', '9:16': '9 / 16', '4:3': '4 / 3', '3:4': '3 / 4' }

function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateData, set, projectId, notify } = useStore.getState()
  const readOnly = useStore(s => s.readOnly)
  const zoom = useFlow(s => s.transform[2])
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [full, setFull] = useState(false)
  // floating UI keeps a readable size when zoomed out
  const scale = Math.min(2.5, Math.max(1, 1 / zoom))
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
      {data.kind === 'text' && !readOnly && <NodeResizer isVisible={!!selected} minWidth={200} minHeight={120} lineClassName="cnode-resize-line" handleClassName="cnode-resize-handle" />}
      <div className="cnode-label" style={{ visibility: zoom < 0.35 ? 'hidden' : undefined }}>
        <Icon name={data.kind === 'text' ? 'list' : data.kind} size={14} />
        {data.pin && <i className="swatch pin-dot" style={{ background: data.pin }} title="Label colour" />}
        <input className="nodrag title-input" value={data.title} onChange={e => updateData(id, { title: e.target.value })} size={Math.max(4, data.title.length)} />
        {data.tags?.map(t => <span key={t} className="cnode-tag">#{t}</span>)}
      </div>

      {selected && !readOnly && (
        <NodeActions id={id} data={data} scale={scale} onUpload={() => fileRef.current?.click()} onSave={() => setSaving(true)}
          onFullscreen={() => (data.kind === 'text' ? setFull(true) : out?.url && set({ lightbox: out }))} />
      )}

      <Handle type="target" position={Position.Left} className="port port-in"><Icon name="plus" size={12} /></Handle>
      <Handle type="source" position={Position.Right} className="port port-out" title="Click to add a connected node, drag to connect"
        onClick={e => {
          // TapNow: the right + creates a downstream node that is already connected
          const rf = useStore.getState().rf
          if (!rf) return
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          set({ addMenu: { screen: { x: e.clientX + 12, y: e.clientY - 20 }, flow: { x: at.x + 120, y: at.y }, fromNodeIds: [id] } })
        }}><Icon name="plus" size={12} /></Handle>

      <div className="cnode-card">
        {data.kind === 'text' ? (
          <div className="text-node" style={{ background: data.bg }} onDoubleClick={() => !readOnly && setFull(true)} title={readOnly ? undefined : 'Double-click to edit'}>
            <RichText value={data.prompt} selected={!!selected} />
            {busy && <div className="text-busy"><div className="shimmer" /><span>{data.status === 'queued' ? 'Queued' : data.message ?? 'Writing…'}</span></div>}
          </div>
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
      {soloSelected && !readOnly && <Composer id={id} data={data} zoom={zoom} onUpload={() => fileRef.current?.click()} />}
      {full && <FullscreenDoc id={id} onClose={() => setFull(false)} />}
      {saving && <SaveToLibraryDialog node={{ id, data } as CanvasNode} onClose={() => setSaving(false)} />}
    </div>
  )
}

export default memo(CanvasNodeView)
