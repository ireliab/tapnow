import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteUserSkill, getSkill, listSkills, parseSkill, saveUserSkill, USER_DIR } from '../src/skills'

describe('parseSkill', () => {
  it('reads frontmatter scalars, lists and booleans', () => {
    const s = parseSkill(`---\nname: My Skill\ndescription: "Does things"\ninputs: [text, image]\ntools: [create_nodes]\noffline: true\n---\n\nBody **here**`, 'x', 'user')
    expect(s).toMatchObject({ name: 'my-skill', title: 'My Skill', description: 'Does things', inputs: ['text', 'image'], tools: ['create_nodes'], offline: true, body: 'Body **here**' })
  })
  it('falls back to the folder name and treats a file without frontmatter as body', () => {
    const s = parseSkill('Just instructions', 'folder-name', 'builtin')
    expect(s.name).toBe('folder-name')
    expect(s.body).toBe('Just instructions')
    expect(s.category).toBe('creative')
  })
})

describe('skill loading', () => {
  it('ships the built-in skills', () => {
    const names = listSkills().map(s => s.name)
    for (const n of ['storyboard', 'brainstorm', 'script-to-scenes', 'product-shots', 'character-sheet', 'multilingual-dub', 'ad-campaign', 'web-research', 'explain-canvas'])
      expect(names).toContain(n)
  })
  it('lets a user skill override a built-in and restores it on delete', () => {
    saveUserSkill({ name: 'storyboard', description: 'custom version', body: 'mine' })
    expect(getSkill('storyboard')).toMatchObject({ source: 'user', description: 'custom version', body: 'mine' })
    deleteUserSkill('storyboard')
    expect(getSkill('storyboard')?.source).toBe('builtin')
    expect(fs.existsSync(path.join(USER_DIR, 'storyboard'))).toBe(false)
  })
  it('refuses to delete built-ins', () => {
    expect(() => deleteUserSkill('brainstorm')).toThrow()
  })
})
