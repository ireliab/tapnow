import fs from 'node:fs'
import path from 'node:path'
import { fileFromUrl, getSettings, mimeOfFile, newId } from '../store.js'
import { aspectToSize, sleep, type Provider } from './types.js'

/**
 * Runs a user-supplied ComfyUI workflow (exported with "Save (API format)").
 * Placeholders substituted in the workflow JSON:
 *   "{{prompt}}" "{{negative}}" "{{image}}" "{{last_image}}"   -> strings
 *   "{{seed}}" "{{width}}" "{{height}}" "{{frames}}" "{{duration}}" -> numbers (write them quoted in the template)
 */
export const comfyui: Provider = {
  async generate(model, req, ctx) {
    const s = getSettings().comfyui
    const base = s.url.replace(/\/$/, '')
    const template = model.kind === 'video' ? s.videoWorkflow : s.imageWorkflow
    if (!template.trim()) throw new Error(`No ComfyUI ${model.kind} workflow configured (Settings → ComfyUI)`)

    const upload = async (url: string) => {
      const f = fileFromUrl(url)
      if (mimeOfFile(f) === 'image/svg+xml') throw new Error('ComfyUI cannot read SVG (mock) images — use a real image input')
      const form = new FormData()
      form.append('image', new Blob([fs.readFileSync(f)], { type: mimeOfFile(f) }), path.basename(f))
      form.append('overwrite', 'true')
      const r = await fetch(`${base}/upload/image`, { method: 'POST', body: form, signal: ctx.signal })
      if (!r.ok) throw new Error(`ComfyUI upload ${r.status}`)
      return (await r.json() as { name: string }).name
    }
    const images = await Promise.all(req.inputs.images.slice(0, 2).map(upload))

    const { width, height } = aspectToSize(req.params.aspect ?? '16:9', model.kind === 'video' ? 832 : 1024)
    const duration = req.params.duration ?? 5
    const nums: Record<string, number> = {
      seed: req.params.seed ?? Math.floor(Math.random() * 2 ** 31), width, height, duration, frames: duration * 16 + 1,
    }
    const strs: Record<string, string> = {
      prompt: [...req.inputs.texts, req.prompt].filter(Boolean).join('\n'),
      negative: req.params.negative ?? '', image: images[0] ?? '', last_image: images[1] ?? images[0] ?? '',
    }
    let json = template
    for (const [k, v] of Object.entries(nums)) json = json.replaceAll(`"{{${k}}}"`, String(v))
    for (const [k, v] of Object.entries(strs)) json = json.replaceAll(`{{${k}}}`, JSON.stringify(v).slice(1, -1))
    let workflow: unknown
    try { workflow = JSON.parse(json) } catch { throw new Error('ComfyUI workflow is not valid JSON after substitution') }

    const res = await fetch(`${base}/prompt`, {
      method: 'POST', signal: ctx.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: newId() }),
    })
    if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${(await res.text()).slice(0, 400)}`)
    const { prompt_id } = await res.json() as { prompt_id: string }

    for (let i = 0; ; i++) {
      await sleep(1000, ctx.signal)
      const hist = await (await fetch(`${base}/history/${prompt_id}`, { signal: ctx.signal })).json() as any
      const entry = hist[prompt_id]
      if (!entry) { ctx.progress(Math.min(0.95, 0.05 + i * 0.01), 'running in ComfyUI'); continue }
      if (entry.status?.status_str === 'error') throw new Error('ComfyUI execution error')
      const files = Object.values(entry.outputs ?? {}).flatMap((o: any) => [...(o.videos ?? []), ...(o.gifs ?? []), ...(o.images ?? [])])
        .filter((f: any) => f.type === 'output')
      const pick = files.find((f: any) => /\.(mp4|webm|mov)$/i.test(f.filename)) ?? files.find((f: any) => /\.(gif|webp)$/i.test(f.filename)) ?? files[0]
      if (!pick) throw new Error('ComfyUI finished without output files')
      const q = new URLSearchParams({ filename: pick.filename, subfolder: pick.subfolder ?? '', type: pick.type })
      return { remoteUrl: `${base}/view?${q}` }
    }
  },
}
