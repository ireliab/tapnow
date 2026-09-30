import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../panels/Chrome'
import { useStore } from '../store'
import type { ModelInfo } from '../types'
import { anglePrompt, centeredCrop, gridCells, lightPrompt, outpaintLayout, type Rect } from './geometry'
import { MaskEditor, type MaskEditorHandle } from './MaskEditor'
import { addDerived, node, rasterize, runToolNode, sourceUrl, toolModels, uploadCanvas } from './media'

export type ImageTool = 'crop' | 'resize' | 'split' | 'annotate' | 'enhance' | 'cutout' | 'redraw' | 'erase' | 'outpaint' | 'relight' | 'angle'

const PAID = new Set(['fal', 'openai'])
function ModelPick({ list, value, onChange }: { list: ModelInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="field"><span>Model</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {list.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{PAID.has(m.provider) ? ' · paid' : ''}{m.available ? '' : ' — setup needed'}</option>)}
      </select>
    </label>
  )
}
const useToolModel = (tool: string) => {
  const models = useStore(s => s.models)
  const list = useMemo(() => toolModels(models, tool), [models, tool])
  const [model, setModel] = useState(() => list.find(m => m.available)?.id ?? '')
  return { list, model, setModel }
}
/** Image-editing models that take a reference image (for Multi-angle). */
const useEditModel = () => {
  const models = useStore(s => s.models)
  const list = useMemo(() => models.filter(m => m.kind === 'image' && !m.tool && m.maxImages > 0).sort((a, b) => Number(b.available) - Number(a.available) || Number(a.provider === 'mock') - Number(b.provider === 'mock')), [models])
  const [model, setModel] = useState(() => list.find(m => m.available)?.id ?? '')
  return { list, model, setModel }
}

const TITLES: Record<ImageTool, string> = {
  crop: 'Crop', resize: 'Resize pixels', split: 'Quick Split', annotate: 'Annotate', enhance: 'Enhance / Upscale', cutout: 'Cutout',
  redraw: 'Redraw an area', erase: 'Erase', outpaint: 'Outpaint', relight: 'Relight', angle: 'Multi-angle',
}

export function ImageToolDialog({ nodeId, tool, onClose }: { nodeId: string; tool: ImageTool; onClose: () => void }) {
  const url = sourceUrl(nodeId)
  const notify = useStore.getState().notify
  const [busy, setBusy] = useState(false)
  if (!url) return null
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true)
    try { await fn(); onClose() } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  const props = { nodeId, url, run, busy }
  return (
    <Modal title={`${TITLES[tool]} · ${node(nodeId)?.data.title ?? ''}`} onClose={onClose} wide>
      {tool === 'crop' && <Crop {...props} />}
      {tool === 'resize' && <Resize {...props} />}
      {tool === 'split' && <Split {...props} />}
      {tool === 'annotate' && <Annotate {...props} />}
      {tool === 'enhance' && <Enhance {...props} />}
      {(tool === 'redraw' || tool === 'erase') && <Inpaint {...props} erase={tool === 'erase'} />}
      {tool === 'outpaint' && <Outpaint {...props} />}
      {tool === 'relight' && <Relight {...props} />}
      {tool === 'angle' && <Angle {...props} />}
    </Modal>
  )
}

type P = { nodeId: string; url: string; run: (fn: () => Promise<unknown> | unknown) => void; busy: boolean }
const Foot = ({ busy, label, onRun, note }: { busy: boolean; label: string; onRun: () => void; note?: string }) => (
  <div className="modal-foot">{note && <span className="muted small">{note}</span>}<div className="spacer" /><button className="btn primary" disabled={busy} onClick={onRun}>{busy ? 'Working…' : label}</button></div>
)

function useNatural(url: string) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => { const i = new Image(); i.onload = () => setSize({ w: i.naturalWidth || 1024, h: i.naturalHeight || 1024 }); i.src = url }, [url])
  return size
}

