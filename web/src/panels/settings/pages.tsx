import { useMemo, useState } from 'react'
import { Icon } from '../../icons'
import { useStore, type CanvasSettings } from '../../store'
import { ModelList, section } from './ModelList'
import { Card, ConnectionCard, Field, KeyField, PageHead, PROVIDER_META, PROVIDER_OF_MODEL, useSettings } from './shared'

// ---------- general ----------
export function CanvasPage() {
  const canvas = useStore(st => st.canvasSettings)
  const setCanvas = (patch: Partial<CanvasSettings>) => {
    const next = { ...useStore.getState().canvasSettings, ...patch }
    useStore.setState({ canvasSettings: next })
    try { localStorage.setItem('taplocal:canvas', JSON.stringify(next)) } catch { /* private mode */ }
  }
  return <>
    <PageHead icon="grid" title="Canvas" blurb="How the canvas behaves. Saved in this browser and applied right away." />
    <Card title="Multiple results">
      <div className="field"><span>When a run makes several results (×2–×4)</span>
        <div className="opts">
          {([['history', 'Keep them in the node history'], ['spread', 'Spread as new nodes'], ['stack', 'Pile them into a stack']] as const).map(([k, l]) => (
            <button key={k} className={canvas.resultMode === k ? 'on' : ''} onClick={() => setCanvas({ resultMode: k })}>{l}</button>
          ))}
        </div>
      </div>
    </Card>
    <Card title="Layout">
      <label className="check"><input type="checkbox" checked={canvas.snapToGrid} onChange={e => setCanvas({ snapToGrid: e.target.checked })} /> Snap nodes to grid</label>
    </Card>
  </>
}

export function MemoryPage({ memory, setMemory }: { memory: string; setMemory: (v: string) => void }) {
  return <>
    <PageHead icon="brain" title="Agent memory" blurb={'Preferences the Agent always follows. It adds to this list when you say "remember …".'} />
    <Card title="One preference per line">
      <textarea className="code" rows={12} value={memory} onChange={e => setMemory(e.target.value)} placeholder={'Default aspect ratio 9:16\nAlways ask before generating video'} />
    </Card>
  </>
}

// ---------- providers ----------
const head = (p: keyof typeof PROVIDER_META) => <PageHead icon={PROVIDER_META[p].icon} title={PROVIDER_META[p].name} blurb={PROVIDER_META[p].blurb} />

const LLM_PRESETS = [['Ollama', 'http://localhost:11434/v1'], ['LM Studio', 'http://localhost:1234/v1'], ['OpenAI', 'https://api.openai.com/v1']]

export function LlmPage() {
  const { s, saved, up, status, models } = useSettings()
  const installed = status.llm?.models ?? []
  return <>
    {head('llm')}
    <ConnectionCard p="llm" />
    <Card title="Server">
      <Field label="Base URL" value={s.llm.baseUrl} onChange={v => up('llm', { baseUrl: v })} placeholder="http://localhost:11434/v1" />
      <div className="opts">
        {LLM_PRESETS.map(([l, u]) => <button key={l} className={s.llm.baseUrl === u ? 'on' : ''} onClick={() => up('llm', { baseUrl: u })}>{l}</button>)}
      </div>
      <KeyField label="API key (optional for local servers)" value={s.llm.apiKey} saved={saved.llm.apiKey} onChange={v => up('llm', { apiKey: v })} placeholder="Leave empty for Ollama / LM Studio" />
    </Card>
    <Card title="Model">
      <Field label="Model name" value={s.llm.model} onChange={v => up('llm', { model: v })} placeholder="llama3.1, qwen2.5, gpt-4o-mini…" list="llm-models" />
      <datalist id="llm-models">{installed.map(m => <option key={m} value={m} />)}</datalist>
      {installed.length > 0 && <>
        <small className="muted">Available on this server — click to use:</small>
        <div className="opts">{installed.slice(0, 40).map(m => <button key={m} className={s.llm.model === m ? 'on' : ''} onClick={() => up('llm', { model: m })}>{m}</button>)}</div>
      </>}
    </Card>
    <Card title="In the canvas"><ModelList models={models.filter(m => m.provider === 'llm')} /></Card>
  </>
}

