import { getSettings, type ProviderStatus, type Settings } from '../store.js'
import { fingerprint, isOpenAiImage, type ProviderKey } from './check.js'
import { comfyui } from './comfyui.js'
import { fal } from './fal.js'
import { mock } from './mock.js'
import { llm, openai } from './openai.js'
import type { ModelInfo, Provider } from './types.js'

export const providers: Record<ModelInfo['provider'], Provider> = { mock, fal, openai, comfyui, llm }

const IMG_AR = ['1:1', '16:9', '9:16', '4:3', '3:4']
const VID_AR = ['16:9', '9:16', '1:1']

export const BUILTIN: ModelInfo[] = [
  // offline
  { id: 'mock-text', name: 'Mock Writer', provider: 'mock', kind: 'text', maxImages: 0 },
  { id: 'mock-image', name: 'Mock Image', provider: 'mock', kind: 'image', maxImages: 4, aspects: IMG_AR },
  { id: 'mock-video', name: 'Mock Video', provider: 'mock', kind: 'video', maxImages: 2, aspects: VID_AR, durations: [3, 5, 10] },
  { id: 'mock-audio', name: 'Mock Voice', provider: 'mock', kind: 'audio', maxImages: 0, audioMode: 'speech' },
  { id: 'mock-music', name: 'Mock Music', provider: 'mock', kind: 'audio', maxImages: 0, audioMode: 'music', durations: [10, 20, 30] },
  { id: 'mock-sfx', name: 'Mock Sound FX', provider: 'mock', kind: 'audio', maxImages: 0, audioMode: 'sfx', durations: [2, 5, 10] },
  { id: 'mock-upscale', name: 'Mock Enhance', provider: 'mock', kind: 'image', maxImages: 1, requiresImage: true, tool: 'upscale' },
  { id: 'mock-cutout', name: 'Mock Cutout', provider: 'mock', kind: 'image', maxImages: 1, requiresImage: true, tool: 'cutout' },
  { id: 'mock-inpaint', name: 'Mock Inpaint', provider: 'mock', kind: 'image', maxImages: 1, requiresImage: true, tool: 'inpaint' },
  { id: 'mock-relight', name: 'Mock Relight', provider: 'mock', kind: 'image', maxImages: 1, requiresImage: true, tool: 'relight' },
  // local
  { id: 'llm', name: 'Local LLM (OpenAI-compatible)', provider: 'llm', kind: 'text', maxImages: 0 },
  { id: 'comfy-image', name: 'ComfyUI Image', provider: 'comfyui', kind: 'image', maxImages: 2, aspects: IMG_AR },
  { id: 'comfy-video', name: 'ComfyUI Video', provider: 'comfyui', kind: 'video', maxImages: 2, aspects: VID_AR, durations: [3, 5, 8] },
  // cloud: OpenAI
  { id: 'gpt-image-1', name: 'GPT Image', provider: 'openai', kind: 'image', maxImages: 4, aspects: ['1:1', '16:9', '9:16'], extra: { remote: 'gpt-image-1' } },
  { id: 'openai-tts', name: 'OpenAI TTS', provider: 'openai', kind: 'audio', maxImages: 0, audioMode: 'speech', extra: { remote: 'tts-1' } },
  // cloud: fal.ai
  { id: 'flux-dev', name: 'FLUX.1 dev', provider: 'fal', kind: 'image', maxImages: 0, aspects: IMG_AR, extra: { app: 'fal-ai/flux/dev', sizeField: 'image_size' } },
  { id: 'flux-kontext', name: 'FLUX Kontext (edit)', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, aspects: IMG_AR, extra: { app: 'fal-ai/flux-pro/kontext' } },
  { id: 'nano-banana-edit', name: 'Nano Banana (edit)', provider: 'fal', kind: 'image', maxImages: 4, requiresImage: true, extra: { app: 'fal-ai/nano-banana/edit', imageField: 'image_urls' } },
  { id: 'kling-t2v', name: 'Kling 2.1 Master · T2V', provider: 'fal', kind: 'video', maxImages: 0, aspects: VID_AR, durations: [5, 10], extra: { app: 'fal-ai/kling-video/v2.1/master/text-to-video' } },
  { id: 'kling-i2v', name: 'Kling 2.1 · I2V', provider: 'fal', kind: 'video', maxImages: 2, requiresImage: true, durations: [5, 10], extra: { app: 'fal-ai/kling-video/v2.1/pro/image-to-video', tailField: 'tail_image_url' } },
  { id: 'veo3', name: 'Veo 3', provider: 'fal', kind: 'video', maxImages: 0, aspects: VID_AR, durations: [8], extra: { app: 'fal-ai/veo3', durationSuffix: 's' } },
  { id: 'hailuo-i2v', name: 'Hailuo 02 · I2V', provider: 'fal', kind: 'video', maxImages: 1, requiresImage: true, durations: [6, 10], extra: { app: 'fal-ai/minimax/hailuo-02/standard/image-to-video' } },
  { id: 'sync-lipsync', name: 'Sync Lip-sync (video + audio)', provider: 'fal', kind: 'video', maxImages: 0, needs: ['video', 'audio'], extra: { app: 'fal-ai/sync-lipsync' } },
  // fal.ai editing tools
  { id: 'clarity-upscaler', name: 'Clarity Upscaler', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, tool: 'upscale', extra: { app: 'fal-ai/clarity-upscaler' } },
  { id: 'birefnet', name: 'BiRefNet Cutout', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, tool: 'cutout', extra: { app: 'fal-ai/birefnet' } },
  { id: 'flux-fill', name: 'FLUX Fill (inpaint)', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, tool: 'inpaint', extra: { app: 'fal-ai/flux-pro/v1/fill' } },
  { id: 'iclight', name: 'IC-Light v2 (relight)', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, tool: 'relight', extra: { app: 'fal-ai/iclight-v2' } },
  // fal.ai audio
  { id: 'elevenlabs-tts', name: 'ElevenLabs TTS', provider: 'fal', kind: 'audio', maxImages: 0, audioMode: 'speech', extra: { app: 'fal-ai/elevenlabs/tts/multilingual-v2', textField: 'text' } },
  { id: 'elevenlabs-sfx', name: 'ElevenLabs Sound FX', provider: 'fal', kind: 'audio', maxImages: 0, audioMode: 'sfx', durations: [2, 5, 10], extra: { app: 'fal-ai/elevenlabs/sound-effects', textField: 'text', durationField: 'duration_seconds' } },
  { id: 'stable-audio', name: 'Stable Audio (music)', provider: 'fal', kind: 'audio', maxImages: 0, audioMode: 'music', durations: [10, 20, 30, 45], extra: { app: 'fal-ai/stable-audio', durationField: 'seconds_total' } },
]

