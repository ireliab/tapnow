import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { enqueue, getJob, onJobUpdate, type Job } from './jobs.js'
import { listTemplates } from './library.js'
import { catalog } from './providers/index.js'
import { createProject, getProject, listAssets, listProjects, newId, readJson, saveProject, DATA, type Project } from './store.js'
import path from 'node:path'

/**
 * TapLocal as an MCP server (TapNow "Use TapNow in other agents"): Claude Code,
 * Claude Desktop, Codex, … can list projects, search the library and generate
 * media that lands on a TapLocal canvas.
 *
 *   claude mcp add --transport http taplocal http://127.0.0.1:8787/mcp
 */
type Broadcast = (msg: unknown) => void
let broadcast: Broadcast = () => {}
export const setMcpBroadcast = (fn: Broadcast) => { broadcast = fn }

const WIDTH: Record<string, number> = { text: 280, image: 300, video: 360, audio: 280 }
const mcpNodes = new Map<string, string>() // nodeId -> projectId

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

function targetProject(id?: string): Project {
  if (id) {
    const p = getProject(id)
    if (!p) throw new Error(`No project ${id}. Use list_projects.`)
    return p
  }
  const recent = listProjects()[0] as { id: string } | undefined
  return (recent && getProject(recent.id)) || createProject('From agents')
}

/** Put a node on the project canvas (right of existing content) and start its job. */
async function generateNode(o: { projectId?: string; kind: 'image' | 'video' | 'audio'; title: string; prompt: string; model?: string; params: Record<string, unknown>; images?: string[] }) {
  const p = targetProject(o.projectId)
  const models = (await catalog()).filter(m => m.kind === o.kind && m.available && !m.tool)
  const model = o.model ? models.find(m => m.id === o.model) : models.find(m => m.provider !== 'mock' && (!o.images?.length || m.maxImages > 0)) ?? models[0]
  if (!model) throw new Error(`No available ${o.kind} model${o.model ? ` called ${o.model}` : ''}. Use list_models.`)
  const right = p.nodes.length ? Math.max(...p.nodes.map((n: any) => (n.position?.x ?? 0) + (n.width ?? 300))) + 120 : 0
  const top = p.nodes.length ? Math.min(...p.nodes.map((n: any) => n.position?.y ?? 0)) : 0
  const nodeId = `${o.kind}-${newId(8)}`
  const node = {
    id: nodeId, type: 'canvas', position: { x: right, y: top + mcpNodes.size % 4 * 60 }, width: WIDTH[o.kind],
    data: { kind: o.kind, title: o.title, prompt: o.prompt, model: model.id, params: o.params, outputs: [], active: 0, status: 'queued' },
  }
  p.nodes.push(node)
  saveProject(p)
  mcpNodes.set(nodeId, p.id)
  const job = await enqueue({ kind: o.kind, model: model.id, prompt: o.prompt, params: o.params as any, inputs: { texts: [], images: o.images ?? [], videos: [], audios: [] } }, { nodeId, projectId: p.id })
  ;(node.data as any).jobId = job.id
  saveProject(p)
  broadcast({ type: 'project-changed', projectId: p.id, nodes: [node] })
  return { job, node, project: p, model }
}

/** Keep the project file in sync when an agent-created node finishes (even with no browser open). */
onJobUpdate(job => {
  const projectId = mcpNodes.get(job.nodeId)
  if (!projectId || (job.status !== 'done' && job.status !== 'error' && job.status !== 'cancelled')) return
  const p = getProject(projectId)
  const n = p?.nodes.find((x: any) => x.id === job.nodeId)
  if (!p || !n) return
  const assets = job.result?.assets ?? (job.result?.asset ? [job.result.asset] : [])
  n.data.outputs = [...(n.data.outputs ?? []), ...assets.map(a => ({ id: a.id, kind: n.data.kind, url: a.url, mime: a.mime, prompt: a.prompt, model: job.model, createdAt: Date.now() }))]
  n.data.active = Math.max(0, n.data.outputs.length - 1)
  n.data.status = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'idle'
  n.data.error = job.error
  delete n.data.jobId
  saveProject(p)
  mcpNodes.delete(job.nodeId)
  broadcast({ type: 'project-changed', projectId, nodes: [n] })
})

