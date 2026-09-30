import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../api'
import { appendToPlaylist, createPlaylist, focusNode, playlists, setClips } from '../canvasOps'
import { playSequence, type SeqClip } from '../exporter'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { clipAt, fmtTime, layoutClips, moveClip, splitAt, totalDuration, trimEdge, trimLeftTo, trimRightTo, type ClipView } from '../playlist'
import { useStore } from '../store'
import { isMock, rasterize, uploadCanvas } from '../tools/media'
import type { CanvasNode, PlaylistNode } from '../types'

// ---------- source durations (video metadata is loaded once per url) ----------
const durCache = new Map<string, number>()
function useSourceDurations(nodes: CanvasNode[]) {
  const [, tick] = useState(0)
  useEffect(() => {
    for (const n of nodes) {
      const o = activeOutput(n)
      if (!o?.url || n.data.kind !== 'video' || isMock(o) || durCache.has(o.url)) continue
      durCache.set(o.url, 0)
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => { durCache.set(o.url!, v.duration || 5); tick(x => x + 1) }
      v.src = o.url
    }
  }, [nodes])
  return (n?: CanvasNode) => {
    if (!n) return 3
    const o = activeOutput(n)
    if (n.data.kind === 'video' && o?.url && !isMock(o)) return durCache.get(o.url) || n.data.params.duration || 5
    return n.data.params.duration ?? (n.data.kind === 'video' ? 5 : 3)
  }
}

export const clipThumb = (n?: CanvasNode) => {
  const o = n && activeOutput(n)
  if (!o?.url) return null
  return o.kind === 'video' && !isMock(o) ? <video src={`${o.url}#t=0.5`} muted preload="metadata" /> : <img src={o.url} alt="" draggable={false} />
}

