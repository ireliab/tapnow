import type { Edge, Node } from '@xyflow/react'

export type NodeKind = 'text' | 'image' | 'video' | 'audio'

export interface Asset {
  id: string; url: string; kind: 'image' | 'video' | 'audio'; mime: string; name?: string
  prompt?: string; model?: string; createdAt: number
}

/** One entry in a node's generation history. Text nodes store `text`; media nodes store `url`. */
export interface Output { id: string; kind: NodeKind; url?: string; mime?: string; text?: string; prompt?: string; model?: string; createdAt: number }

export interface NodeParams {
  aspect?: string; duration?: number; seed?: number; voice?: string; negative?: string; count?: number
  /** speech */
  speed?: number; pitch?: number; audioMode?: 'speech' | 'music' | 'sfx'
  /** editing tools: inpaint mask url and tool settings */
  mask?: string; tool?: Record<string, unknown>
}

export interface CanvasNodeData extends Record<string, unknown> {
  kind: NodeKind
  title: string
  /** text nodes: the content; media nodes: the generation prompt */
  prompt: string
  model: string
  params: NodeParams
  outputs: Output[]
  active: number
  status: 'idle' | 'queued' | 'running' | 'done' | 'error'
  progress?: number
  message?: string
  error?: string
  jobId?: string
  /** colour pin (organisation) */
  pin?: string
  /** text nodes: background colour */
  bg?: string
  /** set while the node is collapsed into a stack */
  stackId?: string
  /** node produced by an editing tool (upscale, cutout, inpaint, relight) — its composer offers that tool's models */
  tool?: string
}

export type CanvasNode = Node<CanvasNodeData>

// ---------- non-media canvas nodes ("extras") ----------
export interface GroupData extends Record<string, unknown> { title: string; color: string }
export interface StackData extends Record<string, unknown> { title: string; members: string[] }
export interface CommentReply { id: string; text: string; at: number }
export interface CommentData extends Record<string, unknown> { text: string; author: string; at: number; replies: CommentReply[] }
export interface PlaylistClip { id: string; nodeId: string; in: number; out?: number }
export interface PlaylistData extends Record<string, unknown> { title: string; clips: PlaylistClip[] }
export type GroupNode = Node<GroupData, 'group'>
export type StackNode = Node<StackData, 'stack'>
export type CommentNode = Node<CommentData, 'comment'>
export type PlaylistNode = Node<PlaylistData, 'playlist'>
export type ExtraNode = GroupNode | StackNode | CommentNode | PlaylistNode
export type AnyNode = CanvasNode | ExtraNode
export type CanvasEdge = Edge

export interface TimelineClip { id: string; nodeId: string }

export interface Project {
  id: string; name: string; updatedAt: number
  nodes: CanvasNode[]; edges: CanvasEdge[]; timeline: TimelineClip[]; extras?: ExtraNode[]
  viewport?: { x: number; y: number; zoom: number }
}

export interface LibraryItem { id: string; kind: 'image' | 'video' | 'audio' | 'text'; name: string; folder: string; url?: string; mime?: string; text?: string; prompt?: string; createdAt: number }
export interface ElementItem { id: string; name: string; kind: 'character' | 'product' | 'brand' | 'other'; description: string; refs: Array<{ url: string; kind: string }>; createdAt: number; updatedAt: number }
export interface TemplateNode { ref: string; kind: NodeKind; title?: string; prompt?: string; model?: string; params?: NodeParams; x?: number; y?: number; outputs?: Output[] }
export interface Template { id: string; name: string; description: string; category: string; source: 'public' | 'mine'; nodes: TemplateNode[]; edges: Array<{ from: string; to: string }>; createdAt?: number }

export interface ProjectMeta { id: string; name: string; updatedAt: number; nodeCount: number; thumb?: string }

export interface ModelInfo {
  id: string; name: string; provider: string; kind: NodeKind; maxImages: number; requiresImage?: boolean
  aspects?: string[]; durations?: number[]; available: boolean; reason?: string
  tool?: string; audioMode?: 'speech' | 'music' | 'sfx'; needs?: Array<'video' | 'audio'>
  /** shown in dropdowns (Settings → Models); hidden models still run on nodes that use them */
  enabled?: boolean; paid?: boolean
  /** fal price from the last key check */
  price?: string
  /** found by a provider check (e.g. extra OpenAI models) */
  discovered?: boolean
  extra?: Record<string, any>
}

export interface Job {
  id: string; nodeId: string; model: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number; message?: string; error?: string; result?: { asset?: Asset; assets?: Asset[]; text?: string }
}

export interface Settings {
  llm: { baseUrl: string; apiKey: string; model: string }
  openai: { baseUrl: string; apiKey: string }
  fal: { apiKey: string }
  comfyui: { url: string; imageWorkflow: string; videoWorkflow: string }
  search: { provider: 'tavily' | 'brave'; apiKey: string }
  customModels: CustomModel[]
  modelPrefs: Record<string, boolean>
  providerStatus: Partial<Record<ProviderKey, ProviderStatus>>
}
export interface CustomModel { id: string; name: string; provider: 'fal'; kind: 'image' | 'video' | 'audio'; imageField?: string; tool?: string }
export type ProviderKey = 'llm' | 'comfyui' | 'fal' | 'openai' | 'search'
export type CheckStatus = 'valid' | 'invalid' | 'unreachable' | 'warning' | 'unverified' | 'missing'
export interface ProviderStatus {
  status: CheckStatus; message: string; details?: string[]; fp?: string; checkedAt: number
  models?: string[]; prices?: Record<string, string>; notFound?: string[]
}
export interface FalSearchResult { id: string; name: string; category: string; description: string; thumb?: string }
