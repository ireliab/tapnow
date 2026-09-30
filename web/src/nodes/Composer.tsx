import { useMemo } from 'react'
import { resolveInputs } from '../graph'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { CanvasNodeData, NodeParams } from '../types'

const PROVIDER_LABEL: Record<string, string> = { mock: 'Offline (mock)', llm: 'Local LLM', comfyui: 'ComfyUI (local)', openai: 'OpenAI', fal: 'fal.ai' }
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']

/** Prompt bar that docks under the selected node. */
export function Composer({ id, data, zoom }: { id: string; data: CanvasNodeData; zoom: number }) {
  const models = useStore(s => s.models)
  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const { updateData, generate, cancel } = useStore.getState()
  const inputs = useMemo(() => resolveInputs(id, nodes, edges), [id, nodes, edges])
  const kindModels = models.filter(m => m.kind === data.kind)
  const model = kindModels.find(m => m.id === data.model)
  const busy = data.status === 'queued' || data.status === 'running'
  const setParam = (p: Partial<NodeParams>) => updateData(id, { params: { ...data.params, ...p } })
  const groups = [...new Set(kindModels.map(m => m.provider))]

  const inputChips = [
    inputs.texts.length && `${inputs.texts.length} text`,
    inputs.images.length && `${inputs.images.length} image${inputs.images.length > 1 ? 's' : ''}`,
    inputs.videos.length && `${inputs.videos.length} video`,
    inputs.audios.length && `${inputs.audios.length} audio`,
  ].filter(Boolean)
  const imageWarning = model && inputs.images.length > model.maxImages
    ? model.maxImages ? `${model.name} uses only the first ${model.maxImages} image(s)` : `${model.name} ignores image inputs`
    : model?.requiresImage && !inputs.images.length ? `${model.name} needs a connected image` : ''

  return (
    <div className="composer nodrag nowheel" style={{ transform: `translateX(-50%) scale(${Math.min(2.5, Math.max(1, 1 / zoom))})` }}
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(id) } }}>
      {data.kind !== 'text' && (
        <textarea autoFocus value={data.prompt} rows={3}
          placeholder={data.kind === 'video' ? 'Describe the motion, camera and action…' : data.kind === 'audio' ? 'Text to speak…' : 'Describe the image…'}
          onChange={e => updateData(id, { prompt: e.target.value })} />
      )}
      {(inputChips.length > 0 || imageWarning) && (
        <div className="composer-inputs">
          {inputChips.length > 0 && <span className="chip ghost">Inputs: {inputChips.join(' · ')}</span>}
          {data.kind === 'video' && inputs.images.length > 1 && model && model.maxImages > 1 && <span className="chip ghost">first + last frame</span>}
          {imageWarning && <span className="chip warn">{imageWarning}</span>}
        </div>
      )}
      <div className="composer-row">
        <select value={data.model} onChange={e => updateData(id, { model: e.target.value })} title={model?.reason}>
          {groups.map(g => (
            <optgroup key={g} label={PROVIDER_LABEL[g] ?? g}>
              {kindModels.filter(m => m.provider === g).map(m => (
                <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{m.available ? '' : ' — setup needed'}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {model?.aspects && (
          <select value={data.params.aspect ?? model.aspects[0]} onChange={e => setParam({ aspect: e.target.value })}>
            {model.aspects.map(a => <option key={a}>{a}</option>)}
          </select>
        )}
        {model?.durations && (
          <select value={data.params.duration ?? model.durations[0]} onChange={e => setParam({ duration: Number(e.target.value) })}>
            {model.durations.map(d => <option key={d} value={d}>{d}s</option>)}
          </select>
        )}
        {data.kind === 'audio' && model?.provider === 'openai' && (
          <select value={data.params.voice ?? 'alloy'} onChange={e => setParam({ voice: e.target.value })}>
            {VOICES.map(v => <option key={v}>{v}</option>)}
          </select>
        )}
        {data.kind !== 'text' && data.kind !== 'audio' && (
          <input className="seed" placeholder="seed" value={data.params.seed ?? ''} title="Seed (blank = random)"
            onChange={e => setParam({ seed: e.target.value === '' ? undefined : Number(e.target.value.replace(/\D/g, '')) })} />
        )}
        <div className="spacer" />
        {busy ? (
          <button className="btn danger" onClick={() => cancel(id)}><Icon name="stop" size={14} /> Cancel</button>
        ) : (
          <button className="btn primary" onClick={() => generate(id)} disabled={!model?.available} title="Ctrl+Enter">
            <Icon name="sparkle" size={14} /> {data.kind === 'text' ? 'Expand' : data.outputs.length ? 'Regenerate' : 'Generate'}
          </button>
        )}
      </div>
    </div>
  )
}
