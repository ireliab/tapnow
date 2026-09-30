import type { AgentReply, Asset, Job, ModelInfo, NodeParams, Project, ProjectMeta, Settings } from './types'

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const api = {
  projects: () => req<ProjectMeta[]>('GET', '/api/projects'),
  createProject: (name?: string) => req<Project>('POST', '/api/projects', { name }),
  project: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  saveProject: (p: Project) => req<Project>('PUT', `/api/projects/${p.id}`, p),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),
  assets: () => req<Asset[]>('GET', '/api/assets'),
  deleteAsset: (id: string) => req('DELETE', `/api/assets/${id}`),
  upload(files: File[], projectId?: string) {
    const f = new FormData()
    files.forEach(file => f.append('files', file))
    if (projectId) f.append('projectId', projectId)
    return req<Asset[]>('POST', '/api/upload', f)
  },
  models: () => req<ModelInfo[]>('GET', '/api/models'),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
  generate: (body: {
    nodeId: string; projectId?: string; kind: string; model: string; prompt: string; params: NodeParams
    inputs: { texts: string[]; images: string[]; videos: string[]; audios: string[] }
  }) => req<Job>('POST', '/api/generate', body),
  cancel: (jobId: string) => req('POST', `/api/jobs/${jobId}/cancel`),
  agent: (message: string, canvas: string, history: Array<{ role: string; content: string }>) =>
    req<AgentReply>('POST', '/api/agent', { message, canvas, history }),
}

/** Job updates over WebSocket, with auto-reconnect. */
export function connectJobs(onJob: (job: Job) => void) {
  let ws: WebSocket | undefined
  let closed = false
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'job') onJob(m.job) }
    ws.onclose = () => { if (!closed) setTimeout(open, 1000) }
  }
  open()
  return () => { closed = true; ws?.close() }
}
