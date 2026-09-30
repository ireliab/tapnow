import { useEffect, useState } from 'react'
import { api } from '../api'
import { agentApi } from '../agent/agentApi'
import { useStore, type CanvasSettings } from '../store'
import type { Settings } from '../types'
import { Modal } from './Chrome'

const COMFY_HELP = `Paste a workflow exported from ComfyUI with "Save (API format)". Use placeholders inside it:
"{{prompt}}", "{{negative}}", "{{image}}", "{{last_image}}" (text/image-name fields) and
"{{seed}}", "{{width}}", "{{height}}", "{{frames}}", "{{duration}}" (numeric fields — keep the quotes).`

export function SettingsModal() {
  const open = useStore(s => s.settingsOpen)
  const { set, loadModels, notify } = useStore.getState()
  const [s, setS] = useState<Settings>()
  const [tab, setTab] = useState<'canvas' | 'llm' | 'comfy' | 'cloud' | 'search' | 'memory' | 'custom'>('canvas')
  const canvas = useStore(st => st.canvasSettings)
  const [memory, setMemory] = useState('')
  const [customText, setCustomText] = useState('')
  useEffect(() => {
    if (open) {
      api.settings().then(v => { setS(v); setCustomText(JSON.stringify(v.customModels, null, 2)) })
      agentApi.memory().then(m => setMemory(m.join('\n'))).catch(() => {})
    }
  }, [open])
  if (!open || !s) return null

  const setCanvas = (patch: Partial<CanvasSettings>) => {
    const next = { ...useStore.getState().canvasSettings, ...patch }
    useStore.setState({ canvasSettings: next })
    try { localStorage.setItem('taplocal:canvas', JSON.stringify(next)) } catch { /* private mode */ }
  }
  const up = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => setS({ ...s, [k]: { ...(s[k] as object), ...patch } })
  const save = async () => {
    let customModels = s.customModels
    try { customModels = JSON.parse(customText || '[]') } catch { return notify('Custom models is not valid JSON', 'error') }
    for (const w of [s.comfyui.imageWorkflow, s.comfyui.videoWorkflow]) {
      if (!w.trim()) continue
      // numeric placeholders are quoted, so the template itself must parse
      try { JSON.parse(w) } catch { return notify('A ComfyUI workflow is not valid JSON', 'error') }
    }
    await api.saveSettings({ ...s, customModels })
    await agentApi.saveMemory(memory.split('\n'))
    await loadModels()
    notify('Settings saved')
    set({ settingsOpen: false })
  }
  const field = (label: string, value: string, onChange: (v: string) => void, opts: { type?: string; placeholder?: string; hint?: string } = {}) => (
    <label className="field"><span>{label}</span>
      <input type={opts.type ?? 'text'} value={value} placeholder={opts.placeholder} onChange={e => onChange(e.target.value)} autoComplete="off" />
      {opts.hint && <small>{opts.hint}</small>}
    </label>
  )

  return (
    <Modal title="Settings" onClose={() => set({ settingsOpen: false })} wide>
      <div className="tabs">
        {([['canvas', 'Canvas'], ['llm', 'Local LLM'], ['comfy', 'ComfyUI'], ['cloud', 'Cloud APIs'], ['search', 'Web search'], ['memory', 'Agent memory'], ['custom', 'Custom models']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 'canvas' && <>
          <p className="muted">How the canvas behaves. Saved in this browser.</p>
          <div className="field"><span>When a run makes several results (×2–×4)</span>
            <div className="opts">
              {([['history', 'Keep them in the node history'], ['spread', 'Spread as new nodes'], ['stack', 'Pile them into a stack']] as const).map(([k, l]) => (
                <button key={k} className={canvas.resultMode === k ? 'on' : ''} onClick={() => setCanvas({ resultMode: k })}>{l}</button>
              ))}
            </div></div>
          <label className="check"><input type="checkbox" checked={canvas.snapToGrid} onChange={e => setCanvas({ snapToGrid: e.target.checked })} /> Snap nodes to grid</label>
        </>}
        {tab === 'llm' && <>
          <p className="muted">Powers the Agent and the "Expand" button on text nodes. Any OpenAI-compatible server works: Ollama (<code>http://localhost:11434/v1</code>), LM Studio (<code>http://localhost:1234/v1</code>), or OpenAI.</p>
          {field('Base URL', s.llm.baseUrl, v => up('llm', { baseUrl: v }))}
          {field('Model', s.llm.model, v => up('llm', { model: v }), { placeholder: 'llama3.1, qwen2.5, gpt-4o-mini…' })}
          {field('API key (optional for local)', s.llm.apiKey, v => up('llm', { apiKey: v }), { type: 'password' })}
        </>}
        {tab === 'comfy' && <>
          <p className="muted">Run image/video models on your own GPU (FLUX, SDXL, Wan, LTX-Video, HunyuanVideo…) through ComfyUI.</p>
          {field('ComfyUI URL', s.comfyui.url, v => up('comfyui', { url: v }))}
          <pre className="hint">{COMFY_HELP}</pre>
          <label className="field"><span>Image workflow (API JSON)</span>
            <textarea rows={6} value={s.comfyui.imageWorkflow} onChange={e => up('comfyui', { imageWorkflow: e.target.value })} spellCheck={false} /></label>
          <label className="field"><span>Video workflow (API JSON)</span>
            <textarea rows={6} value={s.comfyui.videoWorkflow} onChange={e => up('comfyui', { videoWorkflow: e.target.value })} spellCheck={false} /></label>
        </>}
        {tab === 'cloud' && <>
          <p className="muted">Optional hosted models. Keys are stored only in <code>data/settings.json</code> on this machine.</p>
          {field('fal.ai API key', s.fal.apiKey, v => up('fal', { apiKey: v }), { type: 'password', hint: 'Enables FLUX, Kling, Veo 3, Hailuo, Nano Banana…' })}
          {field('OpenAI API key', s.openai.apiKey, v => up('openai', { apiKey: v }), { type: 'password', hint: 'Enables GPT Image and TTS' })}
          {field('OpenAI base URL', s.openai.baseUrl, v => up('openai', { baseUrl: v }))}
        </>}
        {tab === 'search' && <>
          <p className="muted">Lets the Agent search the web (Web Research skill, campaign research, fact checks).</p>
          <label className="field"><span>Provider</span>
            <select value={s.search.provider} onChange={e => up('search', { provider: e.target.value as 'tavily' | 'brave' })}>
              <option value="tavily">Tavily</option><option value="brave">Brave Search</option>
            </select></label>
          {field('API key', s.search.apiKey, v => up('search', { apiKey: v }), { type: 'password', hint: s.search.provider === 'brave' ? 'api.search.brave.com — "Data for Search" plan' : 'app.tavily.com' })}
        </>}
        {tab === 'memory' && <>
          <p className="muted">Preferences the Agent always follows. It adds to this list when you say "remember …". One per line.</p>
          <textarea className="code" rows={10} value={memory} onChange={e => setMemory(e.target.value)} placeholder={'Default aspect ratio 9:16\nAlways ask before generating video'} />
        </>}
        {tab === 'custom' && <>
          <p className="muted">Add any fal.ai model by its id. Example:</p>
          <pre className="hint">{`[{ "id": "fal-ai/wan/v2.2-a14b/image-to-video", "name": "Wan 2.2 I2V", "provider": "fal", "kind": "video", "imageField": "image_url" }]`}</pre>
          <textarea className="code" rows={10} value={customText} onChange={e => setCustomText(e.target.value)} spellCheck={false} />
        </>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => set({ settingsOpen: false })}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  )
}