function waitForJob(id: string, ms: number) {
  return new Promise<Job>(resolve => {
    const j = getJob(id)
    if (j && ['done', 'error', 'cancelled'].includes(j.status)) return resolve(j)
    const t = setTimeout(() => { off(); resolve(getJob(id)!) }, ms)
    const off = onJobUpdate(job => {
      if (job.id === id && ['done', 'error', 'cancelled'].includes(job.status)) { clearTimeout(t); off(); resolve(job) }
    })
  })
}

function buildServer(origin: string) {
  const server = new McpServer({ name: 'taplocal', version: '0.2.0' })
  const abs = (u?: string) => (u?.startsWith('/') ? origin + u : u)
  // the UI lives on Vite's port in dev and on this server in production
  const ui = process.env.TAPLOCAL_UI_URL || (process.env.npm_lifecycle_event === 'dev' ? `http://localhost:${process.env.WEB_PORT ?? 5173}` : origin)
  const openUrl = (projectId: string) => `${ui}/?project=${projectId}`
  const summary = async (r: Awaited<ReturnType<typeof generateNode>>, wait: boolean) => {
    const job = wait ? await waitForJob(r.job.id, 10 * 60_000) : r.job
    const assets = job.result?.assets ?? (job.result?.asset ? [job.result.asset] : [])
    return text({
      status: job.status, job_id: job.id, node_id: r.node.id, project_id: r.project.id, model: r.model.id,
      paid: r.model.provider === 'fal' || r.model.provider === 'openai',
      outputs: assets.map(a => abs(a.url)), error: job.error, open_in_taplocal: openUrl(r.project.id),
    })
  }
  const safe = <A,>(fn: (a: A) => Promise<any>) => async (a: A) => { try { return await fn(a) } catch (e: any) { return fail(String(e?.message ?? e)) } }
  const COST = 'Cloud models (paid: true) are billed to the user — when unsure, ask the user before generating.'

  server.registerTool('list_projects', { title: 'List projects', description: 'List TapLocal canvases (projects), newest first.', inputSchema: {} },
    safe(async () => text(listProjects().map((p: any) => ({ ...p, open: openUrl(p.id) })))))

  server.registerTool('create_canvas', { title: 'Create canvas', description: 'Create a new empty TapLocal project/canvas.', inputSchema: { name: z.string().describe('Project name') } },
    safe(async ({ name }) => { const p = createProject(name); return text({ project_id: p.id, open: openUrl(p.id) }) }))

  server.registerTool('list_models', { title: 'List models', description: 'Models available for generation (id, kind, provider, whether paid).', inputSchema: { kind: z.enum(['image', 'video', 'audio']).optional() } },
    safe(async ({ kind }) => text((await catalog()).filter(m => m.available && !m.tool && (!kind || m.kind === kind)).map(m => ({ id: m.id, name: m.name, kind: m.kind, provider: m.provider, paid: m.provider === 'fal' || m.provider === 'openai', accepts_images: m.maxImages })))))

  server.registerTool('search_library', {
    title: 'Search library', description: 'Search generated and uploaded media by prompt, name or model (free, no generation).',
    inputSchema: { query: z.string().optional(), kind: z.enum(['image', 'video', 'audio']).optional(), limit: z.number().int().min(1).max(100).optional() },
  }, safe(async ({ query, kind, limit }) => {
    const q = (query ?? '').toLowerCase()
    const items = listAssets().filter(a => (!kind || a.kind === kind) && (!q || `${a.name ?? ''} ${a.prompt ?? ''} ${a.model ?? ''}`.toLowerCase().includes(q)))
    const saved = readJson<{ items: any[] }>(path.join(DATA, 'library.json'), { items: [] }).items.filter(i => !q || `${i.name} ${i.folder} ${i.prompt ?? ''}`.toLowerCase().includes(q))
    return text({ assets: items.slice(0, limit ?? 20).map(a => ({ ...a, url: abs(a.url) })), saved: saved.slice(0, 20).map(i => ({ ...i, url: abs(i.url) })) })
  }))

  server.registerTool('list_templates', { title: 'List templates', description: 'Workflow templates that can be applied on a canvas in the TapLocal UI.', inputSchema: {} },
    safe(async () => text(listTemplates().map(t => ({ id: t.id, name: t.name, description: t.description, nodes: t.nodes.length })))))

  server.registerTool('generate_image', {
    title: 'Generate image', description: `Generate an image; it appears as a node on a TapLocal canvas. ${COST}`,
    inputSchema: {
      prompt: z.string(), project_id: z.string().optional(), model: z.string().optional(),
      aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(), count: z.number().int().min(1).max(4).optional(),
      reference_urls: z.array(z.string()).optional().describe('TapLocal /files/… URLs (from search_library) to use as references'),
      wait: z.boolean().optional().describe('Wait for the result (default true)'),
    },
  }, safe(async a => summary(await generateNode({
    projectId: a.project_id, kind: 'image', title: a.prompt.slice(0, 40), prompt: a.prompt, model: a.model,
    params: { aspect: a.aspect ?? '16:9', count: a.count ?? 1 }, images: (a.reference_urls ?? []).map(u => u.replace(origin, '')).filter(u => u.startsWith('/files/')),
  }), a.wait !== false)))

  server.registerTool('generate_video', {
    title: 'Generate video', description: `Generate a video clip (text-to-video, or animate image_url). ${COST}`,
    inputSchema: {
      prompt: z.string(), project_id: z.string().optional(), model: z.string().optional(), image_url: z.string().optional(),
      duration: z.number().optional(), aspect: z.enum(['16:9', '9:16', '1:1']).optional(), wait: z.boolean().optional(),
    },
  }, safe(async a => summary(await generateNode({
    projectId: a.project_id, kind: 'video', title: a.prompt.slice(0, 40), prompt: a.prompt, model: a.model,
    params: { aspect: a.aspect ?? '16:9', duration: a.duration ?? 5 }, images: a.image_url ? [a.image_url.replace(origin, '')] : [],
  }), a.wait !== false)))

  server.registerTool('generate_audio', {
    title: 'Generate audio', description: `Generate speech, music or a sound effect. ${COST}`,
    inputSchema: { text: z.string(), mode: z.enum(['speech', 'music', 'sfx']).optional(), project_id: z.string().optional(), model: z.string().optional(), duration: z.number().optional(), wait: z.boolean().optional() },
  }, safe(async a => {
    const mode = a.mode ?? 'speech'
    const model = a.model ?? (await catalog()).filter(m => m.kind === 'audio' && m.available && m.audioMode === mode).sort((x, y) => Number(x.provider === 'mock') - Number(y.provider === 'mock'))[0]?.id
    return summary(await generateNode({ projectId: a.project_id, kind: 'audio', title: a.text.slice(0, 40), prompt: a.text, model, params: { audioMode: mode, duration: a.duration } }), a.wait !== false)
  }))

  server.registerTool('get_job', { title: 'Get job', description: 'Status and outputs of a generation job.', inputSchema: { job_id: z.string() } },
    safe(async ({ job_id }) => {
      const j = getJob(job_id)
      if (!j) return fail('Unknown job (jobs are kept in memory until the server restarts)')
      const assets = j.result?.assets ?? (j.result?.asset ? [j.result.asset] : [])
      return text({ status: j.status, progress: j.progress, error: j.error, outputs: assets.map(a => abs(a.url)) })
    }))

  return server
}

export const mcpRouter = express.Router()
// only local callers (defends against DNS-rebinding from web pages)
mcpRouter.use((req, res, next) => {
  const host = String(req.headers.host ?? '')
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return res.status(403).json({ error: 'MCP is only available on localhost' })
  next()
})
mcpRouter.post('/', async (req, res) => {
  // stateless: a fresh server + transport per request
  const server = buildServer(`http://${req.headers.host}`)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { transport.close(); server.close() })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: String(e?.message ?? e) }, id: null })
  }
})
mcpRouter.all('/', (_req, res) => { res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }) })
