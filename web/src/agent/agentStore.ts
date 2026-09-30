import { create } from 'zustand'
import { summarize } from '../graph'
import { useStore } from '../store'
import { agentApi, sendMessage } from './agentApi'
import { runClientTool } from './clientTools'
import type { AgentMode, AgentOutput, ConversationMeta, DisplayItem, NodeRef, Skill, Thinking } from './types'

export type PendingBody =
  | { kind: 'ask'; questions: Array<{ question: string; options?: string[] }> }
  | { kind: 'confirm'; nodeIds: string[] }
export type Pending = PendingBody & { resolve: (r: any) => void }

interface Draft { text: string; refs: NodeRef[]; skills: string[] }
interface Queued extends Draft { canvasOverride?: string }

interface AgentState {
  tab: 'chat' | 'skills' | 'outputs'
  conversations: ConversationMeta[]
  convId?: string
  items: DisplayItem[]
  mode: AgentMode
  model: string
  thinking: Thinking
  llm: { models: string[]; reachable: boolean }
  running: boolean
  runId?: string
  queue: Queued[]
  draft: Draft
  pending: Record<string, Pending>
  /** refs handed out by create_nodes during the current run → node ids */
  refMap: Record<string, string>
  skills: Skill[]
  outputs: AgentOutput[]
  focusTick: number

  set: (p: Partial<AgentState>) => void
  init: (projectId: string) => Promise<void>
  newConversation: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  branch: (at: number) => Promise<void>
  setMode: (m: AgentMode) => void
  send: (d?: Draft) => Promise<void>
  stop: () => void
  addRef: (r: NodeRef) => void
  addSkill: (name: string) => void
  focusComposer: () => void
  loadSkills: () => Promise<void>
  loadOutputs: () => Promise<void>
}

const emptyDraft = (): Draft => ({ text: '', refs: [], skills: [] })
let abort: AbortController | undefined

