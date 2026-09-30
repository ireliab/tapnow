import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import {
  addAsset, DATA, fileFromUrl, getProject, kindOfMime, mimeOfFile, newId, readJson, ROOT, saveBytes, saveProject, writeJson, type Project,
} from './store.js'
import { unzip, uniqueNames, zip } from './zip.js'

/**
 * Library (saved items in folders), Elements (reusable character / product / brand
 * reference sets), Templates (reusable node workflows) and project share/clone/export.
 */
export const libraryRouter = express.Router()
const h = (fn: (req: express.Request, res: express.Response) => any): express.RequestHandler => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out) }
  catch (e: any) { if (!res.headersSent) res.status(e?.status ?? 400).json({ error: String(e?.message ?? e) }) }
}

// ---------- library ----------
export interface LibraryItem { id: string; kind: 'image' | 'video' | 'audio' | 'text'; name: string; folder: string; url?: string; mime?: string; text?: string; prompt?: string; createdAt: number }
const LIB = path.join(DATA, 'library.json')
const lib = () => readJson<{ folders: string[]; items: LibraryItem[] }>(LIB, { folders: ['General'], items: [] })

libraryRouter.get('/library', h(() => lib()))
libraryRouter.post('/library', h(req => {
  const l = lib()
  const b = req.body ?? {}
  const folder = String(b.folder || 'General').slice(0, 60)
  const item: LibraryItem = { id: newId(), kind: b.kind, name: String(b.name || 'Untitled').slice(0, 80), folder, url: b.url, mime: b.mime, text: b.text, prompt: b.prompt, createdAt: Date.now() }
  if (!['image', 'video', 'audio', 'text'].includes(item.kind)) throw new Error('Invalid kind')
  writeJson(LIB, { folders: l.folders.includes(folder) ? l.folders : [...l.folders, folder], items: [item, ...l.items] })
  return item
}))
libraryRouter.patch('/library/:id', h(req => {
  const l = lib()
  const folder = req.body?.folder ? String(req.body.folder).slice(0, 60) : undefined
  writeJson(LIB, { folders: folder && !l.folders.includes(folder) ? [...l.folders, folder] : l.folders, items: l.items.map(i => (i.id === req.params.id ? { ...i, ...(folder ? { folder } : {}), ...(req.body?.name ? { name: String(req.body.name) } : {}) } : i)) })
  return { ok: true }
}))
libraryRouter.delete('/library/:id', h(req => { const l = lib(); writeJson(LIB, { ...l, items: l.items.filter(i => i.id !== req.params.id) }); return { ok: true } }))
libraryRouter.post('/library/folders', h(req => {
  const l = lib(); const f = String(req.body?.name ?? '').trim().slice(0, 60)
  if (!f) throw new Error('Folder name required')
  if (!l.folders.includes(f)) writeJson(LIB, { ...l, folders: [...l.folders, f] })
  return lib()
}))

// ---------- elements ----------
export interface Element { id: string; name: string; kind: 'character' | 'product' | 'brand' | 'other'; description: string; refs: Array<{ url: string; kind: string }>; createdAt: number; updatedAt: number }
const ELEMENTS = path.join(DATA, 'elements.json')
const elements = () => readJson<Element[]>(ELEMENTS, [])

