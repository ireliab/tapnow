import fs from 'node:fs'
import { fileFromUrl, getSettings, mimeOfFile } from '../store.js'
import type { GenRequest, Provider } from './types.js'

/** Chat completion against any OpenAI-compatible endpoint (Ollama, LM Studio, OpenAI, …). */
export async function chat(messages: Array<{ role: string; content: string }>, opts: { json?: boolean; signal?: AbortSignal } = {}) {
  const { baseUrl, apiKey, model } = getSettings().llm
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.7, ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const out = await res.json() as any
  return String(out.choices?.[0]?.message?.content ?? '')
}

const WRITER = `You write for AI video creators: scripts, shot lists, storyboards, prompts, captions and notes.
Follow the instruction. If a current document is given, rewrite or extend it as instructed instead of starting over.
Use Markdown (headings, **bold**, lists, tables) where it helps. Reply with the document only, no preamble.`
const EXPANDER = 'You are a prompt engineer for AI image and video generation. Rewrite the user idea into one vivid, concrete prompt (subject, setting, lighting, camera, style). Reply with the prompt only.'

/** Messages for a text node: an instruction writes/rewrites the document; no instruction expands it into a prompt. */
export function textMessages(req: GenRequest) {
  const ask = req.prompt.trim()
  const doc = req.params.document?.trim() ?? ''
  if (!ask) return [{ role: 'system', content: EXPANDER }, { role: 'user', content: [...req.inputs.texts, doc].filter(Boolean).join('\n\n') }]
  const parts = [
    req.inputs.texts.length ? `Reference material from connected nodes:\n${req.inputs.texts.join('\n\n---\n\n')}` : '',
    doc ? `Current document:\n${doc}` : '',
    `Instruction: ${ask}`,
  ]
  return [{ role: 'system', content: WRITER }, { role: 'user', content: parts.filter(Boolean).join('\n\n') }]
}

/** Text nodes: write or rewrite the node's document from an instruction (or expand it into a prompt). */
export const llm: Provider = {
  async generate(_model, req, ctx) {
    ctx.progress(0.2, 'thinking')
    const text = await chat(textMessages(req), { signal: ctx.signal })
    // reasoning models (Qwen3, DeepSeek-R1) may leak their thinking block
    return { text: text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim() }
  },
}

const SIZES: Record<string, string> = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '9:16': '1024x1536', '3:4': '1024x1536' }

export const openai: Provider = {
  async generate(model, req, ctx) {
    const { baseUrl, apiKey } = getSettings().openai
    if (!apiKey) throw new Error('OpenAI API key is not set (Settings)')
    const base = baseUrl.replace(/\/$/, '')
    const auth = { Authorization: `Bearer ${apiKey}` }
    const prompt = [...req.inputs.texts, req.prompt].filter(Boolean).join('\n')
    ctx.progress(0.1, 'submitting')

    if (model.kind === 'audio') {
      const res = await fetch(`${base}/audio/speech`, {
        method: 'POST', signal: ctx.signal, headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.extra?.remote ?? 'tts-1', voice: req.params.voice ?? 'alloy', input: prompt, response_format: 'mp3' }),
      })
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`)
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' }
    }

    const size = SIZES[req.params.aspect ?? '1:1'] ?? '1024x1024'
    let res: Response
    if (req.inputs.images.length) {
      const form = new FormData()
      form.append('model', model.extra?.remote ?? 'gpt-image-1')
      form.append('prompt', prompt)
      form.append('size', size)
      for (const u of req.inputs.images) {
        const f = fileFromUrl(u)
        form.append('image[]', new Blob([fs.readFileSync(f)], { type: mimeOfFile(f) }), 'ref.png')
      }
      res = await fetch(`${base}/images/edits`, { method: 'POST', headers: auth, body: form, signal: ctx.signal })
    } else {
      res = await fetch(`${base}/images/generations`, {
        method: 'POST', signal: ctx.signal, headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.extra?.remote ?? 'gpt-image-1', prompt, size, n: 1 }),
      })
    }
    if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const d = (await res.json() as any).data?.[0]
    if (d?.b64_json) return { bytes: Buffer.from(d.b64_json, 'base64'), mime: 'image/png' }
    if (d?.url) return { remoteUrl: d.url }
    throw new Error('OpenAI returned no image')
  },
}
