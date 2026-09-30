import { getSettings } from '../store.js'
import { comfyui } from './comfyui.js'
import { fal } from './fal.js'
import { mock } from './mock.js'
import { llm, openai } from './openai.js'
import type { ModelInfo, Provider } from './types.js'

export const providers: Record<ModelInfo['provider'], Provider> = { mock, fal, openai, comfyui, llm }

const IMG_AR = ['1:1', '16:9', '9:16', '4:3', '3:4']
const VID_AR = ['16:9', '9:16', '1:1']

const BUILTIN: ModelInfo[] = [
  // offline
  { id: 'mock-text', name: 'Mock Writer', provider: 'mock', kind: 'text', maxImages: 0 },
  { id: 'mock-image', name: 'Mock Image', provider: 'mock', kind: 'image', maxImages: 4, aspects: IMG_AR },
  { id: 'mock-video', name: 'Mock Video', provider: 'mock', kind: 'video', maxImages: 2, aspects: VID_AR, durations: [3, 5, 10] },
  { id: 'mock-audio', name: 'Mock Voice', provider: 'mock', kind: 'audio', maxImages: 0 },
  // local
  { id: 'llm', name: 'Local LLM (OpenAI-compatible)', provider: 'llm', kind: 'text', maxImages: 0 },
  { id: 'comfy-image', name: 'ComfyUI Image', provider: 'comfyui', kind: 'image', maxImages: 2, aspects: IMG_AR },
  { id: 'comfy-video', name: 'ComfyUI Video', provider: 'comfyui', kind: 'video', maxImages: 2, aspects: VID_AR, durations: [3, 5, 8] },
  // cloud: OpenAI
  { id: 'gpt-image-1', name: 'GPT Image', provider: 'openai', kind: 'image', maxImages: 4, aspects: ['1:1', '16:9', '9:16'], extra: { remote: 'gpt-image-1' } },
  { id: 'openai-tts', name: 'OpenAI TTS', provider: 'openai', kind: 'audio', maxImages: 0, extra: { remote: 'tts-1' } },
  // cloud: fal.ai
  { id: 'flux-dev', name: 'FLUX.1 dev', provider: 'fal', kind: 'image', maxImages: 0, aspects: IMG_AR, extra: { app: 'fal-ai/flux/dev', sizeField: 'image_size' } },
  { id: 'flux-kontext', name: 'FLUX Kontext (edit)', provider: 'fal', kind: 'image', maxImages: 1, requiresImage: true, aspects: IMG_AR, extra: { app: 'fal-ai/flux-pro/kontext' } },
  { id: 'nano-banana-edit', name: 'Nano Banana (edit)', provider: 'fal', kind: 'image', maxImages: 4, requiresImage: true, extra: { app: 'fal-ai/nano-banana/edit', imageField: 'image_urls' } },
  { id: 'kling-t2v', name: 'Kling 2.1 Master · T2V', provider: 'fal', kind: 'video', maxImages: 0, aspects: VID_AR, durations: [5, 10], extra: { app: 'fal-ai/kling-video/v2.1/master/text-to-video' } },
  { id: 'kling-i2v', name: 'Kling 2.1 · I2V', provider: 'fal', kind: 'video', maxImages: 2, requiresImage: true, durations: [5, 10], extra: { app: 'fal-ai/kling-video/v2.1/pro/image-to-video', tailField: 'tail_image_url' } },
  { id: 'veo3', name: 'Veo 3', provider: 'fal', kind: 'video', maxImages: 0, aspects: VID_AR, durations: [8], extra: { app: 'fal-ai/veo3', durationSuffix: 's' } },
  { id: 'hailuo-i2v', name: 'Hailuo 02 · I2V', provider: 'fal', kind: 'video', maxImages: 1, requiresImage: true, durations: [6, 10], extra: { app: 'fal-ai/minimax/hailuo-02/standard/image-to-video' } },
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

export async function catalog(): Promise<Array<ModelInfo & { available: boolean; reason?: string }>> {
  const s = getSettings()
  const llmOk = await llmReachable()
  const custom: ModelInfo[] = s.customModels.map(m => ({
    id: `custom:${m.id}`, name: m.name || m.id, provider: 'fal', kind: m.kind, maxImages: m.imageField ? 2 : 0,
    aspects: m.kind === 'video' ? VID_AR : IMG_AR, durations: m.kind === 'video' ? [5, 10] : undefined,
    extra: { app: m.id, imageField: m.imageField || 'image_url' },
  }))
  return [...BUILTIN, ...custom].map(m => {
    const reason =
      m.provider === 'llm' && !llmOk ? `LLM not reachable at ${s.llm.baseUrl}`
      : m.provider === 'fal' && !s.fal.apiKey ? 'Add a fal.ai key in Settings'
      : m.provider === 'openai' && !s.openai.apiKey ? 'Add an OpenAI key in Settings'
      : m.provider === 'comfyui' && !(m.kind === 'video' ? s.comfyui.videoWorkflow : s.comfyui.imageWorkflow).trim() ? 'Paste a ComfyUI workflow in Settings'
      : undefined
    return { ...m, name: m.provider === 'llm' ? `LLM · ${s.llm.model}` : m.name, available: !reason, reason }
  })
}

export const findModel = async (id: string) => (await catalog()).find(m => m.id === id)
