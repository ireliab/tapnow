export interface Rect { x: number; y: number; w: number; h: number }

const ratio = (aspect: string) => { const [a, b] = aspect.split(':').map(Number); return a && b ? a / b : 1 }

/** Largest centred rect of `aspect` inside w×h. */
export function centeredCrop(w: number, h: number, aspect: string): Rect {
  const r = ratio(aspect)
  const cw = Math.min(w, Math.round(h * r)), ch = Math.min(h, Math.round(w / r))
  return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch }
}

/** Cells of an n×n grid (Quick Split), row-major. */
export function gridCells(w: number, h: number, n: number): Rect[] {
  const cw = w / n, ch = h / n
  return Array.from({ length: n * n }, (_, i) => ({ x: Math.round((i % n) * cw), y: Math.round(Math.floor(i / n) * ch), w: Math.round(cw), h: Math.round(ch) }))
}

/**
 * Outpainting canvas: grow w×h to `aspect` (never shrinking), optionally with extra
 * margin, and return where the original sits inside the new canvas.
 */
export function outpaintLayout(w: number, h: number, aspect: string, extra = 0): { width: number; height: number; x: number; y: number } {
  const r = ratio(aspect)
  let W = w * (1 + extra), H = h * (1 + extra)
  if (W / H < r) W = H * r
  else H = W / r
  W = Math.round(W / 8) * 8; H = Math.round(H / 8) * 8
  return { width: W, height: H, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) }
}

/** Human prompt for Multi-angle from camera sliders. */
export function anglePrompt(o: { rotate: number; tilt: number; distance: 'close' | 'medium' | 'far'; wide: boolean }) {
  const parts: string[] = []
  if (o.rotate) parts.push(`camera orbited ${Math.abs(o.rotate)}° to the ${o.rotate < 0 ? 'left' : 'right'} of the subject`)
  if (o.tilt) parts.push(o.tilt > 0 ? `high angle looking down ${o.tilt}°` : `low angle looking up ${-o.tilt}°`)
  parts.push({ close: 'close-up framing', medium: 'medium shot framing', far: 'wide shot framing' }[o.distance])
  if (o.wide) parts.push('wide-angle lens with slight perspective distortion')
  return `Same subject, identical appearance, colors and details — ${parts.join(', ')}. Keep lighting and style consistent.`
}

/** Human prompt for Relight. */
export function lightPrompt(o: { direction: string; brightness: number; temperature: number; rim: boolean }) {
  const temp = o.temperature < 4000 ? `warm ${o.temperature}K light` : o.temperature > 6000 ? `cool ${o.temperature}K light` : `neutral ${o.temperature}K light`
  const level = o.brightness < 40 ? 'low-key, moody' : o.brightness > 70 ? 'bright, high-key' : 'balanced'
  return `${level} ${temp} coming from the ${o.direction}${o.rim ? ', with a subtle rim light outlining the subject' : ''}`
}
