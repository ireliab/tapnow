import type { Skill } from '../skills.js'
import type { AgentMode } from './types.js'

const BASE = `You are TapLocal Agent, the executive director inside a node-based AI video canvas.
The canvas holds nodes — text (prompts, scripts, notes), image, video and audio — connected upstream → downstream.
Connected text is prepended to a node's prompt; connected images become references (for video: the upper image is the first frame, the lower one the last frame). Connected audio can drive lip-sync video models.
You work by calling tools: read the canvas, create/update/connect nodes, generate, build the playlist, save documents, ask the user.

How to work:
- Read context first (the canvas summary, referenced nodes, attachments). Identify the deliverable and constraints.
- Plan briefly, then act with tools. Prefer one create_nodes call per batch of nodes.
- Keep chat replies short and concrete; the canvas is where work lives. Never paste long documents into chat — use save_output.
- When a skill matches the request, call use_skill first and follow it.
- Only use model ids from the available-models list. Respect the user's saved preferences.
- Ask with ask_user only when essential information is missing (max 4 questions at once).`

const MODES: Record<AgentMode, string> = {
  auto: 'Mode: AUTO — generate as soon as nodes are ready; no confirmation needed.',
  ask: 'Mode: ASK — call generate normally; the user will see a confirmation card to review model, size, duration and count before anything is spent, and may decline. If declined, stop and ask what to change.',
  brainstorm: `Mode: BRAINSTORM — pre-production only. Do NOT generate media. Develop the idea one decision at a time: offer 2–4 options (ask_user with options), record approved decisions as text nodes (create_nodes), and write the final creative brief with save_output. Suggest switching to Auto or Ask mode to produce it.`,
}

export function systemPrompt(o: {
  mode: AgentMode
  skills: Skill[]
  loadedSkills: Skill[]
  memory: string[]
  models: Array<{ id: string; name: string; kind: string; maxImages: number }>
  searchEnabled: boolean
}) {
  const byKind = (k: string) => o.models.filter(m => m.kind === k).map(m => `${m.id}${m.maxImages ? ` (≤${m.maxImages} ref images)` : ''}`).join(', ') || 'none'
  return [
    BASE,
    MODES[o.mode],
    `Available models — image: ${byKind('image')}; video: ${byKind('video')}; audio: ${byKind('audio')}; text: ${byKind('text')}.`,
    o.searchEnabled ? '' : 'Web search is not configured; if the user needs it, tell them to add a Tavily or Brave key in Settings.',
    o.memory.length ? `User preferences (from "remember"):\n${o.memory.map(m => `- ${m}`).join('\n')}` : '',
    `Skills (call use_skill to load one):\n${o.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`,
    ...o.loadedSkills.map(s => `The user attached the "${s.title}" skill. Follow it:\n${s.body}`),
  ].filter(Boolean).join('\n\n')
}

export function userTurn(text: string, ctx: { canvas: string; refs: Array<{ nodeId: string; title: string; kind: string; value?: string }>; attachments: Array<{ url: string; kind: string; name?: string }> }) {
  const parts = [`Canvas now:\n${ctx.canvas || '(empty canvas)'}`]
  if (ctx.refs.length) parts.push(`Referenced nodes:\n${ctx.refs.map(r => `- @${r.title} (${r.kind}, id ${r.nodeId})${r.value ? `: ${r.value.slice(0, 500)}` : ''}`).join('\n')}`)
  if (ctx.attachments.length) parts.push(`Attachments (already uploaded; use the url as a reference or ask the user):\n${ctx.attachments.map(a => `- ${a.name ?? a.kind}: ${a.url}`).join('\n')}`)
  parts.push(`Request: ${text}`)
  return parts.join('\n\n')
}
