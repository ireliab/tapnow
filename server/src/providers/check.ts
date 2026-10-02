import crypto from 'node:crypto'
import { getSettings, setProviderStatus, unmask, type ProviderStatus, type Settings } from '../store.js'
import { BUILTIN } from './index.js'

/**
 * Free connection checks for each provider. None of these generate anything or spend
 * tokens/credits: they only hit listing, pricing, usage and status endpoints.
 */
export const PROVIDERS = ['llm', 'comfyui', 'fal', 'openai', 'search'] as const
export type ProviderKey = typeof PROVIDERS[number]

const TIMEOUT = 6000
const trim = (u: string) => u.replace(/\/$/, '')

/** Identifies the config a status was produced for, so stale badges can be spotted. */
export function fingerprint(p: ProviderKey, s: Settings) {
  const parts = {
    llm: [s.llm.baseUrl, s.llm.apiKey, s.llm.model],
    openai: [s.openai.baseUrl, s.openai.apiKey],
    fal: [s.fal.apiKey, s.customModels.map(m => m.id).join(',')],
    comfyui: [s.comfyui.url, s.comfyui.imageWorkflow, s.comfyui.videoWorkflow],
    search: [s.search.provider, s.search.apiKey],
  }[p]
  return crypto.createHash('sha256').update(parts.join('\n')).digest('base64url').slice(0, 12)
}

type Result = Omit<ProviderStatus, 'checkedAt' | 'fp'>

