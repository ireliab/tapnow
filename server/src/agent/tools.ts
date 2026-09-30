import type { AgentMode } from './types.js'

/**
 * Agent tool definitions (OpenAI function-calling format).
 * `client: true` tools are executed in the browser against the live canvas;
 * the rest run on the server.
 */
interface ToolDef { name: string; description: string; client: boolean; parameters: Record<string, any> }

const nodeKind = { type: 'string', enum: ['text', 'image', 'video', 'audio'] }
const params = {
  type: 'object',
  description: 'Generation settings',
  properties: {
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    duration: { type: 'number', description: 'Seconds (video)' },
    count: { type: 'number', description: 'Outputs per run, 1-4' },
  },
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_canvas', client: true,
    description: 'Read the current canvas: every node (id, kind, title, prompt, model, output count), connections, and which nodes the user has selected.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_nodes', client: true,
    description: 'Add nodes and connections to the canvas in one step. Give each new node a short `ref` so edges can point at it; edges may also use existing node ids. Upstream text feeds downstream prompts; image outputs become references (for video: first frame, then last frame). Layout is automatic.',
    parameters: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object', required: ['ref', 'kind'],
            properties: {
              ref: { type: 'string' }, kind: nodeKind, title: { type: 'string' },
              prompt: { type: 'string', description: 'Text node: its content. Media node: generation prompt.' },
              model: { type: 'string', description: 'Model id from the available list; omit for default' },
              params,
            },
          },
        },
        edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'update_node', client: true,
    description: 'Change an existing node\'s title, prompt/content, model or params.',
    parameters: {
      type: 'object', required: ['node_id'],
      properties: { node_id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, params },
    },
  },
  {
    name: 'connect_nodes', client: true,
    description: 'Connect existing nodes (upstream → downstream).',
    parameters: { type: 'object', required: ['edges'], properties: { edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } } } },
  },
  {
    name: 'delete_nodes', client: true,
    description: 'Delete nodes from the canvas. Only when the user asked for it.',
    parameters: { type: 'object', required: ['node_ids'], properties: { node_ids: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'generate', client: true,
    description: 'Generate media for the given nodes (their upstream nodes are generated first when needed). Returns each node\'s status and output. In Ask mode the user reviews model/size/duration/count first and may decline.',
    parameters: { type: 'object', required: ['node_ids'], properties: { node_ids: { type: 'array', items: { type: 'string' }, description: 'Node ids or refs from create_nodes' } } },
  },
  {
    name: 'run_all', client: true,
    description: 'Generate every media node on the canvas that has no output yet, in dependency order.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'add_to_playlist', client: true,
    description: 'Append video or image nodes, in order, to the project playlist (the edit that gets exported).',
    parameters: { type: 'object', required: ['node_ids'], properties: { node_ids: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'ask_user', client: true,
    description: 'Ask the user up to 4 short questions at once (each optionally with choices) and wait for the answers. Use when essential details are missing or to let the user pick between options.',
    parameters: {
      type: 'object', required: ['questions'],
      properties: {
        questions: {
          type: 'array', maxItems: 4,
          items: { type: 'object', required: ['question'], properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } },
        },
      },
    },
  },
  {
    name: 'web_search', client: false,
    description: 'Search the public web. Returns titles, links, snippets and dates. Always cite links you use.',
    parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, max_results: { type: 'number' } } },
  },
  {
    name: 'use_skill', client: false,
    description: 'Load the full instructions of a skill from the skills list, then follow them.',
    parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  },
  {
    name: 'remember', client: false,
    description: 'Save a lasting user preference (e.g. "default aspect 9:16", "always ask before generating video") for future conversations. Only when the user asks you to remember something.',
    parameters: { type: 'object', required: ['preference'], properties: { preference: { type: 'string' } } },
  },
  {
    name: 'save_output', client: false,
    description: 'Save a document (creative brief, script, scene list, research summary) to the project\'s Outputs panel as markdown.',
    parameters: {
      type: 'object', required: ['title', 'content'],
      properties: { title: { type: 'string' }, content: { type: 'string' }, status: { type: 'string', enum: ['draft', 'review', 'approved'] } },
    },
  },
]

const GENERATION = new Set(['generate', 'run_all'])
export const isClientTool = (name: string) => TOOLS.find(t => t.name === name)?.client ?? false

/** Tool list for a mode, optionally restricted to a skill's allowlist (always keeping the basics). */
export function toolsFor(mode: AgentMode, allow?: string[]) {
  const base = new Set(['get_canvas', 'ask_user', 'use_skill', 'remember', 'save_output'])
  return TOOLS
    .filter(t => mode !== 'brainstorm' || !GENERATION.has(t.name))
    .filter(t => !allow?.length || allow.includes(t.name) || base.has(t.name))
    .map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
}
