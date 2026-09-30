import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { newId } from './store.js'

const require = createRequire(import.meta.url)
/** ffmpeg binary: FFMPEG_PATH override, else the bundled ffmpeg-static build. */
export const FFMPEG: string = process.env.FFMPEG_PATH || (require('ffmpeg-static') as string)

export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { windowsHide: true })
    let stderr = ''
    p.stderr.on('data', d => { stderr += d; if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000) })
    signal?.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
    p.on('error', reject)
    p.on('close', code => (code === 0 ? resolve({ stderr }) : reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`))))
  })
}

export const tmpFile = (ext: string) => path.join(os.tmpdir(), `taplocal-${Date.now().toString(36)}-${newId(6)}.${ext}`)

/** Parse "Duration: 00:01:02.50" and the first video stream size from ffmpeg -i output. */
export function parseProbe(stderr: string) {
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const v = stderr.match(/Stream #\S+.*Video:.*?(\d{2,5})x(\d{2,5})/)
  return { duration, width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0, hasAudio: /Stream #\S+.*Audio:/.test(stderr) }
}

export async function probe(file: string) {
  // `ffmpeg -i` without an output exits non-zero but still prints the stream info
  const stderr = await new Promise<string>(resolve => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true })
    let err = ''
    p.stderr.on('data', d => (err += d))
    p.on('close', () => resolve(err))
    p.on('error', () => resolve(err))
  })
  return parseProbe(stderr)
}

/** Scene-change timestamps from the showinfo filter output. */
export function parseSceneTimes(stderr: string) {
  return [...stderr.matchAll(/showinfo.*?pts_time:\s*([\d.]+)/g)].map(m => Number(m[1])).filter(t => Number.isFinite(t))
}

export async function trim(input: string, start: number, end: number | undefined, signal?: AbortSignal) {
  const out = tmpFile('mp4')
  const dur = end !== undefined ? Math.max(0.1, end - start) : undefined
  // re-encode for frame-accurate cuts
  await runFfmpeg(['-ss', String(Math.max(0, start)), '-i', input, ...(dur ? ['-t', String(dur)] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out], signal)
  return out
}

export async function captureFrame(input: string, at: number | 'first' | 'last', signal?: AbortSignal) {
  const out = tmpFile('png')
  if (at === 'last') await runFfmpeg(['-sseof', '-0.1', '-i', input, '-update', '1', '-frames:v', '1', out], signal)
  else await runFfmpeg(['-ss', String(at === 'first' ? 0 : Math.max(0, at)), '-i', input, '-frames:v', '1', out], signal)
  if (!fs.existsSync(out)) throw new Error('Could not capture a frame')
  return out
}

/** Detect cuts, then split the clip into segments (TapNow "Smart Clip"). */
export async function smartClip(input: string, threshold = 0.3, signal?: AbortSignal) {
  const { duration } = await probe(input)
  const { stderr } = await runFfmpeg(['-i', input, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], signal)
  const cuts = parseSceneTimes(stderr).filter(t => t > 0.4 && t < duration - 0.4)
  // merge cuts closer than 0.5s
  const times = cuts.reduce<number[]>((acc, t) => (acc.length && t - acc[acc.length - 1] < 0.5 ? acc : [...acc, t]), [])
  const bounds = [0, ...times, duration]
  const segments: string[] = []
  for (let i = 0; i < bounds.length - 1 && i < 30; i++) segments.push(await trim(input, bounds[i], bounds[i + 1], signal))
  return { segments, cuts: times }
}
