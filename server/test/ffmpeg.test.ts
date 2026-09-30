import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { captureFrame, parseProbe, parseSceneTimes, probe, renderPlaylist, runFfmpeg, smartClip, tmpFile, trim } from '../src/ffmpeg'

describe('ffmpeg output parsing', () => {
  it('reads duration, size and audio presence', () => {
    const err = `Input #0, mov,mp4 from 'a.mp4':\n  Duration: 00:01:02.50, start: 0.000000\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720 [SAR 1:1], 30 fps\n  Stream #0:1[0x2](und): Audio: aac, 48000 Hz`
    expect(parseProbe(err)).toEqual({ duration: 62.5, width: 1280, height: 720, hasAudio: true })
  })
  it('reads scene timestamps from showinfo', () => {
    const err = '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  30720 pts_time:2.4     duration\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  61440 pts_time:4.8 x'
    expect(parseSceneTimes(err)).toEqual([2.4, 4.8])
  })
})

describe('ffmpeg operations (real binary)', () => {
  let clip = ''
  beforeAll(async () => {
    // 3 hard cuts with strong luma contrast (black, white, black) — 1.5s each
    clip = tmpFile('mp4')
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1.5:r=25',
      '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', clip,
    ])
  }, 60_000)

  it('probes the test clip', async () => {
    const p = await probe(clip)
    expect(p.width).toBe(320)
    expect(p.duration).toBeCloseTo(4.5, 0)
  })
  it('trims to a range', async () => {
    const out = await trim(clip, 1, 2.5)
    expect((await probe(out)).duration).toBeCloseTo(1.5, 0)
  }, 60_000)
  it('captures first and last frames as png', async () => {
    for (const at of ['first', 'last'] as const) {
      const f = await captureFrame(clip, at)
      expect(fs.readFileSync(f).subarray(1, 4).toString()).toBe('PNG')
    }
  }, 60_000)
  it('smart-clips at scene cuts', async () => {
    const { segments, cuts } = await smartClip(clip)
    expect(cuts.length).toBe(2)
    expect(segments).toHaveLength(3)
  }, 120_000)
  it('renders a playlist of a trimmed video + a still into one mp4 with audio', async () => {
    const still = await captureFrame(clip, 'first')
    const out = await renderPlaylist([
      { file: clip, kind: 'video', in: 0.5, out: 2 },
      { file: still, kind: 'image', in: 0, duration: 1.5 },
    ], { width: 320, height: 180 })
    const p = await probe(out)
    expect(p.width).toBe(320)
    expect(p.hasAudio).toBe(true)
    expect(p.duration).toBeGreaterThan(2.7)
    expect(p.duration).toBeLessThan(3.4)
  }, 120_000)
})
