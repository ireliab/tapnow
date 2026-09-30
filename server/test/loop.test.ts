import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveToolResult, runTurn } from '../src/agent/loop'
import { createConversation, getConversation, listOutputs } from '../src/agent/persist'
import type { AgentEvent } from '../src/agent/types'
import { getSettings, saveSettings } from '../src/store'

/**
 * A scripted OpenAI-compatible server: each POST /chat/completions pops the next
 * scripted assistant message, so we can drive the agent loop deterministically.
 */
let script: any[] = []
const seen: any[] = []
let server: http.Server

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake' }] }))
      seen.push(JSON.parse(body))
      res.end(JSON.stringify({ choices: [{ message: script.shift() ?? { content: 'done' } }] }))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const s = getSettings()
  s.llm = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: '', model: 'fake' }
  saveSettings(s)
})
afterAll(() => server.close())

const call = (id: string, name: string, args: any) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

/** Runs a turn, answering client tool calls with `answer(name, args)`. */
async function turn(text: string, answer: (name: string, args: any) => any, mode: 'auto' | 'ask' | 'brainstorm' = 'auto') {
  const conv = createConversation('p1', { mode })
  const events: AgentEvent[] = []
  let runId = ''
  await runTurn(conv, { text, attachments: [], refs: [], skills: [], canvas: '(empty)' }, e => {
    events.push(e)
    if (e.type === 'run') runId = e.runId
    if (e.type === 'tool_call' && e.client) setTimeout(() => resolveToolResult(runId, e.callId, answer(e.name, e.args)), 5)
  })
  return { conv: getConversation('p1', conv.id)!, events }
}

describe('agent loop (tool calling)', () => {
  it('executes client tools, feeds results back and finishes with text', async () => {
    script = [
      { content: 'Planning.', tool_calls: [call('c1', 'create_nodes', { nodes: [{ ref: 'a', kind: 'image', prompt: 'fox' }] })] },
      { content: null, tool_calls: [call('c2', 'generate', { node_ids: ['a'] })] },
      { content: 'All set.' },
    ]
    const { conv, events } = await turn('make a fox', name => (name === 'create_nodes' ? { created: { a: 'image-1' } } : { results: [{ id: 'image-1', status: 'done' }] }))
    expect(events.filter(e => e.type === 'tool_call').map((e: any) => e.name)).toEqual(['create_nodes', 'generate'])
    expect(events.filter(e => e.type === 'text').map((e: any) => e.text)).toEqual(['Planning.', 'All set.'])
    expect(events.at(-1)).toEqual({ type: 'done' })
    const toolMsg = conv.llm.find(m => m.role === 'tool' && m.tool_call_id === 'c1')
    expect(JSON.parse(toolMsg!.content!)).toEqual({ created: { a: 'image-1' } })
    expect(conv.display.filter(d => d.type === 'tool').every((d: any) => d.status === 'done')).toBe(true)
    // the system prompt advertises skills and tools were sent
    expect(seen.at(-1).messages[0].content).toContain('storyboard:')
    expect(seen.at(-1).tools.map((t: any) => t.function.name)).toContain('create_nodes')
  })

  it('runs server tools (use_skill, save_output) without the client', async () => {
    script = [
      { content: null, tool_calls: [call('s1', 'use_skill', { name: 'storyboard' }), call('s2', 'save_output', { title: 'Brief', content: '# Hi' })] },
      { content: 'Saved.' },
    ]
    const { conv, events } = await turn('brief please', () => ({}))
    const skillResult = JSON.parse(conv.llm.find(m => m.tool_call_id === 's1')!.content!)
    expect(skillResult.instructions).toContain('create_nodes')
    expect(events.some(e => e.type === 'output')).toBe(true)
    expect(listOutputs('p1').map(o => o.title)).toContain('Brief')
  })

  it('brainstorm mode withholds generation tools', async () => {
    script = [{ content: 'Options…' }]
    await turn('ideas', () => ({}), 'brainstorm')
    const names = seen.at(-1).tools.map((t: any) => t.function.name)
    expect(names).not.toContain('generate')
    expect(names).toContain('ask_user')
  })

  it('reports malformed tool results as errors but keeps going', async () => {
    script = [{ content: null, tool_calls: [call('w1', 'web_search', { query: 'x' })] }, { content: 'ok' }]
    const { conv } = await turn('search', () => ({}))
    const r = JSON.parse(conv.llm.find(m => m.tool_call_id === 'w1')!.content!)
    expect(r.error).toMatch(/not configured/)
    expect(conv.display.at(-1)).toMatchObject({ type: 'assistant', text: 'ok' })
  })
})
