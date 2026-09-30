import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')
export const DATA = process.env.TAPLOCAL_DATA ? path.resolve(process.env.TAPLOCAL_DATA) : path.join(ROOT, 'data')
export const FILES = path.join(DATA, 'files')
export const PROJECTS = path.join(DATA, 'projects')
for (const d of [DATA, FILES, PROJECTS]) fs.mkdirSync(d, { recursive: true })

export const newId = (n = 10) => crypto.randomBytes(n).toString('base64url').slice(0, n)

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return fallback }
}
export function writeJson(file: string, value: unknown) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

// ---------- settings ----------
export interface Settings {
  llm: { baseUrl: string; apiKey: string; model: string }
  openai: { baseUrl: string; apiKey: string }
  fal: { apiKey: string }
  comfyui: { url: string; imageWorkflow: string; videoWorkflow: string }
  search: { provider: 'tavily' | 'brave'; apiKey: string }
  customModels: Array<{ id: string; name: string; provider: 'fal'; kind: 'image' | 'video'; imageField?: string }>
}
const SETTINGS_FILE = path.join(DATA, 'settings.json')
const defaults: Settings = {
  llm: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.1' },
  openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '' },
  fal: { apiKey: '' },
  comfyui: { url: 'http://127.0.0.1:8188', imageWorkflow: '', videoWorkflow: '' },
  search: { provider: 'tavily', apiKey: '' },
  customModels: [],
}
export function getSettings(): Settings {
  const s = readJson<Partial<Settings>>(SETTINGS_FILE, {})
  return {
    llm: { ...defaults.llm, ...s.llm },
    openai: { ...defaults.openai, ...s.openai },
    fal: { ...defaults.fal, ...s.fal },
    comfyui: { ...defaults.comfyui, ...s.comfyui },
    search: { ...defaults.search, ...s.search },
    customModels: s.customModels ?? [],
  }
}
const MASK = '••••'
const mask = (k: string) => (k ? MASK + k.slice(-4) : '')
export function maskedSettings(): Settings {
  const s = getSettings()
  return { ...s, llm: { ...s.llm, apiKey: mask(s.llm.apiKey) }, openai: { ...s.openai, apiKey: mask(s.openai.apiKey) }, fal: { apiKey: mask(s.fal.apiKey) }, search: { ...s.search, apiKey: mask(s.search.apiKey) } }
}
export function saveSettings(next: Settings) {
  const cur = getSettings()
  const keep = (v: string | undefined, old: string) => (v === undefined || v.startsWith(MASK) ? old : v)
  next.llm.apiKey = keep(next.llm?.apiKey, cur.llm.apiKey)
  next.openai.apiKey = keep(next.openai?.apiKey, cur.openai.apiKey)
  next.fal.apiKey = keep(next.fal?.apiKey, cur.fal.apiKey)
  next.search = { ...cur.search, ...next.search, apiKey: keep(next.search?.apiKey, cur.search.apiKey) }
  writeJson(SETTINGS_FILE, next)
}

// ---------- assets ----------
export type AssetKind = 'image' | 'video' | 'audio'
export interface Asset {
  id: string; url: string; kind: AssetKind; mime: string; name?: string
  prompt?: string; model?: string; projectId?: string; createdAt: number
}
const ASSETS_FILE = path.join(DATA, 'assets.json')
export const listAssets = () => readJson<Asset[]>(ASSETS_FILE, [])
export function addAsset(a: Omit<Asset, 'id' | 'createdAt'>): Asset {
  const asset: Asset = { id: newId(), createdAt: Date.now(), ...a }
  writeJson(ASSETS_FILE, [asset, ...listAssets()])
  return asset
}
export function deleteAsset(id: string) {
  const all = listAssets()
  const a = all.find(x => x.id === id)
  if (!a) return
  writeJson(ASSETS_FILE, all.filter(x => x.id !== id))
  try { fs.unlinkSync(fileFromUrl(a.url)) } catch { /* already gone */ }
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
}
export const kindOfMime = (mime: string): AssetKind =>
  mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'image'

/** Persist bytes under data/files and return the public URL. */
export function saveBytes(buf: Buffer, mime: string): string {
  const name = `${Date.now().toString(36)}-${newId(6)}.${EXT[mime] ?? 'bin'}`
  fs.writeFileSync(path.join(FILES, name), buf)
  return `/files/${name}`
}
export function fileFromUrl(url: string) {
  const name = path.basename(url.split('?')[0])
  return path.join(FILES, name)
}
export function mimeOfFile(file: string) {
  const ext = path.extname(file).slice(1).toLowerCase()
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream'
}
/** Local /files/ URL -> data: URI (for providers that accept inline files). */
export function toDataUri(url: string) {
  if (!url.startsWith('/files/')) return url
  const file = fileFromUrl(url)
  return `data:${mimeOfFile(file)};base64,${fs.readFileSync(file).toString('base64')}`
}

// ---------- projects ----------
export interface Project { id: string; name: string; updatedAt: number; nodes: any[]; edges: any[]; timeline: any[]; viewport?: any }
const pfile = (id: string) => path.join(PROJECTS, `${id.replace(/[^\w-]/g, '')}.json`)
export function listProjects() {
  return fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json')).map(f => {
    const p = readJson<Project | null>(path.join(PROJECTS, f), null)
    if (!p) return null
    const thumb = p.nodes.flatMap(n => n.data?.outputs ?? []).find((o: any) => o.kind === 'image')?.url
    return { id: p.id, name: p.name, updatedAt: p.updatedAt, nodeCount: p.nodes.length, thumb }
  }).filter(Boolean).sort((a: any, b: any) => b.updatedAt - a.updatedAt)
}
export const getProject = (id: string) => readJson<Project | null>(pfile(id), null)
export function saveProject(p: Project) { p.updatedAt = Date.now(); writeJson(pfile(p.id), p); return p }
export function createProject(name = 'Untitled') {
  return saveProject({ id: newId(), name, updatedAt: Date.now(), nodes: [], edges: [], timeline: [] })
}
export const deleteProject = (id: string) => { try { fs.unlinkSync(pfile(id)) } catch { /* noop */ } }