// probe the LLM endpoint so the UI can fall back to the offline writer when it is down
let llmProbe = { key: '', at: 0, ok: false }
export async function llmReachable() {
  const { baseUrl, apiKey } = getSettings().llm
  const key = baseUrl + apiKey
  if (llmProbe.key === key && Date.now() - llmProbe.at < 30_000) return llmProbe.ok
  let ok = false
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(1500) })
    ok = r.ok
  } catch { /* unreachable */ }
  llmProbe = { key, at: Date.now(), ok }
  return ok
}

export type CatalogModel = ModelInfo & {
  available: boolean; reason?: string
  /** shown in canvas dropdowns, the agent and MCP */
  enabled: boolean
  paid: boolean
  /** fal price label from the last provider check */
  price?: string
  /** found by a provider check rather than built in */
  discovered?: boolean
}

/** A provider's last check result, if it still matches the saved config. */
export function currentStatus(p: ProviderKey, s: Settings = getSettings()): ProviderStatus | undefined {
  const st = s.providerStatus[p]
  return st && st.fp === fingerprint(p, s) ? st : undefined
}

// models found by the OpenAI check beyond the built-ins (off until switched on)
function openAiExtras(s: Settings): ModelInfo[] {
  const builtinRemotes = new Set(BUILTIN.filter(m => m.provider === 'openai').map(m => m.extra?.remote))
  return (currentStatus('openai', s)?.models ?? []).filter(id => !builtinRemotes.has(id)).map(id => isOpenAiImage(id)
    ? { id: `openai:${id}`, name: `OpenAI · ${id}`, provider: 'openai', kind: 'image', maxImages: id.startsWith('gpt-image') ? 4 : 0, aspects: id.startsWith('gpt-image') ? ['1:1', '16:9', '9:16'] : ['1:1'], extra: { remote: id } }
    : { id: `openai:${id}`, name: `OpenAI · ${id}`, provider: 'openai', kind: 'audio', maxImages: 0, audioMode: 'speech', extra: { remote: id } })
}

/**
 * Every model with availability. By default only enabled models are returned — that's what
 * the canvas, agent and MCP offer. `all` includes hidden ones (Settings, and running a node
 * that still points at a hidden model).
 */
export async function catalog(opts: { all?: boolean } = {}): Promise<CatalogModel[]> {
  const s = getSettings()
  const llmOk = await llmReachable()
  const fal = currentStatus('fal', s)
  const custom: ModelInfo[] = s.customModels.map(m => ({
    id: `custom:${m.id}`, name: m.name || m.id, provider: 'fal', kind: m.kind, maxImages: m.imageField ? 2 : 0, tool: m.tool,
    ...(m.tool === 'video-remove' || m.tool === 'video-replace' ? { needs: ['video'] as Array<'video'> } : {}),
    aspects: m.kind === 'video' ? VID_AR : m.kind === 'image' ? IMG_AR : undefined, durations: m.kind === 'video' ? [5, 10] : undefined,
    ...(m.kind === 'audio' ? { audioMode: 'speech' as const } : {}),
    extra: { app: m.id, imageField: m.imageField || 'image_url' },
  }))
  const extras = new Set(openAiExtras(s).map(m => m.id))
  const all = [...BUILTIN, ...openAiExtras(s), ...custom].map((m): CatalogModel => {
    const app = m.extra?.app as string | undefined
    const reason =
      m.provider === 'llm' && !llmOk ? `LLM not reachable at ${s.llm.baseUrl}`
      : m.provider === 'fal' && !s.fal.apiKey ? 'Add a fal.ai key in Settings'
      : m.provider === 'fal' && app && fal?.notFound?.includes(app) ? `fal has no model "${app}"`
      : m.provider === 'openai' && !s.openai.apiKey ? 'Add an OpenAI key in Settings'
      : m.provider === 'comfyui' && !(m.kind === 'video' ? s.comfyui.videoWorkflow : s.comfyui.imageWorkflow).trim() ? 'Paste a ComfyUI workflow in Settings'
      : undefined
    const discovered = extras.has(m.id)
    return {
      ...m, name: m.provider === 'llm' ? `LLM · ${s.llm.model}` : m.name, available: !reason, reason,
      enabled: s.modelPrefs[m.id] ?? !discovered, paid: m.provider === 'fal' || m.provider === 'openai',
      ...(app && fal?.prices?.[app] ? { price: fal.prices[app] } : {}),
      ...(discovered ? { discovered } : {}),
    }
  })
  return opts.all ? all : all.filter(m => m.enabled)
}

export const findModel = async (id: string) => (await catalog({ all: true })).find(m => m.id === id)
