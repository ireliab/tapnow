import fs from 'node:fs'
import path from 'node:path'
import { DATA, newId, readJson, writeJson } from '../store.js'
import type { AgentOutput, Conversation } from './types.js'

const safe = (s: string) => s.replace(/[^\w-]/g, '')
const convDir = (projectId: string) => {
  const d = path.join(DATA, 'conversations', safe(projectId))
  fs.mkdirSync(d, { recursive: true })
  return d
}
const convFile = (projectId: string, id: string) => path.join(convDir(projectId), `${safe(id)}.json`)

// ---------- conversations ----------
export function listConversations(projectId: string) {
  return fs.readdirSync(convDir(projectId)).filter(f => f.endsWith('.json'))
    .map(f => readJson<Conversation | null>(path.join(convDir(projectId), f), null))
    .filter((c): c is Conversation => !!c)
    .map(({ display, llm, ...meta }) => ({ ...meta, messageCount: display.filter(d => d.type === 'user').length }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
export const getConversation = (projectId: string, id: string) => readJson<Conversation | null>(convFile(projectId, id), null)
export function saveConversation(c: Conversation) { c.updatedAt = Date.now(); writeJson(convFile(c.projectId, c.id), c); return c }
export function createConversation(projectId: string, patch: Partial<Conversation> = {}): Conversation {
  return saveConversation({
    id: newId(), projectId, title: 'New conversation', model: '', thinking: 'off', mode: 'auto',
    createdAt: Date.now(), updatedAt: Date.now(), display: [], llm: [], ...patch,
  })
}
export const deleteConversation = (projectId: string, id: string) => { try { fs.unlinkSync(convFile(projectId, id)) } catch { /* gone */ } }

/**
 * Copy a conversation up to and including the turn that contains display item `at`
 * (i.e. everything before the next user message), so the user can explore another direction.
 */
export function branchConversation(src: Conversation, at: number): Conversation {
  const nextUser = src.display.findIndex((d, i) => i > at && d.type === 'user')
  const cutDisplay = nextUser < 0 ? src.display.length : nextUser
  const cutLlm = nextUser < 0 ? src.llm.length : (src.display[nextUser] as { llmStart: number }).llmStart
  return createConversation(src.projectId, {
    title: `${src.title} (branch)`, model: src.model, thinking: src.thinking, mode: src.mode,
    display: structuredClone(src.display.slice(0, cutDisplay)), llm: structuredClone(src.llm.slice(0, cutLlm)),
  })
}

// ---------- memory ("Remember this") ----------
const MEMORY = path.join(DATA, 'agent-memory.json')
export const getMemory = () => readJson<string[]>(MEMORY, [])
export const setMemory = (items: string[]) => writeJson(MEMORY, items.map(s => s.trim()).filter(Boolean).slice(0, 50))
export const remember = (item: string) => { const m = getMemory(); if (!m.includes(item)) setMemory([...m, item]); return getMemory() }

// ---------- agent outputs (briefs, scripts, …) ----------
const outFile = (projectId: string) => {
  fs.mkdirSync(path.join(DATA, 'outputs'), { recursive: true })
  return path.join(DATA, 'outputs', `${safe(projectId)}.json`)
}
export const listOutputs = (projectId: string) => readJson<AgentOutput[]>(outFile(projectId), [])
export function saveOutput(projectId: string, o: Partial<AgentOutput> & { title: string; content: string }): AgentOutput {
  const all = listOutputs(projectId)
  const existing = o.id ? all.find(x => x.id === o.id) : undefined
  const out: AgentOutput = existing
    ? { ...existing, ...o, updatedAt: Date.now() } as AgentOutput
    : { id: newId(), projectId, status: 'draft', createdAt: Date.now(), updatedAt: Date.now(), ...o } as AgentOutput
  writeJson(outFile(projectId), [out, ...all.filter(x => x.id !== out.id)])
  return out
}
export const deleteOutput = (projectId: string, id: string) => writeJson(outFile(projectId), listOutputs(projectId).filter(o => o.id !== id))