const COMFY_HELP = `Export from ComfyUI with "Save (API format)", then put placeholders in it:
"{{prompt}}", "{{negative}}", "{{image}}", "{{last_image}}"  — text and image-name fields
"{{seed}}", "{{width}}", "{{height}}", "{{frames}}", "{{duration}}"  — numbers (keep the quotes)`

export function ComfyPage() {
  const { s, up, status, models } = useSettings()
  const details = status.comfyui?.details ?? []
  const wf = (label: 'Image' | 'Video', key: 'imageWorkflow' | 'videoWorkflow') => {
    const value = s.comfyui[key]
    const issues = details.filter(d => d.startsWith(label))
    return (
      <div className="field">
        <div className="wf-head"><span>{label} workflow</span>
          {!value.trim() ? <span className="chip ghost">not set — ComfyUI {label} is off</span>
            : issues.length ? <span className="chip warn">{issues.length} issue{issues.length > 1 ? 's' : ''}</span>
            : status.comfyui?.status === 'valid' ? <span className="chip ok"><Icon name="check" size={11} /> looks good</span> : null}
        </div>
        <textarea className="code" rows={7} value={value} onChange={e => up('comfyui', { [key]: e.target.value })} spellCheck={false} placeholder='{"3": {"class_type": "KSampler", "inputs": {…}}, …}' />
        {issues.map(i => <small key={i} className="warn-text">{i}</small>)}
      </div>
    )
  }
  return <>
    {head('comfyui')}
    <ConnectionCard p="comfyui" />
    <Card title="Server"><Field label="ComfyUI URL" value={s.comfyui.url} onChange={v => up('comfyui', { url: v })} placeholder="http://127.0.0.1:8188" /></Card>
    <Card title="Workflows">
      <details className="set-help"><summary>How to prepare a workflow</summary><pre className="hint">{COMFY_HELP}</pre></details>
      {wf('Image', 'imageWorkflow')}
      {wf('Video', 'videoWorkflow')}
    </Card>
    <Card title="In the canvas"><ModelList models={models.filter(m => m.provider === 'comfyui')} /></Card>
  </>
}

