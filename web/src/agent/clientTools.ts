import { nodeValue } from '../graph'
import { useStore, type BatchNode } from '../store'
import { useAgent, type Pending, type PendingBody } from './agentStore'

/**
 * Executes agent tools against the live canvas. Results are plain JSON sent back
 * to the server-side agent loop. `ask_user` and Ask-mode `generate` wait for the
 * user through cards rendered in the chat.
 */
const canvas = () => useStore.getState()

function waitFor<T>(callId: string, p: PendingBody): Promise<T> {
  return new Promise<T>(resolve => {
    useAgent.setState(s => ({ pending: { ...s.pending, [callId]: { ...p, resolve } as Pending } }))
  }).finally(() => useAgent.setState(s => { const { [callId]: _, ...rest } = s.pending; return { pending: rest } })) as Promise<T>
}

/** Map refs from earlier create_nodes calls (and titles) to real node ids. */
function resolveIds(list: unknown): string[] {
  const refMap = useAgent.getState().refMap
  const nodes = canvas().nodes
  return (Array.isArray(list) ? list : [list]).map(String).map(x =>
    refMap[x] ?? nodes.find(n => n.id === x)?.id ?? nodes.find(n => n.data.title.toLowerCase() === x.toLowerCase())?.id ?? x,
  ).filter(id => nodes.some(n => n.id === id))
}

async function confirmThen(callId: string, ids: string[]) {
  if (useAgent.getState().mode !== 'auto') {
    const r = await waitFor<{ approved: boolean }>(callId, { kind: 'confirm', nodeIds: ids })
    if (!r.approved) return { declined: true, message: 'The user declined this generation.' }
  }
  return { results: await canvas().runNodes(ids) }
}

export async function runClientTool(name: string, args: any, callId: string): Promise<unknown> {
  const s = canvas()
  switch (name) {
    case 'get_canvas': {
      const visible = s.nodes.filter(n => !n.hidden)
      return {
        nodes: visible.map(n => ({
          id: n.id, kind: n.data.kind, title: n.data.title, prompt: n.data.prompt.slice(0, 600), model: n.data.model,
          params: n.data.params, outputs: n.data.outputs.length, output: nodeValue(n)?.value?.slice(0, 200), status: n.data.status,
          inputs: s.edges.filter(e => e.target === n.id).map(e => e.source), selected: !!n.selected,
        })),
        edges: s.edges.map(e => ({ from: e.source, to: e.target })),
        selected: visible.filter(n => n.selected).map(n => n.id),
        playlist: s.timeline.map(c => c.nodeId),
      }
    }
    case 'create_nodes': {
      const specs: BatchNode[] = (args.nodes ?? []).filter((n: any) => ['text', 'image', 'video', 'audio'].includes(n?.kind))
        .map((n: any, i: number) => ({ ref: String(n.ref ?? `n${i}`), kind: n.kind, title: n.title, prompt: n.prompt, model: n.model, params: n.params }))
      if (!specs.length) return { error: 'No valid nodes (kind must be text, image, video or audio)' }
      // edges may point at refs from earlier calls in this run
      const refMap = useAgent.getState().refMap
      const edges = (args.edges ?? []).map((e: any) => ({ from: refMap[e.from] ?? String(e.from), to: refMap[e.to] ?? String(e.to) }))
      const r = s.addNodesBatch(specs, edges)
      useAgent.setState(st => ({ refMap: { ...st.refMap, ...r.created } }))
      return { created: r.created, ...(r.skipped.length ? { skipped_edges: r.skipped, note: 'Some connections are not allowed between those node kinds' } : {}) }
    }
    case 'update_node': {
      const [id] = resolveIds(args.node_id)
      const n = s.nodes.find(x => x.id === id)
      if (!n) return { error: `No node ${args.node_id}` }
      s.checkpoint()
      s.updateData(id, {
        ...(args.title !== undefined ? { title: String(args.title) } : {}),
        ...(args.prompt !== undefined ? { prompt: String(args.prompt) } : {}),
        ...(args.model && s.models.some(m => m.id === args.model && m.kind === n.data.kind) ? { model: args.model } : {}),
        ...(args.params ? { params: { ...n.data.params, ...args.params } } : {}),
      })
      return { updated: id }
    }
    case 'connect_nodes': {
      const refMap = useAgent.getState().refMap
      const results = (args.edges ?? []).map((e: any) => {
        const source = refMap[e.from] ?? resolveIds(e.from)[0], target = refMap[e.to] ?? resolveIds(e.to)[0]
        const c = { source, target, sourceHandle: null, targetHandle: null }
        if (!source || !target || !s.isValidConnection(c)) return { from: e.from, to: e.to, ok: false }
        s.onConnect(c)
        return { from: e.from, to: e.to, ok: true }
      })
      return { results }
    }
    case 'delete_nodes': {
      const ids = resolveIds(args.node_ids)
      ids.forEach(id => s.removeNode(id))
      return { deleted: ids }
    }
    case 'generate': {
      const ids = resolveIds(args.node_ids).filter(id => s.nodes.find(n => n.id === id)?.data.kind !== 'text')
      if (!ids.length) return { error: 'No media nodes to generate (text nodes need no generation)' }
      return confirmThen(callId, ids)
    }
    case 'run_all': {
      const ids = s.nodes.filter(n => !n.hidden && n.data.kind !== 'text' && !n.data.outputs.length).map(n => n.id)
      if (!ids.length) return { message: 'Every media node already has an output' }
      return confirmThen(callId, ids)
    }
    case 'add_to_playlist': {
      const ids = resolveIds(args.node_ids).filter(id => ['video', 'image'].includes(s.nodes.find(n => n.id === id)?.data.kind ?? ''))
      ids.forEach(id => s.addToTimeline(id))
      return { added: ids }
    }
    case 'ask_user': {
      const questions = (args.questions ?? []).slice(0, 4).map((q: any) => ({ question: String(q.question ?? q), options: Array.isArray(q.options) ? q.options.map(String) : undefined }))
      if (!questions.length) return { error: 'No questions' }
      return waitFor(callId, { kind: 'ask', questions })
    }
    default:
      return { error: `Unknown client tool ${name}` }
  }
}
