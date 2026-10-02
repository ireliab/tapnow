import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { agentApi } from '../agent/agentApi'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { ModelInfo, ProviderKey, ProviderStatus, Settings } from '../types'
import { Modal } from './Chrome'
import { CustomModelsPage } from './settings/CustomModels'
import { CanvasPage, ComfyPage, FalPage, LlmPage, MemoryPage, ModelsPage, OpenAiPage, SearchPage } from './settings/pages'
import { Ctx, PROVIDER_META, StatusDot, type Page, type SettingsCtx } from './settings/shared'
import './settings/settings.css'

const PROVIDERS: ProviderKey[] = ['llm', 'comfyui', 'fal', 'openai', 'search']
const LOCAL = new Set<ProviderKey>(['llm', 'comfyui'])
/** the part of the form each provider check depends on */
const slice = (p: ProviderKey, s: Settings) => JSON.stringify(p === 'fal' ? [s.fal, s.customModels.map(m => m.id)] : s[p])
const configured = (p: ProviderKey, s: Settings) =>
  p === 'llm' ? !!s.llm.baseUrl.trim() : p === 'comfyui' ? !!s.comfyui.url.trim() : !!(p === 'search' ? s.search : s[p]).apiKey
const STALE = 12 * 3600_000
const missing = (p: ProviderKey): ProviderStatus => ({ status: 'missing', message: LOCAL.has(p) ? 'Add the server URL' : 'No API key yet — add one below', checkedAt: Date.now() })

export function SettingsModal() {
  const open = useStore(st => st.settingsOpen)
  return open ? <SettingsDialog /> : null
}