libraryRouter.get('/elements', h(() => elements()))
libraryRouter.put('/elements/:id?', h(req => {
  const b = req.body ?? {}
  const all = elements()
  const id = req.params.id ?? newId()
  const name = String(b.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Element name required')
  if (all.some(e => e.id !== id && e.name.toLowerCase() === name.toLowerCase())) throw new Error(`An element called "${name}" already exists`)
  const prev = all.find(e => e.id === id)
  const el: Element = {
    id, name, kind: ['character', 'product', 'brand'].includes(b.kind) ? b.kind : 'other', description: String(b.description ?? '').slice(0, 2000),
    refs: (Array.isArray(b.refs) ? b.refs : []).filter((r: any) => typeof r?.url === 'string' && r.url.startsWith('/files/')).slice(0, 30),
    createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now(),
  }
  writeJson(ELEMENTS, [el, ...all.filter(e => e.id !== id)])
  return el
}))
libraryRouter.delete('/elements/:id', h(req => { writeJson(ELEMENTS, elements().filter(e => e.id !== req.params.id)); return { ok: true } }))

// ---------- templates ----------
export interface Template {
  id: string; name: string; description: string; category: string; source: 'public' | 'mine'
  nodes: Array<{ ref: string; kind: string; title?: string; prompt?: string; model?: string; params?: Record<string, unknown>; x?: number; y?: number; outputs?: any[] }>
  edges: Array<{ from: string; to: string }>
  createdAt?: number
}
const PUBLIC_DIR = path.join(ROOT, 'server', 'templates')
const MY_DIR = path.join(DATA, 'templates')
fs.mkdirSync(MY_DIR, { recursive: true })
const loadDir = (dir: string, source: Template['source']) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter(f => f.endsWith('.json')).map(f => ({ ...readJson<Template>(path.join(dir, f), null as never), source })).filter(t => t?.nodes)

export const listTemplates = () => [...loadDir(PUBLIC_DIR, 'public'), ...loadDir(MY_DIR, 'mine').sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))]
libraryRouter.get('/templates', h(() => listTemplates()))
libraryRouter.post('/templates', h(req => {
  const b = req.body ?? {}
  if (!Array.isArray(b.nodes) || !b.nodes.length) throw new Error('A template needs at least one node')
  const t: Template = { id: newId(), name: String(b.name || 'My template').slice(0, 80), description: String(b.description ?? '').slice(0, 500), category: 'mine', source: 'mine', nodes: b.nodes.slice(0, 200), edges: (b.edges ?? []).slice(0, 400), createdAt: Date.now() }
  writeJson(path.join(MY_DIR, `${t.id}.json`), t)
  return t
}))
libraryRouter.delete('/templates/:id', h(req => {
  const f = path.join(MY_DIR, `${req.params.id.replace(/[^\w-]/g, '')}.json`)
  if (!fs.existsSync(f)) throw new Error('Only your own templates can be deleted')
  fs.unlinkSync(f)
  return { ok: true }
}))

// ---------- projects: clone, export, import ----------
/** Every /files/ URL referenced anywhere in a project. */
export function projectFiles(p: Project) {
  const urls = new Set<string>()
  JSON.stringify(p, (_k, v) => { if (typeof v === 'string' && v.startsWith('/files/')) urls.add(v); return v })
  return [...urls]
}

export function cloneProject(p: Project, name?: string): Project {
  const copy = structuredClone(p)
  copy.id = newId()
  copy.name = name ?? `${p.name} (copy)`
  return saveProject(copy)
}

libraryRouter.post('/projects/:id/clone', h(req => {
  const p = getProject(req.params.id)
  if (!p) throw Object.assign(new Error('Project not found'), { status: 404 })
  return cloneProject(p, req.body?.name)
}))

libraryRouter.get('/projects/:id/export', (req, res) => {
  const p = getProject(req.params.id)
  if (!p) return res.status(404).json({ error: 'Project not found' })
  const urls = projectFiles(p).filter(u => fs.existsSync(fileFromUrl(u)))
  const names = uniqueNames(urls.map(u => path.basename(u)))
  const map = Object.fromEntries(urls.map((u, i) => [u, `files/${names[i]}`]))
  const manifest = { format: 'taplocal-project', version: 1, project: p, files: map }
  const archive = zip([
    { name: 'project.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...urls.map((u, i) => ({ name: `files/${names[i]}`, data: fs.readFileSync(fileFromUrl(u)) })),
  ])
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/[^\w .-]+/g, '_') || 'project'}.taplocal.zip"`)
  res.end(archive)
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 ** 3 } })
libraryRouter.post('/projects/import', upload.single('file'), h(req => {
  if (!req.file) throw new Error('Choose a .taplocal.zip file')
  const entries = unzip(req.file.buffer)
  const manifestEntry = entries.find(e => e.name === 'project.json')
  if (!manifestEntry) throw new Error('project.json missing — not a TapLocal export')
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'))
  if (manifest.format !== 'taplocal-project') throw new Error('Not a TapLocal project export')
  const byName = new Map(entries.map(e => [e.name, e.data]))
  // copy files in under fresh names and remap every url in the project
  const remap: Record<string, string> = {}
  for (const [oldUrl, zipName] of Object.entries(manifest.files as Record<string, string>)) {
    const data = byName.get(zipName)
    if (!data) continue
    const mime = mimeOfFile(zipName)
    const url = saveBytes(data, mime)
    remap[oldUrl] = url
    if (mime.startsWith('image') || mime.startsWith('video') || mime.startsWith('audio')) addAsset({ url, kind: kindOfMime(mime), mime, name: path.basename(zipName) })
  }
  const text = JSON.stringify(manifest.project).replace(/"\/files\/[^"]+"/g, m => JSON.stringify(remap[JSON.parse(m)] ?? JSON.parse(m)))
  const p: Project = JSON.parse(text)
  p.id = newId()
  p.name = `${p.name} (imported)`
  return saveProject(p)
}))