async function get(url: string, headers: Record<string, string> = {}, timeout = TIMEOUT) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, ok: res.ok, json, text }
}
/** Turn a fetch failure into something actionable (refused vs. timed out vs. unknown host). */
export function netError(e: unknown, where: string): Result {
  const err = e as Error & { cause?: { code?: string; errors?: Array<{ code?: string }> } }
  // undici wraps the socket error; dual-stack attempts nest it once more
  const code = err?.cause?.code ?? err?.cause?.errors?.find(x => x.code)?.code ?? ''
  const host = (() => { try { return new URL(where).hostname } catch { return '' } })()
  // 100.64.0.0/10 is Tailscale's range
  const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  const details = [
    ...(tailscale ? ['This is a Tailscale address — make sure Tailscale is connected on this PC (another VPN, e.g. Surfshark, can block it)'] : []),
    ...(code === 'ECONNREFUSED' && /^(localhost|127\.|\[?::1)/.test(host) ? ['Nothing is listening there — is the server running?'] : []),
    ...(code === 'ECONNREFUSED' && host && !/^(localhost|127\.)/.test(host) ? ['If the server runs on another machine, start it listening on all interfaces (vLLM / LM Studio: --host 0.0.0.0) and allow the port through its firewall'] : []),
  ]
  const why = err?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' ? 'timed out'
    : code === 'ECONNREFUSED' ? 'connection refused'
    : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'unknown host'
    : code === 'EHOSTUNREACH' || code === 'ENETUNREACH' ? 'network unreachable'
    : code === 'EACCES' || code === 'EPERM' ? 'blocked by this PC — a VPN or firewall is stopping the connection'
    : code || 'no connection'
  return { status: 'unreachable', message: `Can't reach ${where} (${why})`, ...(details.length ? { details } : {}) }
}

// ---------- local LLM ----------
async function checkLlm(s: Settings): Promise<Result> {
  const { baseUrl, apiKey, model } = s.llm
  if (!baseUrl.trim()) return { status: 'missing', message: 'Add the server URL' }
  try {
    const r = await get(`${trim(baseUrl)}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, 3000)
    if (r.status === 401 || r.status === 403) return { status: 'invalid', message: 'The server rejected the API key' }
    if (!r.ok) return { status: 'invalid', message: `The server answered ${r.status} — is this an OpenAI-compatible /v1 URL?` }
    const models: string[] = (r.json?.data ?? []).map((m: any) => String(m.id)).filter(Boolean).sort()
    if (!models.length) return { status: 'warning', message: 'Connected, but the server has no models installed', models }
    if (!models.includes(model)) return { status: 'warning', message: `Connected, but "${model}" isn't installed — pick one of the ${models.length} available`, models }
    return { status: 'valid', message: `Connected · ${models.length} model${models.length === 1 ? '' : 's'} available`, models }
  } catch (e) { return netError(e, baseUrl) }
}

// ---------- OpenAI ----------
export const isOpenAiImage = (id: string) => /^(gpt-image|dall-e)/.test(id)
export const isOpenAiSpeech = (id: string) => /^tts-|-tts(-|$)/.test(id)
async function checkOpenAi(s: Settings): Promise<Result> {
  const { baseUrl, apiKey } = s.openai
  if (!apiKey) return { status: 'missing', message: 'No API key yet' }
  try {
    const r = await get(`${trim(baseUrl)}/models`, { Authorization: `Bearer ${apiKey}` })
    if (r.status === 401) return { status: 'invalid', message: 'Invalid API key' }
    if (r.status === 403) return { status: 'invalid', message: r.json?.error?.message ?? 'This key is not allowed to list models' }
    if (!r.ok) return { status: 'invalid', message: `OpenAI answered ${r.status}` }
    const models: string[] = (r.json?.data ?? []).map((m: any) => String(m.id)).filter((id: string) => isOpenAiImage(id) || isOpenAiSpeech(id)).sort()
    const n = (r.json?.data ?? []).length
    return { status: 'valid', message: `Key valid · ${n} models on this account, ${models.length} usable here`, models }
  } catch (e) { return netError(e, 'OpenAI') }
}

// ---------- fal.ai ----------
const unitLabel = (u: string) => (/^\d/.test(u) ? u : u.replace(/s$/, ''))
export const formatPrice = (p: { unit_price: number; unit: string; currency?: string }) =>
  `${p.currency && p.currency !== 'USD' ? p.currency + ' ' : '$'}${+p.unit_price.toPrecision(3)} / ${unitLabel(p.unit)}`

/** fal endpoint ids used by built-in and custom models. */
export const falApps = (s: Settings) => [...new Set([
  ...BUILTIN.filter(m => m.provider === 'fal').map(m => String(m.extra?.app)),
  ...s.customModels.map(m => m.id),
])]

async function checkFal(s: Settings): Promise<Result> {
  const key = s.fal.apiKey
  if (!key) return { status: 'missing', message: 'No API key yet' }
  const prices: Record<string, string> = {}
  const notFound: string[] = []
  let rateLimited = false
  // the pricing endpoint needs a valid key and is free; one unknown id 404s the whole batch, so split until it's isolated
  const batch = async (ids: string[]): Promise<'invalid' | void> => {
    if (rateLimited || !ids.length) return
    const r = await get(`https://api.fal.ai/v1/models/pricing?endpoint_id=${ids.map(encodeURIComponent).join(',')}`, { Authorization: `Key ${key}` })
    if (r.status === 401 || r.status === 403) return 'invalid'
    if (r.status === 429) { rateLimited = true; return }
    if (r.status === 404) {
      if (ids.length === 1) { notFound.push(ids[0]); return }
      const half = Math.ceil(ids.length / 2)
      if (await batch(ids.slice(0, half)) === 'invalid') return 'invalid'
      return batch(ids.slice(half))
    }
    if (!r.ok) throw new Error(`fal answered ${r.status}`)
    for (const p of r.json?.prices ?? []) prices[p.endpoint_id] = formatPrice(p)
  }
  try {
    const apps = falApps(s)
    for (let i = 0; i < apps.length; i += 40) {
      if (await batch(apps.slice(i, i + 40)) === 'invalid') return { status: 'invalid', message: 'Invalid API key' }
    }
    if (rateLimited && !Object.keys(prices).length) return { status: 'unverified', message: 'fal is rate-limiting checks — try again in a minute' }
    const details = rateLimited ? ['Some prices are missing because fal rate-limited the check'] : undefined
    if (notFound.length) return { status: 'warning', message: `Key valid · ${notFound.length} model${notFound.length === 1 ? '' : 's'} not found on fal`, prices, notFound, details }
    return { status: 'valid', message: `Key valid · prices loaded for ${Object.keys(prices).length} models`, prices, notFound, details }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('fal answered')) return { status: 'warning', message: e.message }
    return netError(e, 'fal.ai')
  }
}

/** Search fal's public model gallery (free, no key needed) — used to add custom models. */
export async function searchFal(q: string, category?: string) {
  const params = new URLSearchParams({ limit: '30', status: 'active' })
  if (q) params.set('q', q)
  if (category) params.set('category', category)
  const key = getSettings().fal.apiKey
  const r = await get(`https://api.fal.ai/v1/models?${params}`, key ? { Authorization: `Key ${key}` } : {})
  if (!r.ok) throw new Error(r.status === 429 ? 'fal is rate-limiting searches — try again in a minute' : `fal search failed (${r.status})`)
  return (r.json?.models ?? []).map((m: any) => ({
    id: String(m.endpoint_id), name: String(m.metadata?.display_name ?? m.endpoint_id),
    category: String(m.metadata?.category ?? ''), description: String(m.metadata?.description ?? '').slice(0, 200),
    thumb: m.metadata?.thumbnail_url as string | undefined,
  }))
}

// ---------- ComfyUI ----------
export function checkWorkflow(label: string, wf: string, nodeTypes?: Set<string>): string[] {
  if (!wf.trim()) return []
  let json: any
  try { json = JSON.parse(wf) } catch { return [`${label} workflow is not valid JSON`] }
  const nodes = Object.values(json ?? {}) as any[]
  if (!nodes.length || !nodes.every(n => n && typeof n.class_type === 'string')) {
    return [`${label} workflow isn't in API format — in ComfyUI use "Save (API format)"`]
  }
  const out: string[] = []
  if (!wf.includes('{{prompt}}')) out.push(`${label} workflow has no "{{prompt}}" placeholder, so prompts are ignored`)
  if (nodeTypes) {
    const missing = [...new Set(nodes.map(n => n.class_type).filter(t => !nodeTypes.has(t)))]
    if (missing.length) out.push(`${label} workflow uses nodes this ComfyUI doesn't have: ${missing.join(', ')}`)
  }
  return out
}
async function checkComfy(s: Settings): Promise<Result> {
  const { url, imageWorkflow, videoWorkflow } = s.comfyui
  if (!url.trim()) return { status: 'missing', message: 'Add the ComfyUI URL' }
  const base = trim(url)
  let stats: any
  try {
    const r = await get(`${base}/system_stats`, {}, 3000)
    if (!r.ok || !r.json?.system) return { status: 'invalid', message: `${url} answered ${r.status}, but it doesn't look like ComfyUI` }
    stats = r.json
  } catch (e) { return netError(e, url) }
  let nodeTypes: Set<string> | undefined
  try {
    const r = await get(`${base}/object_info`, {}, 15000)
    if (r.ok && r.json) nodeTypes = new Set(Object.keys(r.json))
  } catch { /* node list is optional */ }
  const gpu = stats.devices?.[0]
  const info = [
    `ComfyUI ${stats.system.comfyui_version ?? ''}`.trim(),
    gpu ? `${String(gpu.name).replace(/^cuda:\d+\s*/, '').split(' : ')[0]}${gpu.vram_total ? ` · ${Math.round(gpu.vram_total / 2 ** 30)} GB VRAM` : ''}` : '',
  ].filter(Boolean).join(' · ')
  const details = [...checkWorkflow('Image', imageWorkflow, nodeTypes), ...checkWorkflow('Video', videoWorkflow, nodeTypes)]
  if (!imageWorkflow.trim() && !videoWorkflow.trim()) return { status: 'warning', message: `Connected · ${info} — paste a workflow to enable it`, details }
  if (details.length) return { status: 'warning', message: `Connected · ${info}`, details }
  return { status: 'valid', message: `Connected · ${info}`, details }
}

// ---------- web search ----------
async function checkSearch(s: Settings): Promise<Result> {
  const { provider, apiKey } = s.search
  if (!apiKey) return { status: 'missing', message: 'No API key yet' }
  try {
    if (provider === 'tavily') {
      const r = await get('https://api.tavily.com/usage', { Authorization: `Bearer ${apiKey}` })
      if (r.status === 401 || r.status === 403) return { status: 'invalid', message: 'Invalid Tavily key' }
      if (!r.ok) return { status: 'warning', message: `Tavily answered ${r.status}` }
      const k = r.json?.key ?? {}
      const a = r.json?.account ?? {}
      const used = k.usage ?? a.plan_usage
      const limit = k.limit ?? a.plan_limit
      return { status: 'valid', message: `Key valid${used !== undefined ? ` · ${used}${limit ? ` / ${limit}` : ''} credits used` : ''}${a.current_plan ? ` · ${a.current_plan} plan` : ''}` }
    }
    // Brave checks the token before the query, so a request without `q` is rejected either way and never counted
    const r = await get('https://api.search.brave.com/res/v1/web/search', { 'X-Subscription-Token': apiKey, Accept: 'application/json' })
    const code = r.json?.error?.code
    if (r.status === 401 || code === 'SUBSCRIPTION_TOKEN_INVALID') return { status: 'invalid', message: 'Invalid Brave Search key' }
    if (r.status === 429 || code === 'RATE_LIMITED') return { status: 'unverified', message: 'Brave is rate-limiting — try again shortly' }
    return { status: 'valid', message: 'Key accepted by Brave Search' }
  } catch (e) { return netError(e, provider === 'tavily' ? 'Tavily' : 'Brave Search') }
}

const CHECKS: Record<ProviderKey, (s: Settings) => Promise<Result>> = {
  llm: checkLlm, openai: checkOpenAi, fal: checkFal, comfyui: checkComfy, search: checkSearch,
}

/**
 * Check a provider with (possibly unsaved) form values. The result is stored only when it
 * describes the saved config; otherwise the client sends it back with Save.
 */
export async function checkProvider(p: ProviderKey, form: Partial<Settings> = {}): Promise<ProviderStatus> {
  const s = unmask(form)
  const result: ProviderStatus = { ...(await CHECKS[p](s)), checkedAt: Date.now(), fp: fingerprint(p, s) }
  if (result.fp === fingerprint(p, getSettings())) setProviderStatus(p, result)
  return result
}
