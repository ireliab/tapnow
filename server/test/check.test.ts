import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkProvider, checkWorkflow, formatPrice } from '../src/providers/check'
import { catalog, findModel } from '../src/providers/index'
import { getSettings, maskedSettings, saveSettings } from '../src/store'

type Route = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined
function stubFetch(route: Route) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const r = route(url, init)
    if (!r) throw new TypeError('fetch failed')
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
  })
  return calls
}
afterEach(() => vi.unstubAllGlobals())

const base = () => getSettings()

describe('provider checks', () => {
  it('reports a missing key without any request', async () => {
    const calls = stubFetch(() => ({ status: 200 }))
    const r = await checkProvider('fal', { fal: { apiKey: '' } })
    expect(r.status).toBe('missing')
    expect(calls).toHaveLength(0)
  })

  it('fal: invalid key → invalid', async () => {
    stubFetch(u => (u.includes('/pricing') ? { status: 401, body: { error: { message: 'Invalid API key' } } } : undefined))
    expect((await checkProvider('fal', { fal: { apiKey: 'bad:key' } })).status).toBe('invalid')
  })

  it('fal: valid key loads prices and isolates unknown ids by splitting the batch', async () => {
    const custom = [{ id: 'fal-ai/does-not-exist', name: 'Nope', provider: 'fal' as const, kind: 'image' as const }]
    const calls = stubFetch(u => {
      if (!u.includes('/pricing')) return undefined
      const ids = decodeURIComponent(u.split('endpoint_id=')[1]).split(',')
      if (ids.includes('fal-ai/does-not-exist')) return { status: 404, body: { error: { type: 'not_found' } } }
      return { status: 200, body: { prices: ids.map(id => ({ endpoint_id: id, unit_price: 0.025, unit: 'images', currency: 'USD' })) } }
    })
    const r = await checkProvider('fal', { fal: { apiKey: 'good:key' }, customModels: custom })
    expect(r.status).toBe('warning')
    expect(r.notFound).toEqual(['fal-ai/does-not-exist'])
    expect(r.prices?.['fal-ai/flux/dev']).toBe('$0.025 / image')
    expect(calls.every(c => c.headers.Authorization === 'Key good:key')).toBe(true)
    // never touches a generation endpoint
    expect(calls.some(c => /queue\.fal\.run|\/\/fal\.run\//.test(c.url))).toBe(false)
  })

  it('openai: lists only image and speech models', async () => {
    stubFetch(u => (u.endsWith('/models') ? { status: 200, body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'tts-1-hd' }, { id: 'gpt-4o-mini-tts' }] } } : undefined))
    const r = await checkProvider('openai', { openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' } })
    expect(r.status).toBe('valid')
    expect(r.models).toEqual(['dall-e-3', 'gpt-4o-mini-tts', 'gpt-image-1', 'tts-1-hd'])
  })

  it('llm: unreachable and model-missing warnings', async () => {
    stubFetch(() => undefined)
    expect((await checkProvider('llm', { llm: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'x' } })).status).toBe('unreachable')
    stubFetch(() => ({ status: 200, body: { data: [{ id: 'qwen2.5' }] } }))
    const r = await checkProvider('llm', { llm: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.1' } })
    expect(r.status).toBe('warning')
    expect(r.models).toEqual(['qwen2.5'])
  })

  it('search: tavily usage and brave token check', async () => {
    stubFetch(u => (u.includes('tavily') ? { status: 200, body: { key: { usage: 12, limit: 1000 } } } : undefined))
    const t = await checkProvider('search', { search: { provider: 'tavily', apiKey: 'tvly-x' } })
    expect(t).toMatchObject({ status: 'valid', message: 'Key valid · 12 / 1000 credits used' })
    stubFetch(() => ({ status: 422, body: { error: { code: 'SUBSCRIPTION_TOKEN_INVALID' } } }))
    expect((await checkProvider('search', { search: { provider: 'brave', apiKey: 'bad' } })).status).toBe('invalid')
  })

  it('masked keys fall back to the stored key', async () => {
    saveSettings({ ...base(), fal: { apiKey: 'stored:secret' } })
    const calls = stubFetch(() => ({ status: 200, body: { prices: [] } }))
    await checkProvider('fal', { fal: { apiKey: maskedSettings().fal.apiKey } })
    expect(calls[0].headers.Authorization).toBe('Key stored:secret')
    // the check matched the saved config, so it was stored
    expect(getSettings().providerStatus.fal?.status).toBe('valid')
  })
})

describe('comfy workflow checks', () => {
  it('flags bad JSON, UI-format exports, missing prompt and missing nodes', () => {
    expect(checkWorkflow('Image', '{')).toEqual(['Image workflow is not valid JSON'])
    expect(checkWorkflow('Image', '{"nodes":[],"links":[]}')[0]).toMatch(/API format/)
    const wf = JSON.stringify({ 1: { class_type: 'KSampler', inputs: {} }, 2: { class_type: 'MyCustomNode', inputs: { text: '{{prompt}}' } } })
    expect(checkWorkflow('Video', wf, new Set(['KSampler']))).toEqual(["Video workflow uses nodes this ComfyUI doesn't have: MyCustomNode"])
  })
})

describe('model enable / disable', () => {
  it('hides disabled models from the default catalog but still finds them', async () => {
    saveSettings({ ...base(), modelPrefs: { 'mock-music': false } })
    expect((await catalog()).some(m => m.id === 'mock-music')).toBe(false)
    expect((await catalog({ all: true })).find(m => m.id === 'mock-music')?.enabled).toBe(false)
    expect(await findModel('mock-music')).toBeTruthy()
  })

  it('formats prices', () => {
    expect(formatPrice({ unit_price: 0.4, unit: 'seconds', currency: 'USD' })).toBe('$0.4 / second')
    expect(formatPrice({ unit_price: 0.1, unit: '1000 characters', currency: 'USD' })).toBe('$0.1 / 1000 characters')
  })
})

describe('unreachable messages', () => {
  it('names the cause and hints at Tailscale / remote binding', async () => {
    const { netError } = await import('../src/providers/check')
    const fail = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
    const ts = netError(fail('EACCES'), 'http://100.85.223.121:8100/v1')
    expect(ts.message).toMatch(/blocked by this PC/)
    expect(ts.details?.[0]).toMatch(/Tailscale/)
    const remote = netError(Object.assign(new TypeError('fetch failed'), { cause: { errors: [{ code: 'ECONNREFUSED' }] } }), 'http://192.168.1.5:8000/v1')
    expect(remote.message).toMatch(/connection refused/)
    expect(remote.details?.[0]).toMatch(/0\.0\.0\.0/)
  })
})
