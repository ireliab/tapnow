import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { Icon, type IconName } from '../icons'
import { renderMarkdown } from '../markdown'
import { useAutoResize } from '../panels/Chrome'
import { useStore } from '../store'
import { useAgent } from './agentStore'
import { OutputsTab } from './OutputsTab'
import { SkillsTab } from './SkillsTab'
import type { AgentMode, DisplayItem, NodeRef, Thinking } from './types'

const MODES: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: 'auto', label: 'Auto', hint: 'Generate right away' },
  { id: 'ask', label: 'Ask', hint: 'Confirm model, size, duration before spending' },
  { id: 'brainstorm', label: 'Brainstorm', hint: 'Develop the idea first — no generation' },
]
const THINKING: Thinking[] = ['off', 'light', 'standard', 'heavy']
const TOOL_LABEL: Record<string, [IconName, string]> = {
  get_canvas: ['grid', 'Read canvas'], create_nodes: ['plus', 'Created nodes'], update_node: ['text', 'Updated node'],
  connect_nodes: ['right', 'Connected nodes'], delete_nodes: ['trash', 'Deleted nodes'], generate: ['sparkle', 'Generate'],
  run_all: ['play', 'Run all'], add_to_playlist: ['timeline', 'Added to playlist'], ask_user: ['bot', 'Question'],
  web_search: ['list', 'Web search'], use_skill: ['sparkle', 'Using skill'], remember: ['check', 'Remembered'], save_output: ['folder', 'Saved output'],
}

export function AgentPanel() {
  const tab = useAgent(s => s.tab)
  const set = useAgent(s => s.set)
  const projectId = useStore(s => s.projectId)
  useEffect(() => { if (projectId) useAgent.getState().init(projectId).catch(() => {}) }, [projectId])
  return (
    <aside className="side-panel agent-panel">
      <div className="panel-head">
        <Icon name="bot" /> Agent
        <div className="seg small">
          {(['chat', 'skills', 'outputs'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => set({ tab: t })}>{t}</button>)}
        </div>
      </div>
      {tab === 'chat' && <Chat />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'outputs' && <OutputsTab />}
    </aside>
  )
}

