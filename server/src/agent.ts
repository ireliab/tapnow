import { llmReachable } from './providers/index.js'
import { chat } from './providers/openai.js'

export interface Shot { title: string; image_prompt: string; motion_prompt: string; duration: number }
export interface AgentReply { reply: string; storyboard?: { style: string; shots: Shot[] }; source: 'llm' | 'offline' }

const SYSTEM = `You are the director agent inside a node-based AI video canvas.
Nodes: text (prompts), image (keyframes), video (animates images), audio (voice-over).
When the user describes something to make, plan a storyboard. Always reply with JSON:
{"reply": "<short friendly message>", "storyboard": {"style": "<shared visual style>", "shots": [{"title": "...", "image_prompt": "<keyframe description>", "motion_prompt": "<camera + subject motion>", "duration": 5}]}}
Use 3-6 shots unless asked otherwise. If the user only asks a question, reply with {"reply": "..."} and omit storyboard.`

export async function runAgent(message: string, canvasSummary: string, history: Array<{ role: string; content: string }>): Promise<AgentReply> {
  if (!(await llmReachable())) return offlineAgent(message)
  try {
    const raw = await chat([
      { role: 'system', content: SYSTEM },
      ...history.slice(-8),
      { role: 'user', content: `Current canvas:\n${canvasSummary || '(empty)'}\n\nRequest: ${message}` },
    ], { json: true, signal: AbortSignal.timeout(90_000) })
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const shots = (parsed.storyboard?.shots ?? []).map((s: any, i: number) => ({
      title: String(s.title ?? `Shot ${i + 1}`),
      image_prompt: String(s.image_prompt ?? s.prompt ?? ''),
      motion_prompt: String(s.motion_prompt ?? 'slow cinematic push-in'),
      duration: Number(s.duration) || 5,
    }))
    return { reply: String(parsed.reply ?? 'Done.'), storyboard: shots.length ? { style: String(parsed.storyboard.style ?? ''), shots } : undefined, source: 'llm' }
  } catch {
    return offlineAgent(message)
  }
}

const CAMERA = ['slow dolly-in', 'gentle orbit around the subject', 'tracking shot following the action', 'crane up revealing the scene', 'handheld close-up', 'slow pull-back to a wide shot']

/** No LLM available: split the idea into beats heuristically. */
export function offlineAgent(message: string): AgentReply {
  const text = message.replace(/^(please\s+)?(make|create|generate)\s+(me\s+)?(a|an)?\s*/i, '').trim()
  const n = Number(message.match(/(\d+)\s*(shots?|scenes?)/i)?.[1]) || 0
  let beats = text.split(/(?<=[.!?;])\s+|\n+|,\s*then\s+|\s+then\s+/i).map(s => s.trim()).filter(s => s.length > 3)
  if (beats.length < 2) {
    const subject = text.replace(/\d+\s*(shots?|scenes?)/i, '').trim() || 'the subject'
    beats = [`Establishing wide shot: ${subject}`, `Medium shot: ${subject}, key action`, `Close-up detail of ${subject}`, `Final hero shot: ${subject}`]
  }
  if (n) beats = Array.from({ length: n }, (_, i) => beats[i % beats.length])
  beats = beats.slice(0, 8)
  const shots = beats.map((b, i) => ({
    title: `Shot ${i + 1}`,
    image_prompt: b.replace(/[.;]$/, ''),
    motion_prompt: CAMERA[i % CAMERA.length],
    duration: 5,
  }))
  return {
    reply: `Planned ${shots.length} shots (offline planner — connect a local LLM in Settings for smarter storyboards). Edit any prompt, then hit Run all.`,
    storyboard: { style: 'cinematic, consistent color grade, 35mm', shots },
    source: 'offline',
  }
}
