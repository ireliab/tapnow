import { catalog, llmReachable } from '../providers/index.js'
import { webSearch } from '../search.js'
import { getSkill, listSkills } from '../skills.js'
import { getSettings, newId } from '../store.js'
import { offlineTurn } from './offline.js'
import { getMemory, remember, saveConversation, saveOutput } from './persist.js'
import { systemPrompt, userTurn } from './prompts.js'
import { isClientTool, toolsFor } from './tools.js'
import type { AgentEvent, Attachment, Conversation, DisplayItem, LlmMessage, NodeRef, Thinking } from './types.js'

const MAX_STEPS = 12
const INTERACTIVE = new Set(['ask_user', 'generate', 'run_all'])

// ---------- run registry: client tools resolve through POST /runs/:id/tool-result ----------
interface Run { abort: AbortController; pending: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }> }
const runs = new Map<string, Run>()

export function resolveToolResult(runId: string, callId: string, result: any) {
  const p = runs.get(runId)?.pending.get(callId)
  if (!p) return false
  p.resolve(result)
  return true
}
export function cancelRun(runId: string) {
  const run = runs.get(runId)
  if (!run) return
  run.abort.abort()
  for (const p of run.pending.values()) p.reject(new Error('Cancelled'))
}

export interface TurnInput { text: string; attachments: Attachment[]; refs: NodeRef[]; skills: string[]; canvas: string }

/** Executes one tool call, streaming it to the client and recording it in the conversation. */
export type CallTool = (name: string, args: any) => Promise<any>

export async function runTurn(conv: Conversation, input: TurnInput, emit: (e: AgentEvent) => void) {
  const runId = newId()
  const run: Run = { abort: new AbortController(), pending: new Map() }
  runs.set(runId, run)
  emit({ type: 'run', runId })

  const display = (d: DisplayItem) => { conv.display.push(d); return d }
  display({ type: 'user', text: input.text, attachments: input.attachments, refs: input.refs, skills: input.skills, llmStart: conv.llm.length, at: Date.now() })
  if (conv.display.filter(d => d.type === 'user').length === 1) {
    conv.title = input.text.replace(/\s+/g, ' ').slice(0, 48) || 'New conversation'
    emit({ type: 'title', title: conv.title })
  }
  saveConversation(conv)

  const callTool: CallTool = async (name, args) => {
    const callId = newId()
    const item = display({ type: 'tool', callId, name, args, status: 'running', at: Date.now() }) as Extract<DisplayItem, { type: 'tool' }>
    const client = isClientTool(name)
    emit({ type: 'tool_call', callId, name, args, client })
    let result: any
    let error = false
    try {
      result = client ? await waitForClient(run, callId, INTERACTIVE.has(name) ? 60 * 60_000 : 60_000) : await serverTool(conv, name, args, emit, run.abort.signal)
    } catch (e: any) {
      if (run.abort.signal.aborted) throw e
      result = { error: String(e?.message ?? e) }
      error = true
    }
    item.result = result
    item.status = error || result?.error ? 'error' : 'done'
    emit({ type: 'tool_result', callId, name, result, error: item.status === 'error' })
    saveConversation(conv)
    return result
  }

  try {
    if (await llmReachable()) await llmTurn(conv, input, callTool, emit, run.abort.signal)
    else await offlineTurn(conv, input, callTool, text => { display({ type: 'assistant', text, at: Date.now() }); emit({ type: 'text', text }) })
  } catch (e: any) {
    const text = run.abort.signal.aborted ? 'Stopped.' : `Agent error: ${e?.message ?? e}`
    display({ type: 'error', text, at: Date.now() })
    emit({ type: 'error', error: text })
  } finally {
    // close any tool items left running by a cancel
    for (const d of conv.display) if (d.type === 'tool' && d.status === 'running') d.status = 'error'
    saveConversation(conv)
    runs.delete(runId)
    emit({ type: 'done' })
  }
}

