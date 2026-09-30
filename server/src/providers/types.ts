export type GenKind = 'text' | 'image' | 'video' | 'audio'

export interface GenRequest {
  kind: GenKind
  model: string
  prompt: string
  params: { aspect?: string; duration?: number; seed?: number; voice?: string; negative?: string; count?: number; speed?: number; pitch?: number; audioMode?: 'speech' | 'music' | 'sfx'
    /** inpaint mask (local /files url, white = change) */
    mask?: string
    /** tool-specific settings, e.g. upscale factor */
    tool?: Record<string, unknown>
  }
  /** Upstream outputs, as local `/files/..` URLs (or plain text). Image order matters: [first frame, last frame]. */
  inputs: { texts: string[]; images: string[]; videos: string[]; audios: string[] }
}

export interface GenContext {
  progress(p: number, message?: string): void
  signal: AbortSignal
}

export type GenResult =
  | { text: string }
  | { bytes: Buffer; mime: string }
  | { remoteUrl: string; mime?: string }

export interface ModelInfo {
  id: string
  name: string
  provider: 'mock' | 'fal' | 'openai' | 'comfyui' | 'llm'
  kind: GenKind
  /** max reference/frame images the model accepts */
  maxImages: number
  requiresImage?: boolean
  aspects?: string[]
  durations?: number[]
  /** set on editing-tool models (upscale, cutout, inpaint, relight, video-remove, video-replace) */
  tool?: string
  /** audio models: which kind of audio they make */
  audioMode?: 'speech' | 'music' | 'sfx'
  /** extra inputs the model needs (lip-sync: video + audio) */
  needs?: Array<'video' | 'audio'>
  /** provider-specific: fal input field for the image, remote model id, etc. */
  extra?: Record<string, any>
}

export interface Provider {
  generate(model: ModelInfo, req: GenRequest, ctx: GenContext): Promise<GenResult>
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')) }, { once: true })
  })

export function aspectToSize(aspect = '16:9', long = 1024) {
  const [w, h] = aspect.split(':').map(Number)
  if (!w || !h) return { width: long, height: long }
  const r = w / h
  const width = r >= 1 ? long : Math.round((long * r) / 8) * 8
  const height = r >= 1 ? Math.round(long / r / 8) * 8 : long
  return { width, height }
}