export function FalPage() {
  const { s, saved, up, models, go } = useSettings()
  return <>
    {head('fal')}
    <ConnectionCard p="fal" />
    <Card title="API key">
      <KeyField label="fal.ai key" value={s.fal.apiKey} saved={saved.fal.apiKey} onChange={v => up('fal', { apiKey: v })} placeholder="xxxxxxxx-xxxx-…:xxxxxxxx"
        hint={<>Create one at <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">fal.ai/dashboard/keys</a>. Stored only in <code>data/settings.json</code> on this machine.</>} />
    </Card>
    <Card title="Models" aside={<button className="link" onClick={() => go('custom')}><Icon name="plus" size={12} /> Add more fal models</button>}>
      <p className="muted small">Turn off models you don't use to keep the canvas dropdowns short. Prices are fal's list prices, loaded with the key check.</p>
      <ModelList models={models.filter(m => m.provider === 'fal')} />
    </Card>
  </>
}

export function OpenAiPage() {
  const { s, saved, up, models, status } = useSettings()
  const list = models.filter(m => m.provider === 'openai')
  const inCatalog = new Set(list.map(m => m.extra?.remote))
  const pending = (status.openai?.models ?? []).filter(id => !inCatalog.has(id))
  return <>
    {head('openai')}
    <ConnectionCard p="openai" />
    <Card title="API key">
      <KeyField label="OpenAI key" value={s.openai.apiKey} saved={saved.openai.apiKey} onChange={v => up('openai', { apiKey: v })} placeholder="sk-…"
        hint={<>From <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.</>} />
      <Field label="Base URL" value={s.openai.baseUrl} onChange={v => up('openai', { baseUrl: v })} hint="Change only for a proxy or Azure-compatible gateway." />
    </Card>
    <Card title="Models">
      <p className="muted small">Image and speech models on your account show up here after a successful check. New ones start hidden.</p>
      {pending.length > 0 && <div className="set-note">Your key can also use {pending.join(', ')}. Save to add {pending.length > 1 ? 'them' : 'it'} to this list.</div>}
      <ModelList models={list} />
    </Card>
  </>
}

export function SearchPage() {
  const { s, saved, up } = useSettings()
  const brave = s.search.provider === 'brave'
  return <>
    {head('search')}
    <ConnectionCard p="search" />
    <Card title="Provider">
      <div className="opts">
        <button className={!brave ? 'on' : ''} onClick={() => up('search', { provider: 'tavily' })}>Tavily</button>
        <button className={brave ? 'on' : ''} onClick={() => up('search', { provider: 'brave' })}>Brave Search</button>
      </div>
      <KeyField label={`${brave ? 'Brave Search' : 'Tavily'} API key`} value={s.search.apiKey} saved={saved.search.apiKey} onChange={v => up('search', { apiKey: v })}
        placeholder={brave ? 'BSA…' : 'tvly-…'}
        hint={brave ? <>From <a href="https://api.search.brave.com/app/keys" target="_blank" rel="noreferrer">api.search.brave.com</a> ("Data for Search" plan).</> : <>From <a href="https://app.tavily.com" target="_blank" rel="noreferrer">app.tavily.com</a> — the free tier includes 1,000 searches a month.</>} />
    </Card>
  </>
}

// ---------- model manager ----------
const KINDS: Array<[string, string]> = [['all', 'All'], ['image', 'Image'], ['video', 'Video'], ['audio', 'Audio'], ['text', 'Text'], ['tools', 'Tools']]

export function ModelsPage() {
  const { models, isOn, setOn, go } = useSettings()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [provider, setProvider] = useState('all')
  const [usable, setUsable] = useState(false)
  const list = useMemo(() => models.filter(m =>
    (kind === 'all' || section(m) === kind) && (provider === 'all' || m.provider === provider) && (!usable || m.available)
    && (!q || `${m.name} ${m.id}`.toLowerCase().includes(q.toLowerCase()))), [models, kind, provider, usable, q])
  const on = models.filter(isOn).length
  const mock = models.filter(m => m.provider === 'mock')
  const mockOn = mock.some(isOn)
  return <>
    <PageHead icon="layers" title="Model manager" blurb="Choose which models appear in node dropdowns, editing tools, the Agent and MCP. Hidden models keep working on nodes that already use them." />
    <div className="set-summary">
      <div><b>{on}</b> of {models.length} models shown in the canvas</div>
      <span className="spacer" />
      <button className="btn" onClick={() => setOn(mock.map(m => m.id), !mockOn)}>{mockOn ? 'Hide' : 'Show'} offline mock models</button>
      <button className="btn" onClick={() => setOn(models.filter(m => !m.available).map(m => m.id), false)} title="Hide models whose provider isn't set up">Hide unusable</button>
    </div>
    <div className="set-filters">
      <div className="search-box"><Icon name="search" size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search models" /></div>
      <div className="seg">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
      <select value={provider} onChange={e => setProvider(e.target.value)}>
        <option value="all">All providers</option>
        {Object.entries(PROVIDER_OF_MODEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <label className="check"><input type="checkbox" checked={usable} onChange={e => setUsable(e.target.checked)} /> Usable now</label>
    </div>
    <ModelList models={list} groupBy="provider" empty="No models match these filters." />
    <p className="muted small">Missing a model? <button className="link" onClick={() => go('custom')}>Add any fal.ai model</button></p>
  </>
}
