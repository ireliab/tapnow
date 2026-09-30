import { getSettings, toDataUri } from '../store.js'
import { aspectToSize, sleep, type Provider } from './types.js'

/**
 * fal.ai queue API. Model ids live in the catalog (`extra.app`) and can be
 * extended from Settings → custom models, since hosted model ids change often.
 */
export const fal: Provider = {
  async generate(model, req, ctx) {
    const key = getSettings().fal.apiKey
    if (!key) throw new Error('fal.ai API key is not set (Settings)')
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
    const prompt = [...req.inputs.texts, req.prompt].filter(Boolean).join('\n')
    const x = model.extra ?? {}

    const input: Record<string, any> = { [x.textField ?? 'prompt']: prompt }
    if (req.params.seed !== undefined) input.seed = req.params.seed
    if (req.params.negative) input.negative_prompt = req.params.negative
    if (model.kind === 'image') {
      const { width, height } = aspectToSize(req.params.aspect)
      if (x.sizeField === 'image_size') input.image_size = { width, height }
      else if (req.params.aspect) input.aspect_ratio = req.params.aspect
    } else if (model.kind === 'audio') {
      if (req.params.voice && model.audioMode === 'speech') input.voice = req.params.voice
      if (req.params.duration && x.durationField) input[x.durationField] = req.params.duration
      if (req.params.speed && model.audioMode === 'speech') input.speed = req.params.speed
    } else if (model.kind === 'video') {
      if (req.params.aspect && !req.inputs.images.length) input.aspect_ratio = req.params.aspect
      if (req.params.duration) input.duration = x.durationSuffix ? `${req.params.duration}${x.durationSuffix}` : String(req.params.duration)
    }
    // editing tools and lip-sync take their media under fixed field names
    if (model.tool === 'inpaint' && req.params.mask) input.mask_url = toDataUri(req.params.mask)
    if (model.tool === 'upscale') { input.upscale_factor = Number(req.params.tool?.factor) || 2; if (!prompt) delete input.prompt }
    if (model.tool === 'cutout' && !prompt) delete input.prompt
    if (req.inputs.videos[0] && (model.needs?.includes('video'))) input.video_url = toDataUri(req.inputs.videos[0])
    if (req.inputs.audios[0] && (model.needs?.includes('audio'))) input.audio_url = toDataUri(req.inputs.audios[0])
    const imgs = req.inputs.images.map(toDataUri)
    if (imgs.length) {
      if (x.imageField === 'image_urls') input.image_urls = imgs
      else input[x.imageField ?? 'image_url'] = imgs[0]
      if (imgs[1] && x.tailField) input[x.tailField] = imgs[1]
    }

    const sub = await fetch(`https://queue.fal.run/${x.app ?? model.id}`, { method: 'POST', headers, body: JSON.stringify(input), signal: ctx.signal })
    if (!sub.ok) throw new Error(`fal submit ${sub.status}: ${await sub.text()}`)
    const { status_url, response_url, cancel_url } = await sub.json() as { status_url: string; response_url: string; cancel_url?: string }
    // cancelling locally must also stop the remote request, or fal keeps running (and billing) it
    const onAbort = () => { if (cancel_url) fetch(cancel_url, { method: 'PUT', headers }).catch(() => {}) }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    let tick = 0
    for (;;) {
      await sleep(1500, ctx.signal)
      const st = await (await fetch(status_url, { headers, signal: ctx.signal })).json() as { status: string; queue_position?: number }
      if (st.status === 'COMPLETED') break
      if (st.status === 'IN_QUEUE') ctx.progress(0.05, `queued #${st.queue_position ?? '?'}`)
      else ctx.progress(Math.min(0.95, 0.1 + ++tick * (model.kind === 'video' ? 0.01 : 0.08)), 'generating')
    }
    const res = await fetch(response_url, { headers, signal: ctx.signal })
    const out = await res.json() as any
    if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(out.detail ?? out)}`)
    const url = out.video?.url ?? out.images?.[0]?.url ?? out.image?.url ?? out.audio?.url ?? out.audio_file?.url
    if (!url) throw new Error('fal: no media in response: ' + JSON.stringify(out).slice(0, 300))
    return { remoteUrl: url }
  },
}
