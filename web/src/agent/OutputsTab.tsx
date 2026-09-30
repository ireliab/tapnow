import { useState } from 'react'
import { Icon } from '../icons'
import { renderMarkdown } from '../markdown'
import { Modal } from '../panels/Chrome'
import { useStore } from '../store'
import { agentApi } from './agentApi'
import { useAgent } from './agentStore'
import type { AgentOutput } from './types'

/** Documents the agent saved (briefs, scripts, research) for this project. */
export function OutputsTab() {
  const outputs = useAgent(s => s.outputs)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<AgentOutput | null>(null)
  const shown = outputs.filter(o => `${o.title} ${o.content}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="skills-tab">
      <div className="skills-head"><input placeholder="Search outputs…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="skills-list nowheel">
        {shown.map(o => (
          <button key={o.id} className="output-card" onClick={() => setOpen(o)}>
            <b>{o.title}</b>
            <span className={`status ${o.status}`}>{o.status}</span>
            <p>{o.content.replace(/[#*`>-]/g, '').slice(0, 140)}</p>
            <small className="muted">{new Date(o.updatedAt).toLocaleString()}</small>
          </button>
        ))}
        {!shown.length && <p className="muted pad">Briefs, scripts and research the agent saves appear here. Ask it to "save a creative brief".</p>}
      </div>
      {open && <OutputModal output={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function OutputModal({ output, onClose }: { output: AgentOutput; onClose: () => void }) {
  const [o, setO] = useState(output)
  const [edit, setEdit] = useState(false)
  const st = useStore.getState()
  const save = async (patch: Partial<AgentOutput>) => {
    const next = await agentApi.saveOutput(st.projectId!, { ...o, ...patch })
    setO(next)
    useAgent.setState(s => ({ outputs: s.outputs.map(x => (x.id === next.id ? next : x)) }))
  }
  const toCanvas = () => {
    st.addNode('text', undefined, { title: o.title, prompt: o.content })
    st.notify('Added to canvas as a text node')
  }
  const remove = async () => {
    if (!confirm('Delete this output?')) return
    await agentApi.deleteOutput(st.projectId!, o.id)
    useAgent.setState(s => ({ outputs: s.outputs.filter(x => x.id !== o.id) }))
    onClose()
  }
  return (
    <Modal title={o.title} onClose={onClose} wide>
      <div className="output-toolbar">
        <select value={o.status} onChange={e => save({ status: e.target.value as AgentOutput['status'] })}>
          {['draft', 'review', 'approved'].map(s => <option key={s}>{s}</option>)}
        </select>
        <button className="btn" onClick={() => (edit ? save({ content: o.content }).then(() => setEdit(false)) : setEdit(true))}>{edit ? 'Done' : 'Edit'}</button>
        <button className="btn" onClick={() => { navigator.clipboard.writeText(o.content); st.notify('Copied') }}><Icon name="copy" size={14} /> Copy</button>
        <button className="btn" onClick={toCanvas}><Icon name="plus" size={14} /> Add to canvas</button>
        <button className="btn" onClick={() => { useAgent.getState().set({ tab: 'chat', draft: { text: `Revise "${o.title}": `, refs: [], skills: [] } }); useAgent.getState().focusComposer(); onClose() }}>Revise with Agent</button>
        <div className="spacer" />
        <button className="icon-btn" title="Delete" onClick={remove}><Icon name="trash" /></button>
      </div>
      {edit
        ? <textarea className="code output-edit" rows={20} value={o.content} onChange={e => setO({ ...o, content: e.target.value })} />
        : <div className="md doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(o.content) }} />}
    </Modal>
  )
}