/** The bottom editor for the active Playlist (TapNow Playlists: reorder, trim, C/Q/E, merged export). */
export function PlaylistPanel() {
  const lists = useStore(useShallow(s => s.extras.filter((e): e is PlaylistNode => e.type === 'playlist')))
  const activeId = useStore(s => s.activePlaylist)
  const nodes = useStore(s => s.nodes)
  const projectName = useStore(s => s.projectName)
  const pl = lists.find(p => p.id === activeId) ?? lists[0]
  const [open, setOpen] = useState(true)
  const [pps, setPps] = useState(40) // pixels per second
  const [playhead, setPlayhead] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'preview' | 'export' | 'render'>('idle')
  const [progress, setProgress] = useState({ clip: 0, t: 0 })
  const [menu, setMenu] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const abort = useRef<AbortController>()
  const track = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const clipNodes = useMemo(() => (pl?.data.clips ?? []).map(c => byId.get(c.nodeId)).filter(Boolean) as CanvasNode[], [pl, byId])
  const srcDur = useSourceDurations(clipNodes)
  const views = useMemo(() => layoutClips(pl?.data.clips ?? [], id => srcDur(byId.get(id))), [pl, byId, srcDur])
  const total = totalDuration(views)
  const notify = useStore.getState().notify

  const update = (fn: (v: ClipView[]) => PlaylistNode['data']['clips']) => pl && setClips(pl.id, fn(views))

  // C / Q / E / Delete while the editor has focus
  const onKey = (e: React.KeyboardEvent) => {
    if (!pl || (e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key.toLowerCase()
    if (k === 'c') { e.preventDefault(); update(v => splitAt(pl.data.clips, v, playhead)) }
    else if (k === 'q') { e.preventDefault(); update(v => trimLeftTo(pl.data.clips, v, playhead)) }
    else if (k === 'e') { e.preventDefault(); update(v => trimRightTo(pl.data.clips, v, playhead)) }
    else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); setClips(pl.id, pl.data.clips.filter(c => c.id !== sel)); setSel(null) }
    e.stopPropagation()
  }

  const seqClips = (): SeqClip[] => views.flatMap(v => {
    const n = byId.get(v.clip.nodeId), o = n && activeOutput(n)
    if (!o?.url || (o.kind !== 'video' && o.kind !== 'image')) return []
    return [{ url: o.url, kind: o.kind as 'video' | 'image', mime: o.mime, duration: v.dur, in: isMock(o) || o.kind === 'image' ? 0 : v.clip.in, out: isMock(o) || o.kind === 'image' ? v.dur : v.clip.in + v.dur }]
  })

  const play = async (record: boolean) => {
    const clips = seqClips()
    if (!clips.length) return notify('No generated clips in this playlist yet', 'error')
    abort.current = new AbortController()
    setMode(record ? 'export' : 'preview')
    await new Promise(r => requestAnimationFrame(r))
    try {
      const blob = await playSequence(canvas.current!, clips, { record, signal: abort.current.signal, onProgress: (clip, t) => setProgress({ clip, t }) })
      if (blob) {
        const file = new File([blob], `${(pl?.data.title || projectName).replace(/[^\w-]+/g, '_')}.webm`, { type: 'video/webm' })
        const [asset] = await api.upload([file], useStore.getState().projectId)
        download(asset.url, file.name)
        notify('Exported WebM — saved to Assets and downloaded')
      }
    } catch (e: any) { notify(e.message, 'error') } finally { setMode('idle') }
  }

  /** Server-side merged MP4 (ffmpeg); mock SVG clips are rasterised first. */
  const renderMp4 = async (toCanvas: boolean) => {
    if (!pl) return
    const clips = seqClips()
    if (!clips.length) return notify('No generated clips in this playlist yet', 'error')
    setMode('render')
    try {
      const prepared = []
      for (const c of clips) {
        if (c.mime?.includes('svg')) {
          const png = await uploadCanvas(await rasterize(c.url, 1920), 'still')
          prepared.push({ url: png.url, kind: 'image', in: 0, duration: c.duration })
        } else prepared.push({ url: c.url, kind: c.kind, in: c.in ?? 0, out: c.out, duration: c.duration })
      }
      const res = await fetch('/api/ops/playlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clips: prepared, width: 1280, height: 720, projectId: useStore.getState().projectId, name: pl.data.title }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Render failed')
      if (toCanvas) {
        const st = useStore.getState()
        const pos = { x: pl.position.x + 420, y: pl.position.y }
        st.addAssetNode({ ...data.asset, name: `${pl.data.title} (merged)` }, pos)
        notify('Merged video added to the canvas')
      } else {
        download(data.asset.url, `${pl.data.title.replace(/[^\w-]+/g, '_')}.mp4`)
        notify('Merged MP4 downloaded')
      }
    } catch (e: any) { notify(e.message, 'error') } finally { setMode('idle') }
  }

  const downloadClips = async () => {
    if (!pl) return
    const files = views.flatMap((v, i) => {
      const n = byId.get(v.clip.nodeId), o = n && activeOutput(n)
      return o?.url ? [{ url: o.url, name: `${String(i + 1).padStart(2, '0')} ${n!.data.title}` }] : []
    })
    const res = await fetch('/api/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pl.data.title, files }) })
    if (!res.ok) return notify('Download failed', 'error')
    const url = URL.createObjectURL(await res.blob())
    download(url, `${pl.data.title}.zip`)
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  // drag handles: reorder (body) and trim (edges)
  const drag = useRef<{ kind: 'move' | 'in' | 'out'; index: number; x0: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent, index: number, kind: 'move' | 'in' | 'out') => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, index, x0: e.clientX, moved: false }
    setSel(views[index].clip.id)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !pl) return
    const dx = e.clientX - d.x0
    if (Math.abs(dx) > 3) d.moved = true
    if (d.kind === 'move') return
    if (Math.abs(dx) < 2) return
    setClips(pl.id, trimEdge(pl.data.clips, views, d.index, d.kind, dx / pps))
    d.x0 = e.clientX
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || !pl || d.kind !== 'move' || !d.moved || !track.current) return
    const x = e.clientX - track.current.getBoundingClientRect().left + track.current.scrollLeft
    const t = x / pps
    const to = views.findIndex(v => t < v.start + v.dur / 2)
    setClips(pl.id, moveClip(pl.data.clips, d.index, to < 0 ? views.length - 1 : to > d.index ? to - 1 : to))
  }

  if (!lists.length) {
    return (
      <section className={`timeline ${open ? '' : 'collapsed'}`}>
        <div className="timeline-head">
          <button className="icon-btn" onClick={() => setOpen(!open)}><Icon name={open ? 'chevron' : 'timeline'} /></button>
          <b>Playlist</b>
          <span className="muted">Select video or image nodes and choose <Icon name="timeline" size={12} /> Create playlist, or use the node toolbar.</span>
          <div className="spacer" />
          <button className="btn" onClick={() => createPlaylist(useStore.getState().nodes.filter(n => n.selected).map(n => n.id))}><Icon name="plus" size={14} /> New playlist</button>
        </div>
      </section>
    )
  }

  const cur = clipAt(views, playhead)
  return (
    <section className={`timeline ${open ? '' : 'collapsed'}`} tabIndex={0} onKeyDown={onKey}>
      <div className="timeline-head">
        <button className="icon-btn" onClick={() => setOpen(!open)} title="Toggle editor"><Icon name={open ? 'chevron' : 'timeline'} /></button>
        {lists.length > 1
          ? <select value={pl.id} onChange={e => useStore.setState({ activePlaylist: e.target.value })}>{lists.map(p => <option key={p.id} value={p.id}>{p.data.title}</option>)}</select>
          : <b>{pl.data.title}</b>}
        <span className="muted">{views.length} clip{views.length === 1 ? '' : 's'} · {fmtTime(total)}{cur ? ` · playhead ${fmtTime(playhead)}` : ''}</span>
        <span className="muted small kbd-hint"><kbd>C</kbd> split <kbd>Q</kbd>/<kbd>E</kbd> trim to playhead <kbd>Del</kbd> remove</span>
        <div className="spacer" />
        <label className="mini">Zoom<input type="range" min={10} max={160} value={pps} onChange={e => setPps(Number(e.target.value))} /></label>
        <button className="btn" disabled={!views.length || mode !== 'idle'} onClick={() => play(false)}><Icon name="play" size={14} /> Preview</button>
        <span className="pin-wrap">
          <button className="btn primary" disabled={!views.length || mode !== 'idle'} onClick={() => setMenu(!menu)}><Icon name="film" size={14} /> {mode === 'render' ? 'Rendering…' : 'Export'} <Icon name="chevron" size={10} /></button>
          {menu && <>
            <div className="backdrop-clear" onPointerDown={() => setMenu(false)} />
            <div className="export-menu">
              <button onClick={() => { setMenu(false); renderMp4(false) }}><b>Merged MP4</b><span>One video, rendered with ffmpeg</span></button>
              <button onClick={() => { setMenu(false); renderMp4(true) }}><b>Export to canvas</b><span>Merged video as a new node</span></button>
              <button onClick={() => { setMenu(false); downloadClips() }}><b>Clips in order (zip)</b><span>Original files, numbered</span></button>
              <button onClick={() => { setMenu(false); play(true) }}><b>WebM (browser)</b><span>Records in real time</span></button>
            </div>
          </>}
        </span>
      </div>
      {open && (
        <div className="track nowheel" ref={track} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerDown={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('ruler')) { const r = track.current!.getBoundingClientRect(); setPlayhead(Math.max(0, Math.min(total, (e.clientX - r.left + track.current!.scrollLeft) / pps))); track.current!.parentElement?.focus() } }}>
          <div className="ruler" style={{ width: Math.max(total * pps + 200, 600) }}>
            {Array.from({ length: Math.ceil(total) + 1 }, (_, s) => s % (pps < 25 ? 5 : 1) === 0 && <span key={s} style={{ left: s * pps }}>{fmtTime(s).replace(/\.0$/, '')}</span>)}
          </div>
          <div className="lane" style={{ width: Math.max(total * pps + 200, 600) }}>
            {views.map((v, i) => {
              const n = byId.get(v.clip.nodeId)
              return (
                <div key={v.clip.id} className={`tclip ${sel === v.clip.id ? 'sel' : ''} ${n ? '' : 'missing'}`} style={{ left: v.start * pps, width: Math.max(8, v.dur * pps - 2) }}
                  onPointerDown={e => onPointerDown(e, i, 'move')} onDoubleClick={() => n && focusNode(n.id)}
                  onContextMenu={e => { e.preventDefault(); setClips(pl.id, pl.data.clips.filter(c => c.id !== v.clip.id)) }}
                  title={`${n?.data.title ?? 'missing'} · ${fmtTime(v.dur)} (in ${v.clip.in.toFixed(1)}s) — drag to reorder, edges to trim, right-click to remove`}>
                  <div className="tclip-thumb">{clipThumb(n)}</div>
                  <span className="tclip-label">{i + 1}. {n?.data.title ?? 'missing'} · {v.dur.toFixed(1)}s</span>
                  <i className="edge l" onPointerDown={e => onPointerDown(e, i, 'in')} />
                  <i className="edge r" onPointerDown={e => onPointerDown(e, i, 'out')} />
                </div>
              )
            })}
            {!views.length && <p className="muted pad">Empty playlist — drag video or image nodes onto the playlist node, or use its toolbar.</p>}
          </div>
          <div className="playhead" style={{ left: playhead * pps }} />
        </div>
      )}
      {mode === 'preview' || mode === 'export' ? (
        <div className="modal-backdrop">
          <div className="player">
            <canvas ref={canvas} width={1280} height={720} />
            <div className="player-bar">
              <span>{mode === 'export' ? 'Recording' : 'Preview'} · clip {progress.clip + 1}/{views.length}</span>
              <div className="bar"><i style={{ width: `${((progress.clip + progress.t) / Math.max(1, views.length)) * 100}%` }} /></div>
              <button className="btn" onClick={() => abort.current?.abort()}><Icon name="stop" size={14} /> {mode === 'export' ? 'Cancel' : 'Close'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function download(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
}

export { appendToPlaylist, playlists }
