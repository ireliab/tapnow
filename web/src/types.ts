import type { Edge, Node } from '@xyflow/react'

export type NodeKind = 'text' | 'image' | 'video' | 'audio'

export interface Asset {
  id: string; url: string; kind: 'image' | 'video' | 'audio'; mime: string; name?: string
  prompt?: string; model?: string; createdAt: number
}

/** One entry in a node's generation history. Text nodes store `text`; media nodes store `url`. */
export interface Output { id: string; kind: NodeKind; url?: string; mime?: string; text?: string; prompt?: string; model?: string; createdAt: number }

export interface NodeParams { aspect?: string; duration?: number; seed?: number; voice?: string; negative?: string }

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
}

export type CanvasNode = Node<CanvasNodeData>
export type CanvasEdge = Edge

export interface TimelineClip { id: string; nodeId: string }

export interface Project {
  id: string; name: string; updatedAt: number
  nodes: CanvasNode[]; edges: CanvasEdge[]; timeline: TimelineClip[]
  viewport?: { x: number; y: number; zoom: number }
}

export interface ProjectMeta { id: string; name: string; updatedAt: number; nodeCount: number; thumb?: string }

export interface ModelInfo {
  id: string; name: string; provider: string; kind: NodeKind; maxImages: number; requiresImage?: boolean
  aspects?: string[]; durations?: number[]; available: boolean; reason?: string
}

export interface Job {
  id: string; nodeId: string; model: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number; message?: string; error?: string; result?: { asset?: Asset; text?: string }
}

export interface Settings {
  llm: { baseUrl: string; apiKey: string; model: string }
  openai: { baseUrl: string; apiKey: string }
  fal: { apiKey: string }
  comfyui: { url: string; imageWorkflow: string; videoWorkflow: string }
  customModels: Array<{ id: string; name: string; provider: 'fal'; kind: 'image' | 'video'; imageField?: string }>
}

export interface Shot { title: string; image_prompt: string; motion_prompt: string; duration: number }
export interface AgentReply { reply: string; storyboard?: { style: string; shots: Shot[] }; source: 'llm' | 'offline' }
