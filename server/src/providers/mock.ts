import { aspectToSize, sleep, type Provider } from './types.js'
import { toDataUri } from '../store.js'

/**
 * Offline provider: produces deterministic placeholder media so the whole
 * canvas workflow (connect, generate, timeline, export) works with no models.
 */

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!))

function wrap(text: string, max: number, lines: number) {
  const out: string[] = []; let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > max) { out.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
    if (out.length === lines) break
  }
  if (out.length < lines && cur) out.push(cur)
  if (out.join(' ').length < text.length && out.length) out[out.length - 1] += '…'
  return out
}

function palette(seed: number) {
  const h1 = seed % 360, h2 = (h1 + 40 + (seed >> 9) % 120) % 360
  return [`hsl(${h1} 70% 45%)`, `hsl(${h2} 75% 22%)`, `hsl(${(h1 + 180) % 360} 80% 65%)`]
}

function scene(prompt: string, w: number, h: number, seed: number, images: string[], animated: boolean, dur: number) {
  const [c1, c2, c3] = palette(seed)
  const blobs = Array.from({ length: 6 }, (_, i) => {
    const s = hash(prompt + i + seed)
    const cx = (s % w), cy = ((s >> 8) % h), r = 40 + (s >> 16) % Math.round(Math.min(w, h) / 3)
    const move = animated
      ? `<animate attributeName="cx" values="${cx};${(cx + w / 4) % w};${cx}" dur="${dur}s" repeatCount="indefinite"/>`
      : ''
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i % 2 ? c3 : '#fff'}" opacity="${0.06 + (i % 3) * 0.05}">${move}</circle>`
  }).join('')
  const zoom = animated
    ? `<animateTransform attributeName="transform" type="scale" values="1;1.15" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`
    : ''
  let base = `<rect width="${w}" height="${h}" fill="url(#g)"/>${blobs}`
  if (images[0]) {
    const img = (u: string, attrs = '', children = '') =>
      `<image href="${toDataUri(u)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" ${attrs}>${children}</image>`
    base = img(images[0])
    // two frames -> crossfade first frame into last frame
    if (animated && images[1]) {
      base += img(images[1], 'opacity="0"',
        `<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.35;0.65;1" dur="${dur}s" repeatCount="indefinite"/>`)
    }
    base += `<rect width="${w}" height="${h}" fill="${c2}" opacity="0.18"/>`
  }
  return { c1, c2, body: `<g style="transform-origin:${w / 2}px ${h / 2}px">${base}${zoom}</g>` }
}

function svg(prompt: string, aspect: string, seed: number, images: string[], video?: number) {
  const { width: w, height: h } = aspectToSize(aspect, 1024)
  const { c1, c2, body } = scene(prompt, w, h, seed, images, !!video, video ?? 0)
  const lines = wrap(prompt || 'Untitled', Math.round(w / 26), 4)
  const fs = Math.round(w / 38)
  const text = lines.map((l, i) =>
    `<text x="${w * 0.06}" y="${h - w * 0.06 - (lines.length - 1 - i) * fs * 1.35}" font-size="${fs}">${esc(l)}</text>`).join('')
  const badge = video
    ? `<g transform="translate(${w - 190},28)"><rect width="162" height="44" rx="22" fill="#000" opacity=".45"/>` +
      `<circle cx="26" cy="22" r="7" fill="#ff4d4f"><animate attributeName="opacity" values="1;.2;1" dur="1s" repeatCount="indefinite"/></circle>` +
      `<text x="44" y="30" font-size="20" fill="#fff">MOCK · ${video}s</text></g>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></linearGradient></defs>
${body}<rect width="${w}" height="${h}" fill="url(#fade)"/>
<g font-family="Inter,Segoe UI,Arial,sans-serif" fill="#fff" font-weight="600">${text}</g>${badge}</svg>`
}

function wav(seconds: number, seed: number) {
  const rate = 22050, n = Math.round(rate * seconds)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  const root = 196 * Math.pow(2, (seed % 12) / 12), steps = [0, 4, 7, 12, 7, 4]
  const noteLen = rate * 0.35
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / noteLen), t = (i % noteLen) / noteLen
    const f = root * Math.pow(2, steps[k % steps.length] / 12)
    const env = Math.min(1, t * 20) * Math.pow(1 - t, 1.5)
    const v = Math.sin((2 * Math.PI * f * i) / rate) * 0.25 * env + Math.sin((2 * Math.PI * f * 2 * i) / rate) * 0.05 * env
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

const STYLES = ['cinematic lighting, shallow depth of field', 'soft volumetric haze, golden hour', 'high contrast, 35mm film grain', 'moody neon reflections, light rain']

export const mock: Provider = {
  async generate(model, req, ctx) {
    const seed = req.params.seed ?? hash(req.prompt + Date.now())
    const steps = model.kind === 'video' ? 8 : 4
    for (let i = 1; i <= steps; i++) { await sleep(300, ctx.signal); ctx.progress(i / steps) }
    const prompt = [...req.inputs.texts, req.prompt].filter(Boolean).join(' ')
    switch (model.kind) {
      case 'text': {
        const base = prompt || 'a quiet city at dawn'
        return { text: `${base.replace(/\.$/, '')}. ${STYLES[seed % STYLES.length]}, detailed textures, balanced composition, subtle camera movement.` }
      }
      case 'image':
        return { bytes: Buffer.from(svg(prompt, req.params.aspect ?? '16:9', seed, req.inputs.images)), mime: 'image/svg+xml' }
      case 'video':
        return { bytes: Buffer.from(svg(prompt, req.params.aspect ?? '16:9', seed, req.inputs.images, req.params.duration ?? 5)), mime: 'image/svg+xml' }
      case 'audio': {
        const words = prompt.split(/\s+/).length
        return { bytes: wav(Math.min(12, Math.max(2, words * 0.35)), seed), mime: 'audio/wav' }
      }
    }
  },
}
