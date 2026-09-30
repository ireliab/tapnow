import { useEffect, useRef } from 'react'

const peaksCache = new Map<string, Float32Array>()

async function peaks(url: string, bars: number) {
  const key = `${url}#${bars}`
  if (peaksCache.has(key)) return peaksCache.get(key)!
  const buf = await (await fetch(url)).arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 22050)
  const audio = await ctx.decodeAudioData(buf)
  const data = audio.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / bars))
  const out = new Float32Array(bars)
  for (let i = 0; i < bars; i++) {
    let max = 0
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) max = Math.max(max, Math.abs(data[j]))
    out[i] = max
  }
  const top = Math.max(...out, 0.01)
  for (let i = 0; i < bars; i++) out[i] /= top
  peaksCache.set(key, out)
  return out
}

/** Audio waveform preview (TapNow shows one on audio nodes). */
export function Waveform({ url, progress = 0 }: { url: string; progress?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    const c = ref.current
    if (!c) return
    const bars = 64
    peaks(url, bars).then(p => {
      if (cancelled) return
      const ctx = c.getContext('2d')!
      const w = c.width, h = c.height, bw = w / bars
      ctx.clearRect(0, 0, w, h)
      p.forEach((v, i) => {
        const bh = Math.max(2, v * (h - 4))
        ctx.fillStyle = i / bars < progress ? '#2fc2a0' : 'rgba(47, 194, 160, .45)'
        ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh)
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [url, progress])
  return <canvas ref={ref} className="waveform" width={560} height={80} />
}
