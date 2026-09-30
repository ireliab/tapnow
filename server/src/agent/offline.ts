import { remember } from './persist.js'
import type { CallTool, TurnInput } from './loop.js'
import type { Conversation } from './types.js'

/**
 * No LLM reachable: handle the common skills deterministically. These drive the
 * exact same client tools as the LLM path, so the canvas, Ask-mode confirm cards
 * and playlist behave identically.
 */
const CAMERA = ['slow dolly-in', 'gentle orbit around the subject', 'tracking shot following the action', 'crane up revealing the scene', 'handheld close-up', 'slow pull-back to a wide shot']

export function pickSkill(input: Pick<TurnInput, 'text' | 'skills' | 'refs'>, mode: Conversation['mode']): string {
  const known = ['storyboard', 'script-to-scenes', 'product-shots', 'character-sheet', 'explain-canvas', 'brainstorm']
  const attached = input.skills.find(s => known.includes(s))
  if (attached) return attached
  if (mode === 'brainstorm') return 'brainstorm'
  const t = input.text.toLowerCase()
  if (/^remember\b/.test(t)) return 'remember'
  if (/explain|how (it'?s|was this) made|walk me through/.test(t)) return 'explain-canvas'
  if (/\bproduct\b|packshot|product shots?/.test(t) && input.refs.some(r => r.kind === 'image')) return 'product-shots'
  if (/character (sheet|design)|turnaround/.test(t)) return 'character-sheet'
  if (/\b(int|ext)\.|script|screenplay|scene \d/i.test(input.text) || input.text.split('\n').filter(Boolean).length >= 4) return 'script-to-scenes'
  if (/video|shot|scene|story|ad\b|teaser|trailer|clip|film|commercial/.test(t)) return 'storyboard'
  return 'none'
}

export function splitBeats(message: string) {
  const n = Math.min(Number(message.match(/(\d+)\s*(shots?|scenes?)/i)?.[1]) || 0, 8)
  const text = message
    .replace(/^(please\s+)?(make|create|generate)\s+(me\s+)?(a|an)?\s*/i, '')
    .replace(/[,;]?\s*(in\s+)?\d+\s*(shots?|scenes?)\b/i, '')
    .trim()
  let beats = text.split(/(?<=[.!?;])\s+|\n+|,\s*then\s+|\s+then\s+/i).map(s => s.trim().replace(/[.,;]$/, '')).filter(s => s.length > 3)
  const subject = beats[0] ?? (text || 'the subject')
  const coverage = [`Establishing wide shot: ${subject}`, `Medium shot: ${subject}, key action`, `Close-up detail of ${subject}`, `Final hero shot: ${subject}`, `Reaction shot: ${subject}`, `Over-the-shoulder shot: ${subject}`]
  if (beats.length < 2 && !n) beats = coverage.slice(0, 4)
  // too few story beats for the requested count: pad with coverage shots of the first beat
  for (let i = 0; n && beats.length < n; i++) beats.push(coverage[i % coverage.length])
  return beats.slice(0, n || 8)
}

/** Split a script into scenes at scene headings, blank lines, or evenly by lines. */
export function splitScenes(script: string) {
  const byHeading = script.split(/\n(?=\s*(?:INT\.|EXT\.|SCENE\s+\d+|#+\s))/i).map(s => s.trim()).filter(Boolean)
  if (byHeading.length > 1) return byHeading.slice(0, 12)
  const byPara = script.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  if (byPara.length > 1) return byPara.slice(0, 12)
  const lines = script.split('\n').map(s => s.trim()).filter(Boolean)
  const size = Math.max(1, Math.ceil(lines.length / 4))
  return Array.from({ length: Math.ceil(lines.length / size) }, (_, i) => lines.slice(i * size, (i + 1) * size).join('\n'))
}

function shotPairs(prefix: string, prompts: string[], styleRef?: string) {
  const nodes: any[] = []
  const edges: any[] = []
  prompts.forEach((p, i) => {
    nodes.push(
      { ref: `${prefix}img${i}`, kind: 'image', title: `Shot ${i + 1} · keyframe`, prompt: p, params: { aspect: '16:9' } },
      { ref: `${prefix}vid${i}`, kind: 'video', title: `Shot ${i + 1} · clip`, prompt: CAMERA[i % CAMERA.length], params: { aspect: '16:9', duration: 5 } },
    )
    if (styleRef) edges.push({ from: styleRef, to: `${prefix}img${i}` })
    edges.push({ from: `${prefix}img${i}`, to: `${prefix}vid${i}` })
  })
  return { nodes, edges }
}

export async function offlineTurn(conv: Conversation, input: TurnInput, callTool: CallTool, say: (t: string) => void) {
  const skill = pickSkill(input, conv.mode)
  const note = ' (Offline planner — connect a local LLM in Settings for smarter, conversational results.)'
  const ids = (r: any) => r?.created ?? {}

  switch (skill) {
    case 'remember': {
      const pref = input.text.replace(/^remember( this| that)?:?\s*/i, '').trim()
      remember(pref)
      return say(`Saved preference: "${pref}".`)
    }
    case 'storyboard': {
      const beats = splitBeats(input.text)
      const { nodes, edges } = shotPairs('', beats, 'style')
      const r = await callTool('create_nodes', { nodes: [{ ref: 'style', kind: 'text', title: 'Style', prompt: 'cinematic, consistent color grade, 35mm film look' }, ...nodes], edges })
      const created = ids(r)
      const vids = beats.map((_, i) => created[`vid${i}`]).filter(Boolean)
      await callTool('add_to_playlist', { node_ids: vids })
      say(`Planned ${beats.length} shots: ${beats.map((b, i) => `${i + 1}. ${b}`).join(' · ')}.${note}`)
      const media = [...beats.map((_, i) => created[`img${i}`]), ...vids].filter(Boolean)
      const g = await callTool('generate', { node_ids: media })
      return say(g?.declined ? 'Okay — nothing generated. Edit the prompts on the canvas and run them when ready.' : 'Storyboard generated and added to the playlist.')
    }
    case 'script-to-scenes': {
      const scenes = splitScenes(input.text)
      const nodes: any[] = []
      const edges: any[] = []
      scenes.forEach((s, i) => {
        nodes.push(
          { ref: `txt${i}`, kind: 'text', title: `Scene ${i + 1}`, prompt: s },
          { ref: `img${i}`, kind: 'image', title: `Scene ${i + 1} · keyframe`, prompt: '', params: { aspect: '16:9' } },
          { ref: `vid${i}`, kind: 'video', title: `Scene ${i + 1} · clip`, prompt: CAMERA[i % CAMERA.length], params: { aspect: '16:9', duration: 5 } },
        )
        edges.push({ from: `txt${i}`, to: `img${i}` }, { from: `img${i}`, to: `vid${i}` })
      })
      await callTool('save_output', { title: 'Scene breakdown', content: scenes.map((s, i) => `## Scene ${i + 1}\n\n${s}`).join('\n\n') })
      const created = ids(await callTool('create_nodes', { nodes, edges }))
      await callTool('add_to_playlist', { node_ids: scenes.map((_, i) => created[`vid${i}`]).filter(Boolean) })
      if (conv.mode === 'auto') await callTool('generate', { node_ids: scenes.flatMap((_, i) => [created[`img${i}`], created[`vid${i}`]]).filter(Boolean) })
      return say(`Split the script into ${scenes.length} scenes, saved a scene breakdown to Outputs and laid out keyframe → clip pairs.${note}`)
    }
    case 'product-shots': {
      const ref = input.refs.find(r => r.kind === 'image')
      if (!ref) return say('Reference a product image with @ (or upload one) and ask again.')
      const angles = ['Hero shot, centered on a clean studio background, soft key light', '3/4 left angle, studio light', '3/4 right angle, studio light', 'Top-down flat lay', 'Lifestyle shot in a realistic use context', 'Macro detail of texture and label']
      const nodes = angles.map((a, i) => ({ ref: `p${i}`, kind: 'image', title: a.split(',')[0], prompt: `${a}. Keep the product shape, label, logo and colors exactly unchanged.`, params: { aspect: '1:1' } }))
      const created = ids(await callTool('create_nodes', { nodes, edges: nodes.map(n => ({ from: ref.nodeId, to: n.ref })) }))
      await callTool('generate', { node_ids: Object.values(created) })
      return say(`Created a ${angles.length}-shot product set from @${ref.title}.${note}`)
    }
    case 'character-sheet': {
      const desc = input.text.replace(/character (sheet|design)( for| of)?:?/i, '').trim() || 'an original character'
      const nodes = [
        { ref: 'desc', kind: 'text', title: 'Character — canonical description', prompt: desc },
        { ref: 'turn', kind: 'image', title: 'Turnaround', prompt: 'Character turnaround: front, side and back views, neutral background, identical lighting', params: { aspect: '16:9' } },
        { ref: 'expr', kind: 'image', title: 'Expressions 2×2', prompt: '2x2 grid of facial expressions: neutral, happy, angry, surprised', params: { aspect: '1:1' } },
        { ref: 'pose', kind: 'image', title: 'Action pose', prompt: 'Dynamic action pose in a fitting scene', params: { aspect: '16:9' } },
      ]
      await callTool('save_output', { title: 'Character sheet', content: `# Character\n\n${desc}` })
      const created = ids(await callTool('create_nodes', { nodes, edges: ['turn', 'expr', 'pose'].map(t => ({ from: 'desc', to: t })) }))
      await callTool('generate', { node_ids: [created.turn, created.expr, created.pose].filter(Boolean) })
      return say(`Character sheet created. Split the expression grid into separate nodes with Quick Split.${note}`)
    }
    case 'explain-canvas': {
      const c = await callTool('get_canvas', {})
      const nodes: any[] = c?.nodes ?? []
      if (!nodes.length) return say('The canvas is empty — nothing to explain yet.')
      const count = (k: string) => nodes.filter(n => n.kind === k).length
      const lines = [
        `This canvas has ${nodes.length} nodes: ${count('text')} text, ${count('image')} image, ${count('video')} video, ${count('audio')} audio, connected by ${c.edges?.length ?? 0} links.`,
        ...nodes.slice(0, 12).map(n => `• ${n.title} (${n.kind}${n.model ? `, ${n.model}` : ''})${n.inputs?.length ? ` ← ${n.inputs.join(', ')}` : ''}: ${String(n.prompt ?? '').slice(0, 90) || '(no prompt)'}`),
        'Text nodes feed their content into downstream prompts; image outputs become references or first/last frames for video nodes.',
      ]
      return say(lines.join('\n') + note)
    }
    case 'brainstorm': {
      const a = await callTool('ask_user', {
        questions: [
          { question: 'Which tone fits best?', options: ['Cinematic & emotional', 'Playful & bright', 'Minimal & premium', 'Gritty & documentary'] },
          { question: 'Target format?', options: ['16:9 YouTube', '9:16 TikTok/Reels', '1:1 feed'] },
          { question: 'Who is the audience?' },
        ],
      })
      if (a?.cancelled) return say('No problem — tell me more whenever you are ready.')
      const answers: string[] = a?.answers ?? []
      const brief = `# Direction\n\n**Idea:** ${input.text}\n\n**Tone:** ${answers[0] ?? '—'}\n\n**Format:** ${answers[1] ?? '—'}\n\n**Audience:** ${answers[2] ?? '—'}`
      await callTool('create_nodes', { nodes: [{ ref: 'dir', kind: 'text', title: 'Direction (approved)', prompt: brief.replace(/\*\*/g, '') }] })
      await callTool('save_output', { title: 'Creative direction', content: brief, status: 'approved' })
      return say(`Direction saved to the canvas and Outputs. Switch to Auto or Ask mode and ask for a storyboard to produce it.${note}`)
    }
    default:
      return say(`I can plan storyboards, split scripts into scenes, make product shot sets and character sheets, explain the canvas and brainstorm offline. Try one of those, attach a skill, or connect a local LLM in Settings for open-ended requests.`)
  }
}