function Chat() {
  const { items, running, queue, conversations, convId, mode, model, thinking, llm } = useAgent()
  const a = useAgent.getState()
  const end = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items.length, running])
  const locked = items.length > 0
  const current = conversations.find(c => c.id === convId)

  return (
    <>
      <div className="conv-bar">
        {renaming && current ? (
          <input autoFocus defaultValue={current.title} onBlur={e => { a.renameConversation(current.id, e.target.value || current.title); setRenaming(false) }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        ) : (
          <select value={convId ?? ''} onChange={e => e.target.value && a.openConversation(e.target.value)}>
            {!convId && <option value="">New conversation</option>}
            {conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        <button className="icon-btn" title="New conversation" onClick={() => a.newConversation()}><Icon name="plus" /></button>
        {current && <button className="icon-btn" title="Rename" onClick={() => setRenaming(true)}><Icon name="text" /></button>}
        {current && <button className="icon-btn" title="Delete conversation" onClick={() => confirm('Delete this conversation?') && a.deleteConversation(current.id)}><Icon name="trash" /></button>}
      </div>
      <div className="agent-opts">
        <div className="seg">
          {MODES.map(m => <button key={m.id} title={m.hint} className={mode === m.id ? 'on' : ''} onClick={() => a.setMode(m.id)}>{m.label}</button>)}
        </div>
        <select value={model} disabled={locked} title={locked ? 'Model is locked for this conversation' : llm.reachable ? 'LLM model' : 'LLM offline — using the built-in planner'}
          onChange={e => a.set({ model: e.target.value })}>
          {(llm.models.length ? llm.models : [model || 'offline']).map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={thinking} disabled={locked} title="Thinking level" onChange={e => a.set({ thinking: e.target.value as Thinking })}>
          {THINKING.map(t => <option key={t} value={t}>{t === 'off' ? 'Think: off' : t}</option>)}
        </select>
      </div>
      {!llm.reachable && <div className="agent-banner">LLM offline — using the built-in planner. Set a local LLM in Settings for full conversations.</div>}

      <div className="chat nowheel">
        {!items.length && <Welcome />}
        {items.map((it, i) => <Item key={i} item={it} index={i} />)}
        {running && <div className="msg assistant"><div className="bubble typing"><i /><i /><i /></div></div>}
        {queue.length > 0 && <div className="queued">{queue.length} queued: {queue.map(q => q.text.slice(0, 40)).join(' · ')}</div>}
        <div ref={end} />
      </div>
      <Composer />
    </>
  )
}

const SUGGESTIONS = [
  'A 20-second teaser for a cozy coffee shop at sunrise, 4 shots',
  'Astronaut discovers a glowing forest on an alien planet, then a creature appears, then she escapes',
  'Explain how this canvas was made',
]
function Welcome() {
  const skills = useAgent(s => s.skills)
  const send = (text: string) => useAgent.getState().send({ text, refs: [], skills: [] })
  return (
    <div className="welcome">
      <p>I'm your director agent. I can plan storyboards, build node workflows, generate, research and write briefs — right on the canvas.</p>
      <div className="suggestions">{SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
      <div className="skill-strip">
        {skills.slice(0, 6).map(s => <button key={s.name} className="chip ghost" onClick={() => useAgent.getState().addSkill(s.name)}><Icon name={(s.icon as IconName) ?? 'sparkle'} size={12} /> {s.title}</button>)}
      </div>
    </div>
  )
}

function Item({ item, index }: { item: DisplayItem; index: number }) {
  const running = useAgent(s => s.running)
  if (item.type === 'user') {
    return (
      <div className="msg user">
        {(item.skills?.length || item.refs?.length) ? (
          <div className="msg-meta">
            {item.skills?.map(s => <span key={s} className="chip skill">⚡ {s}</span>)}
            {item.refs?.map(r => <span key={r.nodeId} className="chip ghost">@{r.title}</span>)}
          </div>
        ) : null}
        <div className="bubble">{item.text}</div>
      </div>
    )
  }
  if (item.type === 'assistant') {
    return (
      <div className="msg assistant">
        <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />
        {!running && <button className="branch" title="Branch a new conversation from here" onClick={() => useAgent.getState().branch(index)}>⑂ branch</button>}
      </div>
    )
  }
  if (item.type === 'error') return <div className="msg assistant"><div className="bubble error">{item.text}</div></div>
  return <ToolItem item={item} />
}

function summarizeArgs(name: string, args: any, result: any) {
  if (name === 'create_nodes') return `${args?.nodes?.length ?? 0} nodes, ${args?.edges?.length ?? 0} links`
  if (name === 'generate') return result?.declined ? 'declined' : `${args?.node_ids?.length ?? 0} nodes${result?.results ? ` · ${result.results.filter((r: any) => r.status === 'done').length} done` : ''}`
  if (name === 'web_search') return args?.query
  if (name === 'use_skill') return args?.name
  if (name === 'save_output') return args?.title
  if (name === 'remember') return args?.preference
  if (name === 'add_to_playlist') return `${args?.node_ids?.length ?? 0} clips`
  return ''
}

function ToolItem({ item }: { item: Extract<DisplayItem, { type: 'tool' }> }) {
  const pending = useAgent(s => s.pending[item.callId])
  const [open, setOpen] = useState(false)
  const [icon, label] = TOOL_LABEL[item.name] ?? ['sparkle', item.name]
  if (pending?.kind === 'ask') return <QuestionCard questions={pending.questions} onDone={pending.resolve} />
  if (pending?.kind === 'confirm') return <ConfirmCard nodeIds={pending.nodeIds} onDone={pending.resolve} />
  const results: any[] | undefined = item.name === 'web_search' ? item.result?.results : undefined
  return (
    <div className={`tool-step ${item.status}`}>
      <button className="tool-line" onClick={() => setOpen(!open)}>
        <span className="dot" /> <Icon name={icon} size={13} /> <b>{label}</b> <span className="muted">{summarizeArgs(item.name, item.args, item.result)}</span>
        {item.status === 'error' && <span className="err">{item.result?.error ? String(item.result.error).slice(0, 80) : 'failed'}</span>}
      </button>
      {results && (
        <ul className="search-results">{results.map((r, i) => <li key={i}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> <span className="muted">{r.date ?? ''}</span></li>)}</ul>
      )}
      {item.name === 'ask_user' && item.result?.answers && (
        <div className="muted small">{item.args.questions.map((q: any, i: number) => `${q.question} → ${item.result.answers[i] || '—'}`).join(' · ')}</div>
      )}
      {open && <pre className="tool-json">{JSON.stringify({ args: item.args, result: item.result }, null, 2).slice(0, 4000)}</pre>}
    </div>
  )
}

function QuestionCard({ questions, onDone }: { questions: Array<{ question: string; options?: string[] }>; onDone: (r: any) => void }) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ''))
  const put = (i: number, v: string) => setAnswers(a => a.map((x, j) => (j === i ? v : x)))
  return (
    <div className="card-q">
      {questions.map((q, i) => (
        <div key={i} className="q">
          <b>{q.question}</b>
          {q.options && <div className="opts">{q.options.map(o => <button key={o} className={answers[i] === o ? 'on' : ''} onClick={() => put(i, o)}>{o}</button>)}</div>}
          <input placeholder={q.options ? 'Or type your own…' : 'Your answer…'} value={q.options?.includes(answers[i]) ? '' : answers[i]} onChange={e => put(i, e.target.value)} />
        </div>
      ))}
      <div className="card-actions">
        <button className="btn" onClick={() => onDone({ cancelled: true })}>Skip</button>
        <button className="btn primary" onClick={() => onDone({ answers })}>Submit {questions.length > 1 ? `${questions.length} answers` : ''}</button>
      </div>
    </div>
  )
}

function ConfirmCard({ nodeIds, onDone }: { nodeIds: string[]; onDone: (r: { approved: boolean }) => void }) {
  const nodes = useStore(s => s.nodes)
  const models = useStore(s => s.models)
  const { updateData } = useStore.getState()
  const list = nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as typeof nodes
  const paid = list.filter(n => ['fal', 'openai'].includes(models.find(x => x.id === n.data.model)?.provider ?? '')).length
  return (
    <div className="card-confirm">
      <div className="card-title"><Icon name="sparkle" size={14} /> Ready to generate {list.length} node{list.length > 1 ? 's' : ''}</div>
      {paid > 0 && <div className="agent-banner">{paid} of these use paid cloud models and will be billed to your account.</div>}
      {list.map(n => {
        const m = models.find(x => x.id === n.data.model)
        const setP = (p: object) => updateData(n.id, { params: { ...n.data.params, ...p } })
        return (
          <div key={n.id} className="confirm-row">
            <span className="t" title={n.data.prompt}><Icon name={n.data.kind} size={12} /> {n.data.title}
              {m && (m.provider === 'fal' || m.provider === 'openai') && <span className="chip warn">paid · {m.provider === 'fal' ? 'fal.ai' : 'OpenAI'}</span>}</span>
            <select value={n.data.model} onChange={e => updateData(n.id, { model: e.target.value })}>
              {models.filter(x => x.kind === n.data.kind).map(x => <option key={x.id} value={x.id} disabled={!x.available}>{x.name}</option>)}
            </select>
            {m?.aspects && <select value={n.data.params.aspect ?? m.aspects[0]} onChange={e => setP({ aspect: e.target.value })}>{m.aspects.map(x => <option key={x}>{x}</option>)}</select>}
            {m?.durations && <select value={n.data.params.duration ?? m.durations[0]} onChange={e => setP({ duration: Number(e.target.value) })}>{m.durations.map(d => <option key={d} value={d}>{d}s</option>)}</select>}
            <select value={n.data.params.count ?? 1} title="Outputs" onChange={e => setP({ count: Number(e.target.value) })}>{[1, 2, 3, 4].map(c => <option key={c} value={c}>×{c}</option>)}</select>
          </div>
        )
      })}
      <div className="card-actions">
        <button className="btn" onClick={() => onDone({ approved: false })}>Don't generate</button>
        <button className="btn primary" onClick={() => onDone({ approved: true })}><Icon name="sparkle" size={14} /> Generate</button>
      </div>
    </div>
  )
}

function Composer() {
  const { draft, running, focusTick, skills } = useAgent()
  const a = useAgent.getState()
  const nodes = useStore(s => s.nodes)
  const ta = useAutoResize(draft.text)
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<null | 'plus' | 'skills'>(null)
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  const [hi, setHi] = useState(0)
  useEffect(() => { if (focusTick) ta.current?.focus() }, [focusTick])

  const setText = (text: string) => a.set({ draft: { ...useAgent.getState().draft, text } })
  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    return nodes.filter(n => !n.hidden && n.data.title.toLowerCase().includes(q)).slice(0, 8)
  }, [mention, nodes])

  const onChange = (v: string, caret: number) => {
    setText(v)
    const m = v.slice(0, caret).match(/(^|\s)@([^\s@]*)$/)
    setMention(m ? { q: m[2], at: caret - m[2].length - 1 } : null)
    setHi(0)
  }
  const pickMention = (n: (typeof nodes)[number]) => {
    if (!mention) return
    const t = useAgent.getState().draft.text
    const caretEnd = mention.at + 1 + mention.q.length
    setText(`${t.slice(0, mention.at)}@${n.data.title} ${t.slice(caretEnd)}`)
    a.addRef({ nodeId: n.id, title: n.data.title, kind: n.data.kind })
    setMention(null)
    ta.current?.focus()
  }
  const insertSelected = () => {
    const sel = nodes.filter(n => n.selected && !n.hidden)
    if (!sel.length) return useStore.getState().notify('Select nodes on the canvas first', 'info')
    sel.forEach(n => a.addRef({ nodeId: n.id, title: n.data.title, kind: n.data.kind }))
    setText(`${useAgent.getState().draft.text}${sel.map(n => ` @${n.data.title}`).join('')} `.trimStart())
    setMenu(null)
  }
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const st = useStore.getState()
    const assets = await api.upload([...files], st.projectId)
    for (const as of assets) {
      const id = st.addAssetNode(as)
      const title = useStore.getState().nodes.find(n => n.id === id)!.data.title
      a.addRef({ nodeId: id, title, kind: as.kind })
      setText(`${useAgent.getState().draft.text} @${title} `.trimStart())
    }
    setMenu(null)
  }
  const removeRef = (r: NodeRef) => a.set({ draft: { ...draft, refs: draft.refs.filter(x => x.nodeId !== r.nodeId), text: draft.text.replace(`@${r.title}`, '').replace(/\s{2,}/g, ' ') } })

  return (
    <div className="agent-composer">
      {(draft.refs.length > 0 || draft.skills.length > 0) && (
        <div className="draft-chips">
          {draft.skills.map(s => <span key={s} className="chip skill">⚡ {skills.find(x => x.name === s)?.title ?? s}<button onClick={() => a.set({ draft: { ...draft, skills: draft.skills.filter(x => x !== s) } })}>×</button></span>)}
          {draft.refs.map(r => <span key={r.nodeId} className="chip ghost"><Icon name={r.kind as IconName} size={11} /> {r.title}<button onClick={() => removeRef(r)}>×</button></span>)}
        </div>
      )}
      {mention && candidates.length > 0 && (
        <div className="mention-pop">
          {candidates.map((n, i) => <button key={n.id} className={i === hi ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pickMention(n) }}><Icon name={n.data.kind} size={12} /> {n.data.title}</button>)}
        </div>
      )}
      {menu && <div className="backdrop-clear" onPointerDown={() => setMenu(null)} />}
      {menu === 'plus' && (
        <div className="plus-menu">
          <button onClick={insertSelected}><Icon name="grid" /> Insert selected nodes</button>
          <button onClick={() => fileRef.current?.click()}><Icon name="upload" /> Upload attachment</button>
          <button onClick={() => setMenu('skills')}><Icon name="sparkle" /> Add skill ›</button>
        </div>
      )}
      {menu === 'skills' && (
        <div className="plus-menu skills">
          {skills.map(s => <button key={s.name} onClick={() => { a.addSkill(s.name); setMenu(null) }} title={s.description}><Icon name={(s.icon as IconName) ?? 'sparkle'} /> {s.title}</button>)}
        </div>
      )}
      <div className="chat-input">
        <button className="icon-btn" title="Add context" onClick={() => setMenu(menu ? null : 'plus')}><Icon name="plus" /></button>
        <textarea ref={ta} rows={1} value={draft.text} placeholder={running ? 'Queue the next instruction…' : 'Describe what to make — type @ to reference nodes'}
          onChange={e => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={e => {
            if (mention && candidates.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % candidates.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + candidates.length) % candidates.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(candidates[hi]); return }
              if (e.key === 'Escape') { setMention(null); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); a.send() }
          }} />
        {running
          ? <button className="icon-btn danger" title="Stop" onClick={() => a.stop()}><Icon name="stop" /></button>
          : <button className="icon-btn primary" disabled={!draft.text.trim()} onClick={() => a.send()}><Icon name="send" /></button>}
      </div>
      <input ref={fileRef} type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={e => { upload(e.target.files); e.target.value = '' }} />
    </div>
  )
}
