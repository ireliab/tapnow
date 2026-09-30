import fs from 'node:fs'
import path from 'node:path'
import { DATA, ROOT } from './store.js'

/**
 * Agent skills (TapNow calls them "Apps"). Each skill is a folder with a SKILL.md:
 *
 *   ---
 *   name: storyboard
 *   description: One line the agent reads to decide when to use it
 *   icon: film
 *   category: creative
 *   inputs: [text, image]
 *   tools: [create_nodes, generate]
 *   offline: true
 *   ---
 *   Markdown instructions loaded into the agent when the skill is used.
 *
 * Built-ins live in server/skills; user skills in data/skills override them by name.
 */
export interface Skill {
  name: string
  title: string
  description: string
  icon: string
  category: 'creative' | 'research' | 'utility'
  inputs: string[]
  tools: string[]
  offline: boolean
  body: string
  source: 'builtin' | 'user'
}

export const BUILTIN_DIR = path.join(ROOT, 'server', 'skills')
export const USER_DIR = path.join(DATA, 'skills')
fs.mkdirSync(USER_DIR, { recursive: true })

const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Minimal frontmatter parser: `key: value`, `key: [a, b]`, booleans. */
export function parseSkill(text: string, fallbackName: string, source: Skill['source']): Skill {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const meta: Record<string, string | string[] | boolean> = {}
  const body = (m ? m[2] : text).trim()
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/)
      if (!kv) continue
      const [, k, raw] = kv
      const v = raw.trim()
      if (v.startsWith('[') && v.endsWith(']')) meta[k] = v.slice(1, -1).split(',').map(unquote).filter(Boolean)
      else if (v === 'true' || v === 'false') meta[k] = v === 'true'
      else meta[k] = unquote(v)
    }
  }
  const str = (k: string, d = '') => (typeof meta[k] === 'string' ? (meta[k] as string) : d)
  const arr = (k: string) => (Array.isArray(meta[k]) ? (meta[k] as string[]) : typeof meta[k] === 'string' && meta[k] ? [meta[k] as string] : [])
  const name = slug(str('name', fallbackName)) || slug(fallbackName)
  const category = str('category', 'creative')
  return {
    name,
    title: str('title', name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    description: str('description'),
    icon: str('icon', 'sparkle'),
    category: (['creative', 'research', 'utility'].includes(category) ? category : 'creative') as Skill['category'],
    inputs: arr('inputs'),
    tools: arr('tools'),
    offline: meta.offline === true,
    body,
    source,
  }
}

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

function loadDir(dir: string, source: Skill['source']): Skill[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => {
    const f = path.join(dir, d.name, 'SKILL.md')
    return fs.existsSync(f) ? [parseSkill(fs.readFileSync(f, 'utf8'), d.name, source)] : []
  })
}

export function listSkills(): Skill[] {
  const map = new Map<string, Skill>()
  for (const s of loadDir(BUILTIN_DIR, 'builtin')) map.set(s.name, s)
  for (const s of loadDir(USER_DIR, 'user')) map.set(s.name, s) // user overrides built-in
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title))
}
export const getSkill = (name: string) => listSkills().find(s => s.name === slug(name))

export function serializeSkill(s: Pick<Skill, 'name' | 'title' | 'description' | 'icon' | 'category' | 'inputs' | 'tools' | 'offline' | 'body'>) {
  const list = (a: string[]) => `[${a.join(', ')}]`
  return `---\nname: ${s.name}\ntitle: ${s.title}\ndescription: ${s.description.replace(/\n/g, ' ')}\nicon: ${s.icon}\ncategory: ${s.category}\ninputs: ${list(s.inputs)}\ntools: ${list(s.tools)}\noffline: ${s.offline}\n---\n\n${s.body.trim()}\n`
}

export function saveUserSkill(input: Partial<Skill> & { name: string }) {
  const name = slug(input.name)
  if (!name) throw new Error('Skill name is required')
  const base = getSkill(name)
  const s = { ...(base ?? parseSkill('', name, 'user')), ...input, name }
  fs.mkdirSync(path.join(USER_DIR, name), { recursive: true })
  fs.writeFileSync(path.join(USER_DIR, name, 'SKILL.md'), serializeSkill(s))
  return getSkill(name)!
}

/** Deletes a user skill (a built-in with the same name becomes visible again). */
export function deleteUserSkill(name: string) {
  const dir = path.join(USER_DIR, slug(name))
  if (!fs.existsSync(dir)) throw new Error('Only user skills can be deleted')
  fs.rmSync(dir, { recursive: true, force: true })
}
