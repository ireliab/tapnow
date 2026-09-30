export type AgentMode = 'auto' | 'ask' | 'brainstorm'
export type Thinking = 'off' | 'light' | 'standard' | 'heavy'

export interface Attachment { url: string; kind: string; name?: string }
export interface NodeRef { nodeId: string; title: string; kind: string; value?: string }

export type DisplayItem =
  | { type: 'user'; text: string; attachments?: Attachment[]; refs?: NodeRef[]; skills?: string[]; llmStart?: number; at: number }
  | { type: 'assistant'; text: string; at: number }
  | { type: 'tool'; callId: string; name: string; args: any; result?: any; status: 'running' | 'done' | 'error'; at: number }
  | { type: 'error'; text: string; at: number }

export interface ConversationMeta {
  id: string; projectId: string; title: string; model: string; thinking: Thinking; mode: AgentMode
  createdAt: number; updatedAt: number; messageCount?: number
}
export interface Conversation extends ConversationMeta { display: DisplayItem[] }

export interface AgentOutput {
  id: string; projectId: string; title: string; content: string
  status: 'draft' | 'review' | 'approved'; createdAt: number; updatedAt: number
}

export interface Skill {
  name: string; title: string; description: string; icon: string
  category: 'creative' | 'research' | 'utility'; inputs: string[]; tools: string[]
  offline: boolean; body: string; source: 'builtin' | 'user'
}

export type AgentEvent =
  | { type: 'run'; runId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; callId: string; name: string; args: any; client: boolean }
  | { type: 'tool_result'; callId: string; name: string; result: any; error?: boolean }
  | { type: 'output'; output: AgentOutput }
  | { type: 'title'; title: string }
  | { type: 'error'; error: string }
  | { type: 'done' }
