import fs from 'node:fs'
import express from 'express'
import { captureFrame, probe, renderPlaylist, smartClip, trim } from './ffmpeg.js'
import { addAsset, fileFromUrl, mimeOfFile, saveBytes, type Asset } from './store.js'

/** Deterministic media operations that run locally through ffmpeg (no model, no cost). */
export const opsRouter = express.Router()

function keep(tmp: string, projectId: string | undefined, name: string, prompt?: string): Asset {
  const mime = mimeOfFile(tmp)
  const url = saveBytes(fs.readFileSync(tmp), mime)
  fs.rm(tmp, { force: true }, () => {})
  return addAsset({ url, kind: mime.startsWith('video') ? 'video' : 'image', mime, name, prompt, projectId })
}

function source(url: unknown) {
  if (typeof url !== 'string' || !url.startsWith('/files/')) throw new Error('A local media file is required')
  const file = fileFromUrl(url)
  if (!fs.existsSync(file)) throw new Error('Source file not found')
  if (mimeOfFile(file) === 'image/svg+xml') throw new Error('Mock (SVG) clips cannot be processed by ffmpeg')
  return file
}

/** POST {clips: [{url, kind, in, out, duration}], width, height} → merged MP4 asset. */
opsRouter.post('/playlist', async (req, res) => {
  try {
    const { clips = [], width, height, projectId, name } = req.body ?? {}
    const ac = new AbortController()
    res.on('close', () => { if (!res.writableEnded) ac.abort() })
    const list = (clips as any[]).map(c => ({ file: source(c.url), kind: c.kind === 'image' ? 'image' as const : 'video' as const, in: Number(c.in) || 0, out: c.out === undefined ? undefined : Number(c.out), duration: Number(c.duration) || undefined }))
    const W = Math.min(3840, Math.max(160, Math.round((Number(width) || 1280) / 2) * 2)), H = Math.min(3840, Math.max(160, Math.round((Number(height) || 720) / 2) * 2))
    const out = await renderPlaylist(list, { width: W, height: H, signal: ac.signal })
    res.json({ asset: keep(out, projectId, String(name ?? 'playlist')) })
  } catch (e: any) {
    if (!res.headersSent) res.status(400).json({ error: String(e?.message ?? e) })
  }
})

opsRouter.post('/video', async (req, res) => {
  try {
    const { op, url, projectId } = req.body ?? {}
    const file = source(url)
    const ac = new AbortController()
    // res 'close' (not req): fires on client disconnect; req 'close' fires once the body is read
    res.on('close', () => { if (!res.writableEnded) ac.abort() })
    switch (op) {
      case 'probe': return res.json(await probe(file))
      case 'trim': {
        const start = Number(req.body.start) || 0
        const end = req.body.end === undefined ? undefined : Number(req.body.end)
        return res.json({ assets: [keep(await trim(file, start, end, ac.signal), projectId, `trim ${start.toFixed(1)}–${end?.toFixed(1) ?? 'end'}`)] })
      }
      case 'frame': {
        const at = req.body.at === 'first' || req.body.at === 'last' ? req.body.at : Number(req.body.at) || 0
        return res.json({ assets: [keep(await captureFrame(file, at, ac.signal), projectId, `frame ${at}`)] })
      }
      case 'smart-clip': {
        const { segments, cuts } = await smartClip(file, Number(req.body.threshold) || 0.3, ac.signal)
        return res.json({ cuts, assets: segments.map((s, i) => keep(s, projectId, `clip ${i + 1}`)) })
      }
      default: throw new Error(`Unknown op ${op}`)
    }
  } catch (e: any) {
    if (!res.headersSent) res.status(400).json({ error: String(e?.message ?? e) })
  }
})