function SettingsDialog() {
  const { set, loadModels, notify } = useStore.getState()
  const models = useStore(st => st.models)
  const [page, setPage] = useState<Page>(() => (sessionStorage.getItem('taplocal:settings-page') as Page) || 'fal')
  const [s, setForm] = useState<Settings>()
  const [saved, setSaved] = useState<Settings>()
  const [memory, setMemory] = useState('')
  const [savedMemory, setSavedMemory] = useState('')
  const [status, setStatus] = useState<Partial<Record<ProviderKey, ProviderStatus>>>({})
  const [checking, setChecking] = useState<Partial<Record<ProviderKey, boolean>>>({})
  const [busy, setBusy] = useState(false)
  const form = useRef<Settings>()
  form.current = s
  const lastSlice = useRef<Partial<Record<ProviderKey, string>>>({})
  const seq = useRef<Partial<Record<ProviderKey, number>>>({})

  const check = useCallback((p: ProviderKey) => {
    const cur = form.current
    if (!cur) return
    lastSlice.current[p] = slice(p, cur)
    const n = (seq.current[p] ?? 0) + 1
    seq.current[p] = n
    setChecking(c => ({ ...c, [p]: true }))
    api.checkProvider(p, cur)
      .then(r => {
        if (seq.current[p] !== n) return // a newer check is running
        setStatus(st => ({ ...st, [p]: r }))
        if (p === 'fal' || p === 'openai') loadModels() // prices / discovered models when the check matched the saved key
      })
      .catch(e => seq.current[p] === n && setStatus(st => ({ ...st, [p]: { status: 'unreachable', message: `Check failed: ${e.message}`, checkedAt: Date.now() } })))
      .finally(() => seq.current[p] === n && setChecking(c => ({ ...c, [p]: false })))
  }, [loadModels])

  useEffect(() => {
    Promise.all([api.settings(), agentApi.memory().catch(() => [] as string[])]).then(([v, mem]) => {
      setForm(v); setSaved(v); form.current = v
      setStatus(Object.fromEntries(PROVIDERS.map(p => [p, configured(p, v) ? v.providerStatus?.[p] : missing(p)])))
      setMemory(mem.join('\n')); setSavedMemory(mem.join('\n'))
      for (const p of PROVIDERS) {
        lastSlice.current[p] = slice(p, v)
        const st = v.providerStatus?.[p]
        // local servers come and go, so always re-check them; cloud keys at most twice a day
        if (configured(p, v) && (!st || LOCAL.has(p) || Date.now() - st.checkedAt > STALE)) check(p)
      }
    })
    loadModels()
  }, [check, loadModels])

  // re-check a provider shortly after its URL / key / model changes
  const sig = s ? PROVIDERS.map(p => slice(p, s)).join('\u0000') : ''
  useEffect(() => {
    if (!s) return
    const changed = PROVIDERS.filter(p => slice(p, s) !== lastSlice.current[p])
    if (!changed.length) return
    const t = setTimeout(() => changed.forEach(p => {
      if (configured(p, s)) check(p)
      else { lastSlice.current[p] = slice(p, s); seq.current[p] = (seq.current[p] ?? 0) + 1; setChecking(c => ({ ...c, [p]: false })); setStatus(st => ({ ...st, [p]: missing(p) })) }
    }), 900)
    return () => clearTimeout(t)
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: Page) => { setPage(p); try { sessionStorage.setItem('taplocal:settings-page', p) } catch { /* ignore */ } }
  const isOn = useCallback((m: ModelInfo) => s?.modelPrefs[m.id] ?? m.enabled ?? !m.discovered, [s])
  const ctx = useMemo<SettingsCtx | undefined>(() => s && saved && {
    s, saved, status, checking, check, models, isOn, go,
    setS: setForm,
    up: (k, patch) => setForm(f => f && { ...f, [k]: { ...(f[k] as object), ...patch } }),
    setOn: (ids, on) => setForm(f => f && { ...f, modelPrefs: { ...f.modelPrefs, ...Object.fromEntries(ids.map(id => [id, on])) } }),
  }, [s, saved, status, checking, check, models, isOn])

  const dirty = !!s && !!saved && (JSON.stringify({ ...s, providerStatus: 0 }) !== JSON.stringify({ ...saved, providerStatus: 0 }) || memory !== savedMemory)
  const close = () => { if (!dirty || confirm('Discard your unsaved settings changes?')) set({ settingsOpen: false }) }

  const save = async () => {
    if (!s) return
    for (const [label, w] of [['image', s.comfyui.imageWorkflow], ['video', s.comfyui.videoWorkflow]]) {
      if (!w.trim()) continue
      // numeric placeholders are quoted, so the template itself must parse
      try { JSON.parse(w) } catch { go('comfyui'); return notify(`The ComfyUI ${label} workflow is not valid JSON`, 'error') }
    }
    setBusy(true)
    try {
      // check results made with these exact values travel with the save, so badges and prices stick
      await api.saveSettings({ ...s, providerStatus: Object.fromEntries(Object.entries(status).filter(([p, st]) => st?.fp && !checking[p as ProviderKey])) })
      if (memory !== savedMemory) await agentApi.saveMemory(memory.split('\n'))
      await loadModels()
      notify('Settings saved')
      set({ settingsOpen: false })
    } catch (e) { notify(`Couldn't save settings: ${(e as Error).message}`, 'error') } finally { setBusy(false) }
  }

  if (!s || !ctx) return <Modal title="Settings" onClose={close} className="settings-modal"><p className="muted pad">Loading…</p></Modal>

  const shown = models.filter(isOn).length
  const nav = (p: Page, icon: string, label: string, extra?: React.ReactNode) => (
    <button key={p} className={page === p ? 'on' : ''} onClick={() => go(p)} aria-current={page === p ? 'page' : undefined}>
      <Icon name={icon} size={15} /><span>{label}</span>{extra}
    </button>
  )
  return (
    <Modal title="Settings" onClose={close} className="settings-modal">
      <Ctx.Provider value={ctx}>
        <div className="set">
          <nav className="set-nav">
            <div className="set-group">General</div>
            {nav('canvas', 'grid', 'Canvas')}
            {nav('memory', 'brain', 'Agent memory')}
            <div className="set-group">Providers</div>
            {PROVIDERS.map(p => nav(p, PROVIDER_META[p].icon, PROVIDER_META[p].name, <StatusDot p={p} />))}
            <div className="set-group">Models</div>
            {nav('models', 'layers', 'Model manager', <span className="set-count">{shown}/{models.length}</span>)}
            {nav('custom', 'plus', 'Custom fal models', s.customModels.length ? <span className="set-count">{s.customModels.length}</span> : undefined)}
          </nav>
          <div className="set-main">
            <div className="set-page" key={page}>
              {page === 'canvas' && <CanvasPage />}
              {page === 'memory' && <MemoryPage memory={memory} setMemory={setMemory} />}
              {page === 'llm' && <LlmPage />}
              {page === 'comfyui' && <ComfyPage />}
              {page === 'fal' && <FalPage />}
              {page === 'openai' && <OpenAiPage />}
              {page === 'search' && <SearchPage />}
              {page === 'models' && <ModelsPage />}
              {page === 'custom' && <CustomModelsPage />}
            </div>
            <div className="set-foot">
              {dirty ? <span className="set-dirty"><i /> Unsaved changes</span> : <span className="muted small">Keys are stored only in <code>data/settings.json</code> on this machine.</span>}
              <span className="spacer" />
              <button className="btn" onClick={close}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      </Ctx.Provider>
    </Modal>
  )
}
