import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

interface Stroke { points: Array<[number, number]>; size: number; color: string; erase?: boolean }
export interface MaskEditorHandle {
  /** black background, white where painted — the inpaint mask at natural size */
  mask(): HTMLCanvasElement
  /** source image with the coloured marks (and note) burned in */
  composite(note?: string): Promise<HTMLCanvasElement>
  empty(): boolean
}

/** Paint over an image: a brush mask for Redraw/Erase, or coloured marks for Annotate. */
export const MaskEditor = forwardRef<MaskEditorHandle, { url: string; mode: 'mask' | 'annotate' }>(function MaskEditor({ url, mode }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [brush, setBrush] = useState(48)
  const [color, setColor] = useState('#ff3b5c')
  const [erase, setErase] = useState(false)
  const strokes = useRef<Stroke[]>([])
  const drawing = useRef<Stroke | null>(null)
  const [, force] = useState(0)

  const paint = (ctx: CanvasRenderingContext2D, list: Stroke[], forMask = false) => {
    for (const s of list) {
      ctx.save()
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
      ctx.strokeStyle = forMask ? '#fff' : s.color
      ctx.lineWidth = s.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath()
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1])
      ctx.stroke()
      ctx.restore()
    }
  }
  const redraw = () => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    paint(ctx, drawing.current ? [...strokes.current, drawing.current] : strokes.current)
  }
  useEffect(redraw)

  const toImage = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * size.w, ((e.clientY - r.top) / r.height) * size.h] as [number, number]
  }
  // brush size is in screen pixels; convert to image pixels
  const scale = () => { const r = canvas.current?.getBoundingClientRect(); return r ? size.w / r.width : 1 }

  useImperativeHandle(ref, () => ({
    mask() {
      const c = document.createElement('canvas')
      c.width = size.w; c.height = size.h
      const ctx = c.getContext('2d')!
      const strokesLayer = document.createElement('canvas')
      strokesLayer.width = size.w; strokesLayer.height = size.h
      paint(strokesLayer.getContext('2d')!, strokes.current, true)
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.w, size.h)
      ctx.drawImage(strokesLayer, 0, 0)
      return c
    },
    async composite(note) {
      const c = document.createElement('canvas')
      c.width = size.w; c.height = size.h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img.current!, 0, 0, size.w, size.h)
      paint(ctx, strokes.current)
      if (note?.trim()) {
        const fs = Math.max(18, Math.round(size.w / 40))
        ctx.font = `600 ${fs}px Inter, Segoe UI, sans-serif`
        const tw = Math.min(size.w - 40, ctx.measureText(note).width + fs)
        ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(20, size.h - fs * 2.2 - 20, tw, fs * 2.2)
        ctx.fillStyle = '#fff'; ctx.fillText(note, 20 + fs / 2, size.h - 20 - fs * 0.75, size.w - 60)
      }
      return c
    },
    empty: () => !strokes.current.some(s => !s.erase),
  }), [size])

  return (
    <div className="mask-editor">
      <div className="mask-tools">
        <label>Brush <input type="range" min={6} max={160} value={brush} onChange={e => setBrush(Number(e.target.value))} /></label>
        {mode === 'annotate' && ['#ff3b5c', '#f5b94a', '#2fc2a0', '#5b8cff', '#ffffff'].map(c => (
          <button key={c} className={`swatch-btn ${color === c && !erase ? 'on' : ''}`} onClick={() => { setColor(c); setErase(false) }}><i className="swatch" style={{ background: c }} /></button>
        ))}
        <button className={`btn small ${erase ? 'primary' : ''}`} onClick={() => setErase(!erase)}>Eraser</button>
        <button className="btn small" onClick={() => { strokes.current.pop(); force(x => x + 1) }}>Undo</button>
        <button className="btn small" onClick={() => { strokes.current = []; force(x => x + 1) }}>Clear</button>
      </div>
      <div className="mask-stage">
        <img ref={img} src={url} alt="" draggable={false} crossOrigin="anonymous"
          onLoad={e => setSize({ w: e.currentTarget.naturalWidth || 1024, h: e.currentTarget.naturalHeight || 1024 })} />
        {size.w > 0 && (
          <canvas ref={canvas} width={size.w} height={size.h} className={mode === 'mask' ? 'as-mask' : ''}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = { points: [toImage(e)], size: brush * scale(), color: mode === 'mask' ? '#ff3b5c' : color, erase }
              redraw()
            }}
            onPointerMove={e => { if (drawing.current) { drawing.current.points.push(toImage(e)); redraw() } }}
            onPointerUp={() => { if (drawing.current) { strokes.current.push(drawing.current); drawing.current = null; force(x => x + 1) } }} />
        )}
      </div>
      <p className="muted small">{mode === 'mask' ? 'Paint over the area to change. White in the mask = regenerated.' : 'Circle, arrow or scribble what should change; add a note below.'}</p>
    </div>
  )
})
