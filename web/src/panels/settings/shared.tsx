import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../../icons'
import type { CheckStatus, ModelInfo, ProviderKey, ProviderStatus, Settings } from '../../types'

export type Page = 'canvas' | 'memory' | ProviderKey | 'models' | 'custom'

export interface SettingsCtx {
  s: Settings
  /** the settings as loaded (masked keys) — for "keep saved key" */
  saved: Settings
  up<K extends keyof Settings>(k: K, patch: Partial<Settings[K]>): void
  setS(next: Settings): void
  status: Partial<Record<ProviderKey, ProviderStatus>>
  checking: Partial<Record<ProviderKey, boolean>>
  check(p: ProviderKey): void
  /** every model, including hidden ones */
  models: ModelInfo[]
  isOn(m: ModelInfo): boolean
  setOn(ids: string[], on: boolean): void
  go(p: Page): void
}
export const Ctx = createContext<SettingsCtx>(null!)
export const useSettings = () => useContext(Ctx)

export const PROVIDER_META: Record<ProviderKey, { name: string; icon: IconName; blurb: string }> = {
  llm: { name: 'Local LLM', icon: 'cpu', blurb: 'Powers the Agent and "Expand" on text nodes. Any OpenAI-compatible server: Ollama, LM Studio, vLLM or OpenAI itself.' },
  comfyui: { name: 'ComfyUI', icon: 'nodes', blurb: 'Run image and video models on your own GPU (FLUX, SDXL, Wan, LTX-Video, HunyuanVideo…) through your ComfyUI workflows.' },
  fal: { name: 'fal.ai', icon: 'cloud', blurb: 'Hosted image, video and audio models — FLUX, Kling, Veo 3, Hailuo, Nano Banana, ElevenLabs and more. Billed per generation by fal.' },
  openai: { name: 'OpenAI', icon: 'sparkle', blurb: 'GPT Image for pictures and edits, plus OpenAI text-to-speech voices. Billed by OpenAI.' },
  search: { name: 'Web search', icon: 'globe', blurb: 'Lets the Agent search the web for the Web Research skill, campaign research and fact checks.' },
}
export const PROVIDER_OF_MODEL: Record<string, string> = { mock: 'Offline (mock)', llm: 'Local LLM', comfyui: 'ComfyUI', fal: 'fal.ai', openai: 'OpenAI' }

const LABEL: Record<CheckStatus, string> = {
  valid: 'Working', invalid: 'Invalid', unreachable: 'Not reachable', warning: 'Needs attention', unverified: 'Not verified', missing: 'Not set up',
}
export const tone = (st?: CheckStatus) =>
  st === 'valid' ? 'ok' : st === 'invalid' ? 'bad' : st === 'warning' || st === 'unverified' || st === 'unreachable' ? 'warn' : 'idle'

export function StatusDot({ p }: { p: ProviderKey }) {
  const { status, checking } = useSettings()
  return <i className={`set-dot ${checking[p] ? 'busy' : tone(status[p]?.status)}`} />
}

export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

/** Result of the last free connection check, with a re-check button. */
export function ConnectionCard({ p }: { p: ProviderKey }) {
  const { status, checking, check } = useSettings()
  const st = status[p]
  const busy = checking[p]
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  return (
    <div className={`set-conn ${busy ? 'busy' : tone(st?.status)}`} aria-live="polite">
      <div className="set-conn-main">
        <div className="set-conn-title">
          <i className={`set-dot ${busy ? 'busy' : tone(st?.status)}`} />
          <b>{busy ? 'Checking…' : st ? LABEL[st.status] : 'Not checked yet'}</b>
          {st && !busy && st.status !== 'missing' && <span className="muted">· checked {ago(st.checkedAt)}</span>}
        </div>
        {st && <p>{st.message}</p>}
        {!!st?.details?.length && <ul>{st.details.map(d => <li key={d}>{d}</li>)}</ul>}
        <small className="muted">Checks are free: they only list models or read your account, never generate.</small>
      </div>
      <button className="btn" onClick={() => check(p)} disabled={busy || st?.status === 'missing'}><Icon name="refresh" size={14} /> {st ? 'Check again' : 'Check now'}</button>
    </div>
  )
}

export const MASK = '••••'

/** API key input: saved keys show as "Saved ••••abcd" with Replace / Remove. */
export function KeyField({ label, value, saved, onChange, hint, placeholder }: {
  label: string; value: string; saved: string; onChange: (v: string) => void; hint?: React.ReactNode; placeholder?: string
}) {
  const [show, setShow] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (focus) { input.current?.focus(); setFocus(false) } }, [focus])
  if (value.startsWith(MASK)) {
    return (
      <div className="field"><span>{label}</span>
        <div className="key-saved">
          <Icon name="key" size={14} /> Saved key <code>{value}</code>
          <span className="spacer" />
          <button className="link" onClick={() => { onChange(''); setFocus(true) }}>Replace</button>
          <button className="link danger" onClick={() => onChange('')}>Remove</button>
        </div>
        {hint && <small>{hint}</small>}
      </div>
    )
  }
  return (
    <label className="field"><span>{label}</span>
      <div className="key-input">
        <input ref={input} type={show ? 'text' : 'password'} value={value} placeholder={placeholder ?? 'Paste your API key'} onChange={e => onChange(e.target.value.trim())} autoComplete="off" spellCheck={false} />
        <button className="link" onClick={e => { e.preventDefault(); setShow(!show) }}>{show ? 'Hide' : 'Show'}</button>
        {saved.startsWith(MASK) && <button className="link" onClick={e => { e.preventDefault(); onChange(saved) }}>Keep saved key</button>}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Field({ label, value, onChange, placeholder, hint, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: React.ReactNode; list?: string }) {
  return (
    <label className="field"><span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} autoComplete="off" spellCheck={false} list={list} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
}

export function PageHead({ icon, title, blurb }: { icon: IconName; title: string; blurb: string }) {
  return (
    <header className="set-head">
      <div className="set-icon"><Icon name={icon} size={18} /></div>
      <div><h3>{title}</h3><p className="muted">{blurb}</p></div>
    </header>
  )
}

export function Card({ title, aside, children }: { title?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="set-card">
      {(title || aside) && <div className="set-card-head">{title && <h4>{title}</h4>}<span className="spacer" />{aside}</div>}
      {children}
    </section>
  )
}
