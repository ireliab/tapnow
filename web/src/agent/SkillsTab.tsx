import { useState } from 'react'
import { Icon, type IconName } from '../icons'
import { Modal } from '../panels/Chrome'
import { useStore } from '../store'
import { agentApi } from './agentApi'
import { useAgent } from './agentStore'
import type { Skill } from './types'

const ICONS: IconName[] = ['sparkle', 'film', 'image', 'video', 'audio', 'text', 'list', 'grid', 'bot', 'folder']
const TOOLS = ['get_canvas', 'create_nodes', 'update_node', 'connect_nodes', 'delete_nodes', 'generate', 'run_all', 'add_to_playlist', 'ask_user', 'web_search', 'save_output', 'remember']
const blank = (): Skill => ({ name: '', title: '', description: '', icon: 'sparkle', category: 'creative', inputs: ['text'], tools: ['create_nodes', 'generate'], offline: false, body: '', source: 'user' })

/** The agent's "App store": browse built-in and custom skills, try them, or write your own. */
export function SkillsTab() {
  const skills = useAgent(s => s.skills)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Skill | null>(null)
  const { addSkill } = useAgent.getState()
  const shown = skills.filter(s => `${s.title} ${s.description}`.toLowerCase().includes(q.toLowerCase()))
  const groups = (['creative', 'research', 'utility'] as const).map(c => [c, shown.filter(s => s.category === c)] as const).filter(([, l]) => l.length)

  const tryIt = (s: Skill) => {
    addSkill(s.name)
    const example: Record<string, string> = {
      storyboard: 'A 20-second teaser for ', brainstorm: 'Help me develop an idea: ', 'script-to-scenes': 'Split this script into scenes:\n',
      'product-shots': 'Make a product shot set from @', 'character-sheet': 'Character sheet for ', 'multilingual-dub': 'Dub this into Spanish and Japanese: ',
      'ad-campaign': 'Campaign for ', 'web-research': 'Research ', 'explain-canvas': 'Explain how this canvas was made',
    }
    useAgent.setState(st => ({ draft: { ...st.draft, text: example[s.name] ?? st.draft.text } }))
  }

  return (
    <div className="skills-tab">
      <div className="skills-head">
        <input placeholder="Search skills…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEditing(blank())}><Icon name="plus" size={14} /> New skill</button>
      </div>
      <div className="skills-list nowheel">
        {groups.map(([cat, list]) => (
          <section key={cat}>
            <h4>{cat}</h4>
            {list.map(s => (
              <div key={s.name} className="skill-card">
                <div className="skill-icon"><Icon name={(ICONS.includes(s.icon as IconName) ? s.icon : 'sparkle') as IconName} size={18} /></div>
                <div className="skill-body">
                  <b>{s.title} {s.source === 'user' && <span className="chip ghost">custom</span>} {s.offline && <span className="chip ghost" title="Works without an LLM">offline</span>}</b>
                  <p>{s.description}</p>
                  <div className="skill-actions">
                    <button className="btn small" onClick={() => tryIt(s)}>Try in chat</button>
                    <button className="btn small" onClick={() => addSkill(s.name)}>Add to chat</button>
                    <button className="link" onClick={() => setEditing({ ...s })}>{s.source === 'user' ? 'Edit' : 'Customize'}</button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [s, setS] = useState(skill)
  const isNew = !skill.name
  const notify = useStore.getState().notify
  const save = async () => {
    if (!s.name.trim() || !s.description.trim() || !s.body.trim()) return notify('Name, description and instructions are required', 'error')
    try {
      await agentApi.saveSkill({ ...s, name: s.name })
      await useAgent.getState().loadSkills()
      notify(skill.source === 'builtin' ? 'Saved as a custom version of the built-in skill' : 'Skill saved')
      onClose()
    } catch (e: any) { notify(e.message, 'error') }
  }
  const remove = async () => {
    if (!confirm(`Delete skill "${s.title}"?`)) return
    await agentApi.deleteSkill(s.name)
    await useAgent.getState().loadSkills()
    onClose()
  }
  const toggle = (k: 'tools' | 'inputs', v: string) => setS({ ...s, [k]: s[k].includes(v) ? s[k].filter(x => x !== v) : [...s[k], v] })
  return (
    <Modal title={isNew ? 'New skill' : `${skill.source === 'builtin' ? 'Customize' : 'Edit'} · ${skill.title}`} onClose={onClose} wide>
      <div className="settings-body">
        <div className="row2">
          <label className="field"><span>Name (id)</span><input value={s.name} disabled={!isNew} placeholder="e.g. music-video" onChange={e => setS({ ...s, name: e.target.value })} /></label>
          <label className="field"><span>Title</span><input value={s.title} onChange={e => setS({ ...s, title: e.target.value })} /></label>
        </div>
        <label className="field"><span>Description — the agent reads this to decide when to use the skill</span><input value={s.description} onChange={e => setS({ ...s, description: e.target.value })} /></label>
        <div className="row2">
          <label className="field"><span>Category</span>
            <select value={s.category} onChange={e => setS({ ...s, category: e.target.value as Skill['category'] })}>{['creative', 'research', 'utility'].map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Icon</span>
            <select value={s.icon} onChange={e => setS({ ...s, icon: e.target.value })}>{ICONS.map(c => <option key={c}>{c}</option>)}</select></label>
        </div>
        <div className="field"><span>Inputs</span>
          <div className="opts">{['text', 'image', 'video', 'audio'].map(k => <button key={k} className={s.inputs.includes(k) ? 'on' : ''} onClick={() => toggle('inputs', k)}>{k}</button>)}</div></div>
        <div className="field"><span>Tools it uses</span>
          <div className="opts">{TOOLS.map(k => <button key={k} className={s.tools.includes(k) ? 'on' : ''} onClick={() => toggle('tools', k)}>{k}</button>)}</div></div>
        <label className="field"><span>Instructions (markdown)</span>
          <textarea rows={12} value={s.body} placeholder={'1. Ask for …\n2. create_nodes with …\n3. generate …'} onChange={e => setS({ ...s, body: e.target.value })} spellCheck={false} /></label>
        <p className="muted">Saved to <code>data/skills/{s.name || '<name>'}/SKILL.md</code>. Custom skills need a connected LLM; the offline planner only runs built-ins.</p>
      </div>
      <div className="modal-foot">
        {skill.source === 'user' && !isNew && <button className="btn danger" onClick={remove}>Delete</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save skill</button>
      </div>
    </Modal>
  )
}