// ---------- local (no model) ----------
function Crop({ nodeId, url, run, busy }: P) {
  const { w, h } = useNatural(url)
  const [aspect, setAspect] = useState('free')
  const [r, setR] = useState<Rect | null>(null)
  useEffect(() => { if (w) setR(aspect === 'free' ? { x: 0, y: 0, w, h } : centeredCrop(w, h, aspect)) }, [w, h, aspect])
  if (!r) return <p className="muted">Loading…</p>
  const set = (k: keyof Rect, v: number) => setR({ ...r, [k]: Math.max(0, Math.min(v, k === 'x' || k === 'w' ? w : h)) })
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <>
      <div className="opts">{['free', '1:1', '16:9', '9:16', '4:3', '3:4'].map(a => <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>{a}</button>)}</div>
      <div className="tool-preview"><img src={url} alt="" /><div className="crop-box" style={{ left: pct(r.x, w), top: pct(r.y, h), width: pct(r.w, w), height: pct(r.h, h) }} /></div>
      <div className="row2">
        <label className="field"><span>X {r.x}px</span><input type="range" min={0} max={w - r.w} value={r.x} onChange={e => set('x', Number(e.target.value))} /></label>
        <label className="field"><span>Y {r.y}px</span><input type="range" min={0} max={h - r.h} value={r.y} onChange={e => set('y', Number(e.target.value))} /></label>
        {aspect === 'free' && <>
          <label className="field"><span>Width {r.w}px</span><input type="range" min={16} max={w - r.x} value={r.w} onChange={e => set('w', Number(e.target.value))} /></label>
          <label className="field"><span>Height {r.h}px</span><input type="range" min={16} max={h - r.y} value={r.h} onChange={e => set('h', Number(e.target.value))} /></label>
        </>}
      </div>
      <Foot busy={busy} label="Crop" onRun={() => run(async () => {
        const src = await rasterize(url, 8192)
        const c = document.createElement('canvas'); c.width = r.w; c.height = r.h
        c.getContext('2d')!.drawImage(src, r.x * (src.width / w), r.y * (src.height / h), r.w * (src.width / w), r.h * (src.height / h), 0, 0, r.w, r.h)
        addDerived(nodeId, [{ kind: 'image', title: `${node(nodeId)?.data.title} · crop`, asset: await uploadCanvas(c, 'crop') }])
      })} />
    </>
  )
}

function Resize({ nodeId, url, run, busy }: P) {
  const { w, h } = useNatural(url)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lock, setLock] = useState(true)
  useEffect(() => { if (w) setSize({ w, h }) }, [w, h])
  const setW = (v: number) => setSize({ w: v, h: lock ? Math.round((v * h) / w) : size.h })
  const setH = (v: number) => setSize({ h: v, w: lock ? Math.round((v * w) / h) : size.w })
  return (
    <>
      <p className="muted">Original {w}×{h}px</p>
      <div className="row2">
        <label className="field"><span>Width</span><input type="number" min={16} max={8192} value={size.w} onChange={e => setW(Number(e.target.value))} /></label>
        <label className="field"><span>Height</span><input type="number" min={16} max={8192} value={size.h} onChange={e => setH(Number(e.target.value))} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} /> Keep aspect ratio</label>
      <div className="opts">{[0.5, 2].map(k => <button key={k} onClick={() => setSize({ w: Math.round(w * k), h: Math.round(h * k) })}>{k}×</button>)}{[1080, 1920].map(v => <button key={v} onClick={() => setW(v)}>{v}px wide</button>)}</div>
      <Foot busy={busy} label="Resize" note="Pixel resize (no AI). Use Enhance for AI upscaling." onRun={() => run(async () => {
        if (size.w < 16 || size.h < 16 || size.w > 8192 || size.h > 8192) throw new Error('Size must be between 16 and 8192px')
        const src = await rasterize(url, 8192)
        const c = document.createElement('canvas'); c.width = size.w; c.height = size.h
        const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, size.w, size.h)
        addDerived(nodeId, [{ kind: 'image', title: `${node(nodeId)?.data.title} · ${size.w}×${size.h}`, asset: await uploadCanvas(c, `resize-${size.w}x${size.h}`) }])
      })} />
    </>
  )
}

function Split({ nodeId, url, run, busy }: P) {
  const [n, setN] = useState(2)
  return (
    <>
      <div className="opts">{[2, 3, 4].map(k => <button key={k} className={n === k ? 'on' : ''} onClick={() => setN(k)}>{k}×{k}</button>)}</div>
      <div className="tool-preview"><img src={url} alt="" />
        <div className="grid-lines" style={{ backgroundSize: `${100 / n}% ${100 / n}%` }} /></div>
      <Foot busy={busy} label={`Split into ${n * n} nodes`} note="For storyboard grids and character sheets." onRun={() => run(async () => {
        const src = await rasterize(url, 8192)
        const cells = gridCells(src.width, src.height, n)
        const assets = []
        for (const [i, r] of cells.entries()) {
          const c = document.createElement('canvas'); c.width = r.w; c.height = r.h
          c.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
          assets.push({ kind: 'image' as const, title: `${node(nodeId)?.data.title} · ${i + 1}`, asset: await uploadCanvas(c, `split-${i + 1}`) })
        }
        addDerived(nodeId, assets, 'grid')
      })} />
    </>
  )
}

