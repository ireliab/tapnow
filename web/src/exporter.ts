/**
 * Plays a sequence of clips onto a <canvas>. Used for both the timeline
 * preview and WebM export (MediaRecorder on the canvas stream + mixed audio),
 * so no ffmpeg is required.
 */
export interface SeqClip { url: string; kind: 'image' | 'video'; mime?: string; duration: number; in?: number; out?: number }

const isRealVideo = (c: SeqClip) => c.kind === 'video' && !c.mime?.includes('svg')
// rAF stops in hidden tabs; fall back to timers so an export keeps going
const nextFrame = () => new Promise<void>(r => (document.hidden ? setTimeout(r, 33) : requestAnimationFrame(() => r())))

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, zoom = 1) {
  const { width: W, height: H } = ctx.canvas
  const s = Math.max(W / sw, H / sh) * zoom
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s)
}

export async function playSequence(
  canvas: HTMLCanvasElement, clips: SeqClip[],
  opts: { record?: boolean; signal?: AbortSignal; onProgress?: (clip: number, t: number) => void } = {},
): Promise<Blob | undefined> {
  const ctx = canvas.getContext('2d')!
  const audio = new AudioContext()
  await audio.resume().catch(() => {})
  const dest = audio.createMediaStreamDestination()
  // a silent/suspended audio track stalls the WebM muxer, so only record audio when it can flow
  const withAudio = audio.state === 'running' && clips.some(isRealVideo)
  let recorder: MediaRecorder | undefined
  const chunks: Blob[] = []
  if (opts.record) {
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...(withAudio ? dest.stream.getAudioTracks() : [])])
    const types = withAudio ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t))
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data)
    recorder.start(250)
  }
  const out = opts.record ? dest : audio.destination
  const aborted = () => opts.signal?.aborted

  try {
    for (let i = 0; i < clips.length && !aborted(); i++) {
      const c = clips[i]
      if (isRealVideo(c)) {
        const v = document.createElement('video')
        v.src = c.url; v.crossOrigin = 'anonymous'; v.playsInline = true
        await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error(`Cannot load ${c.url}`)) })
        // honour playlist in/out points
        if (c.in) { v.currentTime = c.in; await new Promise(r => { v.onseeked = r }) }
        const stopAt = c.out ?? Infinity
        const span = Math.max(0.1, Math.min(stopAt, v.duration || stopAt) - (c.in ?? 0))
        if (withAudio || !opts.record) audio.createMediaElementSource(v).connect(out)
        else v.muted = true
        await v.play()
        while (!aborted() && !v.ended && v.currentTime < stopAt) {
          drawCover(ctx, v, v.videoWidth, v.videoHeight)
          opts.onProgress?.(i, (v.currentTime - (c.in ?? 0)) / span)
          await nextFrame()
        }
        v.pause()
      } else {
        const img = new Image()
        img.src = c.url
        await img.decode()
        const t0 = performance.now(), ms = Math.max(0.2, (c.out ?? c.duration) - (c.in ?? 0)) * 1000
        for (let t = 0; !aborted() && t < 1; t = (performance.now() - t0) / ms) {
          // gentle Ken Burns so stills and mock clips feel alive
          drawCover(ctx, img, img.naturalWidth || canvas.width, img.naturalHeight || canvas.height, 1 + 0.08 * t)
          opts.onProgress?.(i, t)
          await nextFrame()
        }
      }
    }
  } finally {
    if (recorder) await new Promise(res => { recorder!.onstop = res; recorder!.stop() })
    audio.close()
  }
  if (!recorder || aborted()) return undefined
  if (!chunks.length) throw new Error('Recording produced no data — keep this tab visible while exporting')
  return new Blob(chunks, { type: 'video/webm' })
}
