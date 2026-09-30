import { useRef, useState } from 'react'
import { api } from '../api'
import { playSequence, type SeqClip } from '../exporter'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { useStore } from '../store'

export function Timeline() {
  const timeline = useStore(s => s.timeline)
  const nodes = useStore(s => s.nodes)
  const projectName = useStore(s => s.projectName)
  const { moveClip, removeClip, notify, rf, set } = useStore.getState()
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<'idle' | 'preview' | 'export'>('idle')
  const [progress, setProgress] = useState({ clip: 0, t: 0 })
  const canvas = useRef<HTMLCanvasElement>(null)
  const abort = useRef<AbortController>()

  const items = timeline.map(c => {
    const n = nodes.find(x => x.id === c.nodeId)
    return { clip: c, node: n, out: n && activeOutput(n) }
  })
  const playable: SeqClip[] = items.filter(i => i.out?.url && (i.out.kind === 'video' || i.out.kind === 'image'))
    .map(i => ({ url: i.out!.url!, kind: i.out!.kind as 'image' | 'video', mime: i.out!.mime, duration: i.node!.data.params.duration ?? 3 }))

  const run = async (record: boolean) => {
    if (!playable.length) return notify('No generated clips in the timeline yet', 'error')
    abort.current = new AbortController()
    setMode(record ? 'export' : 'preview')
    await new Promise(r => requestAnimationFrame(r))
    try {
      const blob = await playSequence(canvas.current!, playable, { record, signal: abort.current.signal, onProgress: (clip, t) => setProgress({ clip, t }) })
      if (blob) {
        const file = new File([blob], `${projectName.replace(/[^\w-]+/g, '_') || 'export'}.webm`, { type: 'video/webm' })
        const [asset] = await api.upload([file], useStore.getState().projectId)
        const a = document.createElement('a')
        a.href = asset.url; a.download = file.name; a.click()
        notify('Exported — saved to Assets and downloaded')
      }
    } catch (e: any) { notify(e.message, 'error') }
    finally { setMode('idle') }
  }

  const skipped = items.length - playable.length
  return (
    <section className={`timeline ${open ? '' : 'collapsed'}`}>
      <div className="timeline-head">
        <button className="icon-btn" onClick={() => setOpen(!open)} title="Toggle timeline"><Icon name={open ? 'chevron' : 'timeline'} /></button>
        <b>Timeline</b>
        <span className="muted">{playable.length} clip{playable.length === 1 ? '' : 's'}{skipped ? ` · ${skipped} not generated yet` : ''}</span>
        <div className="spacer" />
        <button className="btn" disabled={!playable.length || mode !== 'idle'} onClick={() => run(false)}><Icon name="play" size={14} /> Preview</button>
        <button className="btn primary" disabled={!playable.length || mode !== 'idle'} onClick={() => run(true)}><Icon name="film" size={14} /> Export WebM</button>
      </div>
      {open && (
        <div className="clips nowheel">
          {items.map(({ clip, node, out }, i) => (
            <div key={clip.id} className={`clip ${mode !== 'idle' && playable[progress.clip]?.url === out?.url ? 'playing' : ''}`}
              onClick={() => { if (node) { rf?.fitView({ nodes: [{ id: node.id }], duration: 400, maxZoom: 1.2 }); set({ nodes: useStore.getState().nodes.map(n => ({ ...n, selected: n.id === node.id })) }) } }}>
              <div className="clip-thumb">
                {out?.url ? (out.kind === 'video' && !out.mime?.includes('svg') ? <video src={out.url} muted /> : <img src={out.url} alt="" />) : <Icon name="video" size={20} />}
                <span className="clip-idx">{i + 1}</span>
              </div>
              <div className="clip-meta"><span>{node?.data.title ?? 'missing'}</span>
                <div className="clip-actions" onClick={e => e.stopPropagation()}>
                  <button onClick={() => moveClip(clip.id, -1)} title="Move left"><Icon name="left" size={12} /></button>
                  <button onClick={() => moveClip(clip.id, 1)} title="Move right"><Icon name="right" size={12} /></button>
                  <button onClick={() => removeClip(clip.id)} title="Remove"><Icon name="x" size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          {!items.length && <p className="muted pad">Generated videos land here automatically. Add images or videos with the timeline button on a node.</p>}
        </div>
      )}
      {mode !== 'idle' && (
        <div className="modal-backdrop">
          <div className="player">
            <canvas ref={canvas} width={1280} height={720} />
            <div className="player-bar">
              <span>{mode === 'export' ? 'Recording' : 'Preview'} · clip {progress.clip + 1}/{playable.length}</span>
              <div className="bar"><i style={{ width: `${((progress.clip + progress.t) / playable.length) * 100}%` }} /></div>
              <button className="btn" onClick={() => abort.current?.abort()}><Icon name="stop" size={14} /> {mode === 'export' ? 'Cancel' : 'Close'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