export const useAgent = create<AgentState>((set, get) => ({
  tab: 'chat', conversations: [], items: [], mode: 'auto', model: '', thinking: 'off',
  llm: { models: [], reachable: false }, running: false, queue: [], draft: emptyDraft(), pending: {}, refMap: {},
  skills: [], outputs: [], focusTick: 0,

  set: p => set(p),

  async init(projectId) {
    const [convs, llm] = await Promise.all([agentApi.conversations(projectId), agentApi.llmModels().catch(() => ({ default: '', models: [], reachable: false }))])
    set({ conversations: convs, llm: { models: llm.models, reachable: llm.reachable }, model: llm.default, items: [], convId: undefined, outputs: [] })
    get().loadSkills()
    get().loadOutputs()
    if (convs[0]) await get().openConversation(convs[0].id)
  },

  async newConversation() {
    const projectId = useStore.getState().projectId!
    const { mode, model, thinking } = get()
    const c = await agentApi.createConversation(projectId, { mode, model, thinking })
    set({ convId: c.id, items: [], conversations: [c, ...get().conversations], draft: { ...get().draft } })
  },

  async openConversation(id) {
    const projectId = useStore.getState().projectId!
    const c = await agentApi.conversation(projectId, id)
    set({ convId: c.id, items: c.display, mode: c.mode, thinking: c.thinking, model: c.model || get().model })
  },

  async deleteConversation(id) {
    const projectId = useStore.getState().projectId!
    await agentApi.deleteConversation(projectId, id)
    const rest = get().conversations.filter(c => c.id !== id)
    set({ conversations: rest })
    if (get().convId === id) {
      if (rest[0]) await get().openConversation(rest[0].id)
      else set({ convId: undefined, items: [] })
    }
  },

  async renameConversation(id, title) {
    const projectId = useStore.getState().projectId!
    await agentApi.patchConversation(projectId, id, { title })
    set({ conversations: get().conversations.map(c => (c.id === id ? { ...c, title } : c)) })
  },

  async branch(at) {
    const { convId } = get()
    const projectId = useStore.getState().projectId!
    if (!convId) return
    const c = await agentApi.branch(projectId, convId, at)
    set({ conversations: [c, ...get().conversations], convId: c.id, items: c.display })
    useStore.getState().notify('Branched into a new conversation')
  },

  setMode(mode) {
    set({ mode })
    const { convId } = get()
    const projectId = useStore.getState().projectId
    if (convId && projectId) agentApi.patchConversation(projectId, convId, { mode }).catch(() => {})
  },

  async send(d) {
    const draft = d ?? get().draft
    const text = draft.text.trim()
    if (!text) return
    if (!d) set({ draft: emptyDraft() })
    if (get().running) { set({ queue: [...get().queue, { ...draft, text }] }); return }

    const canvas = useStore.getState()
    const projectId = canvas.projectId!
    if (!get().convId) await get().newConversation()
    const convId = get().convId!
    // persist model/thinking choice before the first message locks them
    if (!get().items.length) await agentApi.patchConversation(projectId, convId, { model: get().model, thinking: get().thinking, mode: get().mode }).catch(() => {})

    // keep only refs still mentioned in the text (or explicitly inserted)
    const refs = draft.refs.filter(r => text.includes(`@${r.title}`) || !text.includes('@')).map(r => {
      const n = canvas.nodes.find(x => x.id === r.nodeId)
      const v = n && (n.data.kind === 'text' ? n.data.prompt : n.data.outputs[n.data.active]?.url)
      return { ...r, value: v || undefined }
    })
    set({
      running: true, refMap: {},
      items: [...get().items, { type: 'user', text, refs, skills: draft.skills, at: Date.now() }],
    })
    abort = new AbortController()
    let runId = ''
    try {
      for await (const e of sendMessage(projectId, convId, {
        text, refs, attachments: [], skills: draft.skills, canvas: summarize(canvas.nodes.filter(n => !n.hidden), canvas.edges),
      }, abort.signal)) {
        const items = get().items
        switch (e.type) {
          case 'run': runId = e.runId; set({ runId }); break
          case 'title': set({ conversations: get().conversations.map(c => (c.id === convId ? { ...c, title: e.title } : c)) }); break
          case 'text': set({ items: [...items, { type: 'assistant', text: e.text, at: Date.now() }] }); break
          case 'tool_call':
            set({ items: [...items, { type: 'tool', callId: e.callId, name: e.name, args: e.args, status: 'running', at: Date.now() }] })
            if (e.client) {
              runClientTool(e.name, e.args, e.callId)
                .catch(err => ({ error: String(err?.message ?? err) }))
                .then(r => agentApi.toolResult(runId, e.callId, r))
                .then(r => {
                  // the server no longer knows this run (e.g. it restarted): end the turn instead of hanging
                  if (!(r as { ok?: boolean })?.ok && get().runId === runId) {
                    set({ items: [...get().items, { type: 'error', text: 'The agent run was interrupted (server restarted). Send your message again to continue.', at: Date.now() }] })
                    abort?.abort()
                  }
                })
                .catch(() => {})
            }
            break
          case 'tool_result':
            set({ items: items.map(it => (it.type === 'tool' && it.callId === e.callId ? { ...it, result: e.result, status: e.error ? 'error' : 'done' } : it)) })
            break
          case 'output': set({ outputs: [e.output, ...get().outputs.filter(o => o.id !== e.output.id)] }); break
          case 'error': set({ items: [...items, { type: 'error', text: e.error, at: Date.now() }] }); break
        }
      }
    } catch (err: any) {
      if (!abort.signal.aborted) set({ items: [...get().items, { type: 'error', text: String(err?.message ?? err), at: Date.now() }] })
    } finally {
      // drop any unanswered cards
      for (const p of Object.values(get().pending)) p.resolve(p.kind === 'ask' ? { cancelled: true } : { approved: false })
      set({ running: false, runId: undefined, pending: {} })
    }
    const [next, ...rest] = get().queue
    if (next) { set({ queue: rest }); get().send(next) }
  },

  stop() {
    const { runId } = get()
    if (runId) agentApi.cancel(runId).catch(() => {})
    useStore.getState().stopAll()
    set({ queue: [] })
    setTimeout(() => abort?.abort(), 1500)
  },

  addRef(r) {
    const d = get().draft
    if (d.refs.some(x => x.nodeId === r.nodeId)) return
    set({ draft: { ...d, refs: [...d.refs, r] } })
  },
  addSkill(name) {
    const d = get().draft
    if (!d.skills.includes(name)) set({ draft: { ...d, skills: [...d.skills, name] } })
    set({ tab: 'chat' })
    get().focusComposer()
  },
  focusComposer() {
    useStore.getState().set({ panel: 'agent' })
    set({ focusTick: get().focusTick + 1 })
  },

  async loadSkills() { set({ skills: await agentApi.skills() }) },
  async loadOutputs() {
    const projectId = useStore.getState().projectId
    if (projectId) set({ outputs: await agentApi.outputs(projectId) })
  },
}))