function Annotate({ nodeId, url, run, busy }: P) {
  const ed = useRef<MaskEditorHandle>(null)
  const [note, setNote] = useState('')
  return (
    <>
      <MaskEditor ref={ed} url={url} mode="annotate" />
      <label className="field"><span>Note (optional, burned into the image)</span><input value={note} maxLength={120} onChange={e => setNote(e.target.value)} placeholder="e.g. make this jacket red, keep the face" /></label>
      <Foot busy={busy} label="Save annotated copy" note="The annotated copy can be sent to the Agent or used as a reference." onRun={() => run(async () => {
        const c = await ed.current!.composite(note)
        addDerived(nodeId, [{ kind: 'image', title: `${node(nodeId)?.data.title} · annotated`, asset: await uploadCanvas(c, 'annotated'), data: { prompt: note } }])
      })} />
    </>
  )
}

// ---------- model-backed ----------
function Enhance({ nodeId, run, busy }: P) {
  const { list, model, setModel } = useToolModel('upscale')
  const [factor, setFactor] = useState(2)
  return (
    <>
      <ModelPick list={list} value={model} onChange={setModel} />
      <div className="opts">{[2, 4].map(k => <button key={k} className={factor === k ? 'on' : ''} onClick={() => setFactor(k)}>{k}×</button>)}</div>
      <Foot busy={busy} label="Enhance" onRun={() => run(() => runToolNode(nodeId, { tool: 'upscale', model, title: `${node(nodeId)?.data.title} · enhanced`, params: { tool: { factor } } }))} />
    </>
  )
}

function Inpaint({ nodeId, url, run, busy, erase }: P & { erase: boolean }) {
  const ed = useRef<MaskEditorHandle>(null)
  const { list, model, setModel } = useToolModel('inpaint')
  const [prompt, setPrompt] = useState('')
  return (
    <>
      <MaskEditor ref={ed} url={url} mode="mask" />
      {!erase && <label className="field"><span>What should appear in the painted area?</span><input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. a red umbrella" /></label>}
      <ModelPick list={list} value={model} onChange={setModel} />
      <Foot busy={busy} label={erase ? 'Erase' : 'Redraw'} onRun={() => run(async () => {
        if (ed.current!.empty()) throw new Error('Paint over the area first')
        if (!erase && !prompt.trim()) throw new Error('Describe what to draw')
        const mask = await uploadCanvas(ed.current!.mask(), 'mask')
        runToolNode(nodeId, {
          tool: 'inpaint', model, title: `${node(nodeId)?.data.title} · ${erase ? 'erased' : 'redraw'}`,
          prompt: erase ? 'Remove the masked object completely and fill the area naturally from the surrounding background' : prompt,
          params: { mask: mask.url },
        })
      })} />
    </>
  )
}

function Outpaint({ nodeId, url, run, busy }: P) {
  const { w, h } = useNatural(url)
  const { list, model, setModel } = useToolModel('inpaint')
  const [aspect, setAspect] = useState('16:9')
  const [extra, setExtra] = useState(0)
  const [prompt, setPrompt] = useState('')
  const l = w ? outpaintLayout(w, h, aspect, extra / 100) : null
  return (
    <>
      <div className="opts">{['16:9', '9:16', '1:1', '4:3', '3:4'].map(a => <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>{a}</button>)}</div>
      <label className="field"><span>Extra margin {extra}%</span><input type="range" min={0} max={100} step={5} value={extra} onChange={e => setExtra(Number(e.target.value))} /></label>
      {l && (
        <div className="tool-preview outpaint" style={{ aspectRatio: `${l.width} / ${l.height}` }}>
          <img src={url} alt="" style={{ left: `${(l.x / l.width) * 100}%`, top: `${(l.y / l.height) * 100}%`, width: `${(w / l.width) * 100}%` }} />
        </div>
      )}
      <label className="field"><span>Describe the extended area (optional)</span><input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="continue the beach and sky" /></label>
      <ModelPick list={list} value={model} onChange={setModel} />
      <Foot busy={busy} label="Outpaint" note={l ? `New canvas ${l.width}×${l.height}px` : undefined} onRun={() => run(async () => {
        if (!l) return
        const src = await rasterize(url, 8192)
        const k = src.width / w
        const img = document.createElement('canvas'); img.width = l.width; img.height = l.height
        const ictx = img.getContext('2d')!
        ictx.fillStyle = '#808080'; ictx.fillRect(0, 0, l.width, l.height)
        ictx.drawImage(src, 0, 0, src.width, src.height, l.x, l.y, src.width / k, src.height / k)
        const mask = document.createElement('canvas'); mask.width = l.width; mask.height = l.height
        const mctx = mask.getContext('2d')!
        mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, l.width, l.height)
        // keep a few pixels of overlap so the seam blends
        mctx.fillStyle = '#000'; mctx.fillRect(l.x + 8, l.y + 8, w - 16, h - 16)
        const [canvasAsset, maskAsset] = [await uploadCanvas(img, 'outpaint-canvas'), await uploadCanvas(mask, 'outpaint-mask')]
        const [canvasNode] = addDerived(nodeId, [{ kind: 'image', title: `${node(nodeId)?.data.title} · ${aspect} canvas`, asset: canvasAsset }])
        runToolNode(canvasNode, { tool: 'inpaint', model, title: `${node(nodeId)?.data.title} · outpaint ${aspect}`, prompt: prompt || 'Seamlessly extend the scene beyond the original borders, matching perspective, lighting and style', params: { mask: maskAsset.url, aspect } })
      })} />
    </>
  )
}

