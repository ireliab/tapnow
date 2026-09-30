import type { Asset, ElementItem, Job, LibraryItem, ModelInfo, NodeParams, Project, ProjectMeta, Settings, Template } from './types'

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
  // library / elements / templates
  library: () => req<{ folders: string[]; items: LibraryItem[] }>('GET', '/api/library'),
  saveToLibrary: (item: Partial<LibraryItem>) => req<LibraryItem>('POST', '/api/library', item),
  moveLibraryItem: (id: string, folder: string) => req('PATCH', `/api/library/${id}`, { folder }),
  deleteLibraryItem: (id: string) => req('DELETE', `/api/library/${id}`),
  addFolder: (name: string) => req<{ folders: string[] }>('POST', '/api/library/folders', { name }),
  elements: () => req<ElementItem[]>('GET', '/api/elements'),
  saveElement: (e: Partial<ElementItem>) => req<ElementItem>('PUT', `/api/elements${e.id ? `/${e.id}` : ''}`, e),
  deleteElement: (id: string) => req('DELETE', `/api/elements/${id}`),
  templates: () => req<Template[]>('GET', '/api/templates'),
  saveTemplate: (t: Partial<Template>) => req<Template>('POST', '/api/templates', t),
  deleteTemplate: (id: string) => req('DELETE', `/api/templates/${id}`),
  // projects: clone / import (export is a plain download link)
  cloneProject: (id: string, name?: string) => req<Project>('POST', `/api/projects/${id}/clone`, { name }),
  importProject(file: File) {
    const f = new FormData()
    f.append('file', file)
    return req<Project>('POST', '/api/projects/import', f)
  },
}

/** Job updates (and agent-made canvas changes) over WebSocket, with auto-reconnect. */
export function connectJobs(onJob: (job: Job) => void, onProjectChanged?: (projectId: string, nodes: any[]) => void) {
  let ws: WebSocket | undefined
  let closed = false
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.type === 'job') onJob(m.job)
      else if (m.type === 'project-changed') onProjectChanged?.(m.projectId, m.nodes ?? [])
    }
    ws.onclose = () => { if (!closed) setTimeout(open, 1000) }
  }
  open()
  return () => { closed = true; ws?.close() }
}
