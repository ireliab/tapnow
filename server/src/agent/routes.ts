import express from 'express'
import { getSettings } from '../store.js'
import { deleteUserSkill, getSkill, listSkills, saveUserSkill } from '../skills.js'
import { cancelRun, resolveToolResult, runTurn } from './loop.js'
import {
  branchConversation, createConversation, deleteConversation, deleteOutput, getConversation, getMemory,
  listConversations, listOutputs, saveConversation, saveOutput, setMemory,
} from './persist.js'

export const agentRouter = express.Router()

const pid = (req: express.Request) => String(req.query.projectId ?? req.body?.projectId ?? '')
const must = <T>(v: T | null | undefined, what = 'Not found'): T => { if (!v) throw Object.assign(new Error(what), { status: 404 }); return v }
const h = (fn: (req: express.Request, res: express.Response) => any): express.RequestHandler => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out) }
  catch (e: any) { if (!res.headersSent) res.status(e?.status ?? 400).json({ error: String(e?.message ?? e) }) }
}

// conversations
agentRouter.get('/conversations', h(req => listConversations(pid(req))))
agentRouter.post('/conversations', h(req => createConversation(pid(req), {
  model: String(req.body?.model ?? ''), thinking: req.body?.thinking ?? 'off', mode: req.body?.mode ?? 'auto',
})))
agentRouter.get('/conversations/:id', h(req => must(getConversation(pid(req), req.params.id))))
agentRouter.patch('/conversations/:id', h(req => {
  const c = must(getConversation(pid(req), req.params.id))
  for (const k of ['title', 'mode', 'model', 'thinking'] as const) if (req.body?.[k] !== undefined) (c as any)[k] = req.body[k]
  return saveConversation(c)
}))
agentRouter.post('/conversations/:id/branch', h(req => branchConversation(must(getConversation(pid(req), req.params.id)), Number(req.body?.at ?? Infinity))))
agentRouter.delete('/conversations/:id', h(req => { deleteConversation(pid(req), req.params.id); return { ok: true } }))

/** Runs one agent turn and streams events as SSE. */
agentRouter.post('/conversations/:id/messages', async (req, res) => {
  const conv = getConversation(pid(req), req.params.id)
  if (!conv) return res.status(404).json({ error: 'Conversation not found' })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  const send = (e: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`) }
  const keepAlive = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000)
  const b = req.body ?? {}
  try {
    await runTurn(conv, {
      text: String(b.text ?? ''), attachments: b.attachments ?? [], refs: b.refs ?? [], skills: b.skills ?? [], canvas: String(b.canvas ?? ''),
    }, send)
  } finally {
    clearInterval(keepAlive)
    res.end()
  }
})
agentRouter.post('/runs/:runId/tool-result', h(req => ({ ok: resolveToolResult(req.params.runId, String(req.body?.callId), req.body?.result) })))
agentRouter.post('/runs/:runId/cancel', h(req => { cancelRun(req.params.runId); return { ok: true } }))

// LLM models for the picker
agentRouter.get('/llm-models', h(async () => {
  const { baseUrl, apiKey, model } = getSettings().llm
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(2000) })
    const ids: string[] = r.ok ? ((await r.json()) as any).data?.map((m: any) => m.id) ?? [] : []
    return { default: model, models: ids.includes(model) ? ids : [model, ...ids], reachable: r.ok }
  } catch { return { default: model, models: [model], reachable: false } }
}))

// memory
agentRouter.get('/memory', h(() => getMemory()))
agentRouter.put('/memory', h(req => { setMemory(Array.isArray(req.body) ? req.body.map(String) : []); return getMemory() }))

// outputs
agentRouter.get('/outputs', h(req => listOutputs(pid(req))))
agentRouter.post('/outputs', h(req => saveOutput(pid(req), req.body)))
agentRouter.put('/outputs/:id', h(req => saveOutput(pid(req), { ...req.body, id: req.params.id })))
agentRouter.delete('/outputs/:id', h(req => { deleteOutput(pid(req), req.params.id); return { ok: true } }))

// skills
export const skillsRouter = express.Router()
skillsRouter.get('/', h(() => listSkills()))
skillsRouter.get('/:name', h(req => must(getSkill(req.params.name))))
skillsRouter.put('/:name', h(req => saveUserSkill({ ...req.body, name: req.params.name })))
skillsRouter.delete('/:name', h(req => { deleteUserSkill(req.params.name); return { ok: true } }))
