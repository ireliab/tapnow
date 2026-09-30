import { addAsset, kindOfMime, newId, saveBytes, type Asset } from './store.js'
import { findModel, providers } from './providers/index.js'
import type { GenRequest } from './providers/types.js'

export interface Job {
  id: string; nodeId: string; projectId?: string; model: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number; message?: string; error?: string
  result?: { asset?: Asset; assets?: Asset[]; text?: string }
  createdAt: number; finishedAt?: number
}

const MAX_CONCURRENT = 3
const jobs = new Map<string, Job>()
const controllers = new Map<string, AbortController>()
const queue: Array<{ job: Job; req: GenRequest }> = []
let running = 0
let emit: (job: Job) => void = () => {}
export const onJobUpdate = (fn: (job: Job) => void) => { emit = fn }

export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)

export async function enqueue(req: GenRequest, meta: { nodeId: string; projectId?: string }): Promise<Job> {
  const model = await findModel(req.model)
  if (!model) throw new Error(`Unknown model: ${req.model}`)
  if (!model.available) throw new Error(model.reason)
  if (model.requiresImage && !req.inputs.images.length) throw new Error(`${model.name} needs an image input — connect an image node`)
  const job: Job = { id: newId(), ...meta, model: req.model, status: 'queued', progress: 0, createdAt: Date.now() }
  jobs.set(job.id, job)
  queue.push({ job, req })
  emit(job)
  pump()
  return job
}

export function cancel(id: string) {
  const job = jobs.get(id)
  if (!job) return
  const i = queue.findIndex(q => q.job.id === id)
  if (i >= 0) { queue.splice(i, 1); finish(job, { status: 'cancelled' }) }
  controllers.get(id)?.abort()
}

function finish(job: Job, patch: Partial<Job>) {
  Object.assign(job, patch, { finishedAt: Date.now() })
  emit(job)
}

async function download(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`download ${res.status}`)
  let mime = res.headers.get('content-type')?.split(';')[0] ?? ''
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
    mime = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav' }[ext ?? ''] ?? 'application/octet-stream'
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), mime }
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const { job, req } = queue.shift()!
    running++
    run(job, req).finally(() => { running--; pump() })
  }
}

async function run(job: Job, req: GenRequest) {
  const model = (await findModel(req.model))!
  const ac = new AbortController()
  controllers.set(job.id, ac)
  Object.assign(job, { status: 'running', progress: 0.01 })
  emit(job)
  let last = 0
  // batch count: run the provider N times (seed+i so results differ but stay reproducible)
  const count = model.kind === 'text' ? 1 : Math.min(4, Math.max(1, Math.round(Number(req.params.count) || 1)))
  try {
    const assets: Asset[] = []
    for (let i = 0; i < count; i++) {
      const params = req.params.seed !== undefined ? { ...req.params, seed: req.params.seed + i } : req.params
      const out = await providers[model.provider].generate(model, { ...req, params }, {
        signal: ac.signal,
        progress(p, message) {
          const total = (i + p) / count
          job.progress = Math.max(job.progress, Math.min(total, 0.99))
          job.message = count > 1 ? `${i + 1}/${count}${message ? ` · ${message}` : ''}` : message
          if (Date.now() - last > 250) { last = Date.now(); emit(job) }
        },
      })
      if ('text' in out) return finish(job, { status: 'done', progress: 1, result: { text: out.text } })
      const media = 'bytes' in out ? out : await download(out.remoteUrl, ac.signal)
      const url = saveBytes(media.bytes, media.mime)
      // mock "videos" are animated SVGs; keep them classed as video for the canvas
      const kind = model.kind === 'video' ? 'video' : kindOfMime(media.mime)
      assets.push(addAsset({ url, kind, mime: media.mime, prompt: req.prompt, model: model.id, projectId: job.projectId }))
    }
    finish(job, { status: 'done', progress: 1, result: { asset: assets[0], assets } })
  } catch (e: any) {
    finish(job, ac.signal.aborted ? { status: 'cancelled' } : { status: 'error', error: String(e?.message ?? e) })
  } finally {
    controllers.delete(job.id)
  }
}
