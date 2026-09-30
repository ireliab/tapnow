export type AgentMode = 'auto' | 'ask' | 'brainstorm'
export type Thinking = 'off' | 'light' | 'standard' | 'heavy'

/** OpenAI chat-completions message shape (what we send to the LLM). */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface Attachment { url: string; kind: string; name?: string }
export interface NodeRef { nodeId: string; title: string; kind: string; value?: string }

/** What the chat UI renders. `llmStart` on user items lets us branch a conversation. */
export type DisplayItem =
  | { type: 'user'; text: string; attachments?: Attachment[]; refs?: NodeRef[]; skills?: string[]; llmStart: number; at: number }
  | { type: 'assistant'; text: string; at: number }
  | { type: 'tool'; callId: string; name: string; args: any; result?: any; status: 'running' | 'done' | 'error'; at: number }
  | { type: 'error'; text: string; at: number }

export interface Conversation {
  id: string
  projectId: string
  title: string
  model: string
  thinking: Thinking
  mode: AgentMode
  createdAt: number
  updatedAt: number
  display: DisplayItem[]
  llm: LlmMessage[]
}

export interface AgentOutput {
  id: string; projectId: string; title: string; content: string
  status: 'draft' | 'review' | 'approved'; createdAt: number; updatedAt: number
}

/** Events streamed to the client over SSE. */
export type AgentEvent =
  | { type: 'run'; runId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; callId: string; name: string; args: any; client: boolean }
  | { type: 'tool_result'; callId: string; name: string; result: any; error?: boolean }
  | { type: 'output'; output: AgentOutput }
  | { type: 'title'; title: string }
  | { type: 'error'; error: string }
  | { type: 'done' }
