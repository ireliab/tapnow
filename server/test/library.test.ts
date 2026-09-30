import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { libraryRouter, projectFiles } from '../src/library'
import { createProject, fileFromUrl, getProject, saveBytes, saveProject } from '../src/store'

let base = ''
let server: http.Server
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', libraryRouter)
  server = http.createServer(app)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => server.close())

const json = (method: string, url: string, body?: unknown) =>
  fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json())

describe('project export / import', () => {
  it('round-trips a project with its files under new urls', async () => {
    const img = saveBytes(Buffer.from('fake-png-bytes'), 'image/png')
    const p = createProject('Roundtrip')
    p.nodes = [{ id: 'n1', type: 'canvas', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Pic', outputs: [{ url: img }] } }]
    saveProject(p)
    expect(projectFiles(getProject(p.id)!)).toEqual([img])

    const zipBuf = Buffer.from(await (await fetch(`${base}/projects/${p.id}/export`)).arrayBuffer())
    expect(zipBuf.subarray(0, 2).toString()).toBe('PK')
    const form = new FormData()
    form.append('file', new Blob([zipBuf]), 'x.taplocal.zip')
    const imported = await (await fetch(`${base}/projects/import`, { method: 'POST', body: form })).json()
    expect(imported.name).toBe('Roundtrip (imported)')
    const newUrl = imported.nodes[0].data.outputs[0].url
    expect(newUrl).not.toBe(img)
    expect(fs.readFileSync(fileFromUrl(newUrl), 'utf8')).toBe('fake-png-bytes')
  })
  it('clones a project', async () => {
    const p = createProject('Original')
    const c = await json('POST', `/projects/${p.id}/clone`)
    expect(c.id).not.toBe(p.id)
    expect(c.name).toBe('Original (copy)')
  })
  it('rejects non-exports', async () => {
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('nope')]), 'x.zip')
    const r = await fetch(`${base}/projects/import`, { method: 'POST', body: form })
    expect(r.status).toBe(400)
  })
})

describe('templates, elements, library', () => {
  it('lists public templates and saves / deletes my templates', async () => {
    const before = await json('GET', '/templates')
    expect(before.filter((t: any) => t.source === 'public').length).toBeGreaterThanOrEqual(5)
    const t = await json('POST', '/templates', { name: 'Mine', nodes: [{ ref: 'a', kind: 'text', prompt: 'hi' }], edges: [] })
    expect((await json('GET', '/templates')).some((x: any) => x.id === t.id && x.source === 'mine')).toBe(true)
    await json('DELETE', `/templates/${t.id}`)
    expect((await json('GET', '/templates')).some((x: any) => x.id === t.id)).toBe(false)
    expect((await json('DELETE', '/templates/short-film-storyboard')).error).toMatch(/own templates/)
  })
  it('keeps element names unique', async () => {
    await json('PUT', '/elements', { name: 'Mara', kind: 'character', description: 'courier', refs: [{ url: '/files/x.png', kind: 'image' }, { url: 'http://evil', kind: 'image' }] })
    const all = await json('GET', '/elements')
    expect(all.find((e: any) => e.name === 'Mara').refs).toHaveLength(1)
    expect((await json('PUT', '/elements', { name: 'mara' })).error).toMatch(/already exists/)
  })
  it('saves library items into folders', async () => {
    await json('POST', '/library', { kind: 'text', name: 'Brief', folder: 'Campaign A', text: 'hello' })
    const l = await json('GET', '/library')
    expect(l.folders).toContain('Campaign A')
    expect(l.items[0]).toMatchObject({ name: 'Brief', folder: 'Campaign A' })
  })
})