function waitForClient(run: Run, callId: string, timeoutMs: number) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => { run.pending.delete(callId); reject(new Error('The canvas did not respond in time')) }, timeoutMs)
    run.pending.set(callId, {
      resolve: v => { clearTimeout(t); run.pending.delete(callId); resolve(v) },
      reject: e => { clearTimeout(t); run.pending.delete(callId); reject(e) },
    })
  })
}

async function serverTool(conv: Conversation, name: string, args: any, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  switch (name) {
    case 'web_search': return { results: await webSearch(String(args.query ?? ''), Number(args.max_results) || 5, signal) }
    case 'use_skill': {
      const s = getSkill(String(args.name ?? ''))
      return s ? { skill: s.name, instructions: s.body } : { error: `No skill named "${args.name}". Available: ${listSkills().map(x => x.name).join(', ')}` }
    }
    case 'remember': return { saved: true, preferences: remember(String(args.preference ?? '').trim()) }
    case 'save_output': {
      const output = saveOutput(conv.projectId, { title: String(args.title ?? 'Untitled'), content: String(args.content ?? ''), status: args.status })
      emit({ type: 'output', output })
      return { saved: true, id: output.id, title: output.title }
    }
    default: return { error: `Unknown tool ${name}` }
  }
}

// ---------- LLM (OpenAI-compatible tool calling) ----------
const EFFORT: Record<Thinking, string | undefined> = { off: undefined, light: 'low', standard: 'medium', heavy: 'high' }

async function complete(body: Record<string, any>, signal: AbortSignal): Promise<LlmMessage> {
  const { baseUrl, apiKey } = getSettings().llm
  const post = (b: Record<string, any>) => fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(b),
  })
  let res = await post(body)
  // not every server supports reasoning_effort / tools — degrade instead of failing
  for (let attempt = 0; res.status === 400 && attempt < 2; attempt++) {
    const text = await res.text()
    if (body.reasoning_effort && /reason/i.test(text)) delete body.reasoning_effort
    else if (body.tools && /tool|function/i.test(text)) { delete body.tools; delete body.tool_choice }
    else throw new Error(`LLM 400: ${text.slice(0, 300)}`)
    res = await post(body)
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const out = await res.json() as any
  const m = out.choices?.[0]?.message ?? {}
  return { role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) }
}

async function llmTurn(conv: Conversation, input: TurnInput, callTool: CallTool, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const settings = getSettings()
  const skills = listSkills()
  const loaded = input.skills.map(n => skills.find(s => s.name === n)).filter((s): s is NonNullable<typeof s> => !!s)
  const models = (await catalog()).filter(m => m.available)
  const system = systemPrompt({ mode: conv.mode, skills, loadedSkills: loaded, memory: getMemory(), models, searchEnabled: !!settings.search.apiKey })
  conv.llm.push({ role: 'user', content: userTurn(input.text, input) })
  const tools = toolsFor(conv.mode)

  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await complete({
      model: conv.model || settings.llm.model,
      messages: [{ role: 'system', content: system }, ...conv.llm],
      tools, tool_choice: 'auto', temperature: 0.6,
      ...(EFFORT[conv.thinking] ? { reasoning_effort: EFFORT[conv.thinking] } : {}),
    }, signal)
    conv.llm.push(msg)
    const text = msg.content?.trim()
    if (text) { conv.display.push({ type: 'assistant', text, at: Date.now() }); emit({ type: 'text', text }) }
    if (!msg.tool_calls?.length) return
    for (const call of msg.tool_calls) {
      let args: any = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* surfaced below */ }
      const result = await callTool(call.function.name, args)
      conv.llm.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000) })
    }
    saveConversation(conv)
  }
  const note = 'I stopped after the maximum number of steps. Tell me to continue if needed.'
  conv.display.push({ type: 'assistant', text: note, at: Date.now() })
  emit({ type: 'text', text: note })
}
