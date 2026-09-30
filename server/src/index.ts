import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { WebSocketServer } from 'ws'
import { uniqueNames, zip } from './zip.js'
import { opsRouter } from './ops.js'
import { agentRouter, skillsRouter } from './agent/routes.js'
import { cancel, enqueue, listJobs, onJobUpdate } from './jobs.js'
import { catalog } from './providers/index.js'
import {
  addAsset, createProject, deleteAsset, deleteProject, FILES, getProject, kindOfMime, listAssets,
  fileFromUrl, listProjects, maskedSettings, ROOT, saveBytes, saveProject, saveSettings,
} from './store.js'

const PORT = Number(process.env.API_PORT ?? 8787)
const HOST = process.env.API_HOST ?? '127.0.0.1'

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use('/files', express.static(FILES, { maxAge: '1y', immutable: true }))

const wrap = (fn: express.RequestHandler): express.RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next) } catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }) }
}

// projects
app.get('/api/projects', (_req, res) => { res.json(listProjects()) })
app.post('/api/projects', (req, res) => { res.json(createProject(req.body?.name)) })
app.get('/api/projects/:id', (req, res) => {
  const p = getProject(req.params.id)
  p ? res.json(p) : res.status(404).json({ error: 'not found' })
})
app.put('/api/projects/:id', (req, res) => { res.json(saveProject({ ...req.body, id: req.params.id })) })
app.delete('/api/projects/:id', (req, res) => { deleteProject(req.params.id); res.json({ ok: true }) })

// assets
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 ** 3 } })
app.get('/api/assets', (_req, res) => { res.json(listAssets()) })
app.post('/api/upload', upload.array('files'), (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? []
  const assets = files.map(f => addAsset({
    url: saveBytes(f.buffer, f.mimetype), kind: kindOfMime(f.mimetype), mime: f.mimetype,
    name: f.originalname, projectId: String(req.body?.projectId ?? '') || undefined,
  }))
  res.json(assets)
})
app.delete('/api/assets/:id', (req, res) => { deleteAsset(req.params.id); res.json({ ok: true }) })

// batch download: POST {name, files: [{url, name}]} -> zip (same source file included once)
app.post('/api/zip', wrap((req, res) => {
  const seen = new Set<string>()
  const files = (req.body?.files ?? []).filter((f: any) => typeof f?.url === 'string' && f.url.startsWith('/files/') && !seen.has(f.url) && seen.add(f.url))
  if (!files.length) throw new Error('No downloadable files')
  const names = uniqueNames(files.map((f: any) => {
    const ext = path.extname(f.url)
    const base = String(f.name ?? path.basename(f.url, ext)).trim() || 'file'
    return base.endsWith(ext) ? base : base + ext
  }))
  const entries = files.flatMap((f: any, i: number) => {
    const file = fileFromUrl(f.url)
    return fs.existsSync(file) ? [{ name: names[i], data: fs.readFileSync(file) }] : []
  })
  const archive = String(req.body?.name ?? 'taplocal').replace(/[^\w .-]+/g, '_') || 'taplocal'
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${archive}.zip"`)
  res.end(zip(entries))
}))

// models / settings
app.get('/api/models', wrap(async (_req, res) => { res.json(await catalog()) }))
app.get('/api/settings', (_req, res) => { res.json(maskedSettings()) })
app.put('/api/settings', wrap((req, res) => { saveSettings(req.body); res.json(maskedSettings()) }))

// generation
app.post('/api/generate', wrap(async (req, res) => {
  const { nodeId, projectId, ...genReq } = req.body
  res.json(await enqueue(genReq, { nodeId, projectId }))
}))
app.get('/api/jobs', (_req, res) => { res.json(listJobs()) })
app.post('/api/jobs/:id/cancel', (req, res) => { cancel(req.params.id); res.json({ ok: true }) })

// local ffmpeg media ops (trim, capture frame, smart clip)
app.use('/api/ops', opsRouter)

// agent + skills
app.use('/api/agent', agentRouter)
app.use('/api/skills', skillsRouter)

// production: serve the built web app
const dist = path.join(ROOT, 'web', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/(api|files|ws)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
onJobUpdate(job => {
  const msg = JSON.stringify({ type: 'job', job })
  for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(msg)
})

server.listen(PORT, HOST, () => console.log(`TapLocal server on http://${HOST}:${PORT}`))