function Relight({ nodeId, run, busy }: P) {
  const { list, model, setModel } = useToolModel('relight')
  const [o, setO] = useState({ direction: 'left', brightness: 55, temperature: 5000, rim: false })
  const prompt = lightPrompt(o)
  return (
    <>
      <div className="field"><span>Light direction</span><div className="opts">{['left', 'right', 'top', 'bottom', 'front', 'back'].map(d => <button key={d} className={o.direction === d ? 'on' : ''} onClick={() => setO({ ...o, direction: d })}>{d}</button>)}</div></div>
      <div className="row2">
        <label className="field"><span>Brightness {o.brightness}</span><input type="range" min={0} max={100} value={o.brightness} onChange={e => setO({ ...o, brightness: Number(e.target.value) })} /></label>
        <label className="field"><span>Colour temperature {o.temperature}K</span><input type="range" min={2500} max={9000} step={100} value={o.temperature} onChange={e => setO({ ...o, temperature: Number(e.target.value) })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={o.rim} onChange={e => setO({ ...o, rim: e.target.checked })} /> Rim light</label>
      <p className="muted small">Prompt: {prompt}</p>
      <ModelPick list={list} value={model} onChange={setModel} />
      <Foot busy={busy} label="Relight" onRun={() => run(() => runToolNode(nodeId, { tool: 'relight', model, title: `${node(nodeId)?.data.title} · relit`, prompt }))} />
    </>
  )
}

function Angle({ nodeId, run, busy }: P) {
  const { list, model, setModel } = useEditModel()
  const [o, setO] = useState({ rotate: 30, tilt: 0, distance: 'medium' as 'close' | 'medium' | 'far', wide: false })
  const prompt = anglePrompt(o)
  return (
    <>
      <div className="row2">
        <label className="field"><span>Rotate {o.rotate}°</span><input type="range" min={-90} max={90} step={15} value={o.rotate} onChange={e => setO({ ...o, rotate: Number(e.target.value) })} /></label>
        <label className="field"><span>Tilt {o.tilt}°</span><input type="range" min={-45} max={45} step={5} value={o.tilt} onChange={e => setO({ ...o, tilt: Number(e.target.value) })} /></label>
      </div>
      <div className="field"><span>Distance</span><div className="opts">{(['close', 'medium', 'far'] as const).map(d => <button key={d} className={o.distance === d ? 'on' : ''} onClick={() => setO({ ...o, distance: d })}>{d}</button>)}</div></div>
      <label className="check"><input type="checkbox" checked={o.wide} onChange={e => setO({ ...o, wide: e.target.checked })} /> Wide-angle lens</label>
      <p className="muted small">Prompt: {prompt}</p>
      <ModelPick list={list} value={model} onChange={setModel} />
      <Foot busy={busy} label="Generate angle" onRun={() => run(() => runToolNode(nodeId, { model, title: `${node(nodeId)?.data.title} · ${o.rotate}°`, prompt }))} />
    </>
  )
}
