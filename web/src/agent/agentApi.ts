import type { AgentEvent, AgentOutput, Conversation, ConversationMeta, NodeRef, Skill, Thinking, AgentMode, Attachment } from './types'

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data as T
}
const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`

export const agentApi = {
  conversations: (projectId: string) => req<ConversationMeta[]>('GET', `/api/agent/conversations?${q(projectId)}`),
  createConversation: (projectId: string, o: { model?: string; thinking?: Thinking; mode?: AgentMode }) =>
    req<Conversation>('POST', `/api/agent/conversations?${q(projectId)}`, o),
  conversation: (projectId: string, id: string) => req<Conversation>('GET', `/api/agent/conversations/${id}?${q(projectId)}`),
  patchConversation: (projectId: string, id: string, patch: Partial<ConversationMeta>) =>
    req<Conversation>('PATCH', `/api/agent/conversations/${id}?${q(projectId)}`, patch),
  branch: (projectId: string, id: string, at: number) => req<Conversation>('POST', `/api/agent/conversations/${id}/branch?${q(projectId)}`, { at }),
  deleteConversation: (projectId: string, id: string) => req('DELETE', `/api/agent/conversations/${id}?${q(projectId)}`),
  toolResult: (runId: string, callId: string, result: unknown) => req('POST', `/api/agent/runs/${runId}/tool-result`, { callId, result }),
  cancel: (runId: string) => req('POST', `/api/agent/runs/${runId}/cancel`),
  llmModels: () => req<{ default: string; models: string[]; reachable: boolean }>('GET', '/api/agent/llm-models'),
  memory: () => req<string[]>('GET', '/api/agent/memory'),
  saveMemory: (items: string[]) => req<string[]>('PUT', '/api/agent/memory', items),
  outputs: (projectId: string) => req<AgentOutput[]>('GET', `/api/agent/outputs?${q(projectId)}`),
  saveOutput: (projectId: string, o: Partial<AgentOutput>) =>
    o.id ? req<AgentOutput>('PUT', `/api/agent/outputs/${o.id}?${q(projectId)}`, o) : req<AgentOutput>('POST', `/api/agent/outputs?${q(projectId)}`, o),
  deleteOutput: (projectId: string, id: string) => req('DELETE', `/api/agent/outputs/${id}?${q(projectId)}`),
  skills: () => req<Skill[]>('GET', '/api/skills'),
  saveSkill: (s: Partial<Skill> & { name: string }) => req<Skill>('PUT', `/api/skills/${encodeURIComponent(s.name)}`, s),
  deleteSkill: (name: string) => req('DELETE', `/api/skills/${encodeURIComponent(name)}`),
}

/** POST a message and yield the SSE events of the agent run. */
export async function* sendMessage(projectId: string, convId: string, body: {
  text: string; refs: NodeRef[]; attachments: Attachment[]; skills: string[]; canvas: string
}, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch(`/api/agent/conversations/${convId}/messages?${q(projectId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Agent ${res.status}`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
      if (data) yield JSON.parse(data) as AgentEvent
    }
  }
}
