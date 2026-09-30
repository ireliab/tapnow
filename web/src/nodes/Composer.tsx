import { useMemo, useRef, useState } from 'react'
import { resolveInputs, upstreamOf } from '../graph'
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
  // tool nodes (enhance, cutout, …) offer that tool's models; audio nodes filter by mode
  const audioMode = data.params.audioMode ?? models.find(m => m.id === data.model)?.audioMode ?? 'speech'
  const kindModels = models.filter(m => m.kind === data.kind && (data.tool ? m.tool === data.tool : !m.tool)
    && (data.kind !== 'audio' || !m.audioMode || m.audioMode === audioMode))
  const model = kindModels.find(m => m.id === data.model)
  const busy = data.status === 'queued' || data.status === 'running'
  const setParam = (p: Partial<NodeParams>) => updateData(id, { params: { ...data.params, ...p } })
  const groups = [...new Set(kindModels.map(m => m.provider))]
  // @mentions of connected upstream nodes (TapNow-style references)
  const upstream = useMemo(() => upstreamOf(id, nodes, edges), [id, nodes, edges])
  const ta = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  const candidates = mention ? upstream.filter(n => n.data.title.toLowerCase().includes(mention.q.toLowerCase())) : []
  const onPrompt = (v: string, caret: number) => {
    updateData(id, { prompt: v })
    const m = v.slice(0, caret).match(/(^|\s)@([^\s@]*)$/)
    setMention(m && upstream.length ? { q: m[2], at: caret - m[2].length - 1 } : null)
  }
  const pick = (title: string) => {
    if (!mention) return
    const end = mention.at + 1 + mention.q.length
    updateData(id, { prompt: data.prompt.slice(0, mention.at) + '@' + title + ' ' + data.prompt.slice(end) })
    setMention(null)
    requestAnimationFrame(() => ta.current?.focus())
  }

  const inputChips = [
    inputs.texts.length && `${inputs.texts.length} text`,
    inputs.images.length && `${inputs.images.length} image${inputs.images.length > 1 ? 's' : ''}`,
    inputs.videos.length && `${inputs.videos.length} video`,
    inputs.audios.length && `${inputs.audios.length} audio`,
  ].filter(Boolean)
  const needsWarning = model?.needs?.filter(k => !(k === 'video' ? inputs.videos : inputs.audios).length).map(k => `${model.name} needs a connected ${k}`).join(' · ')
  const setAudioMode = (m: 'speech' | 'music' | 'sfx') => {
    const first = models.find(x => x.kind === 'audio' && x.audioMode === m && x.available && x.provider !== 'mock') ?? models.find(x => x.kind === 'audio' && x.audioMode === m && x.available)
    updateData(id, { params: { ...data.params, audioMode: m, duration: first?.durations?.[0] }, ...(first ? { model: first.id } : {}) })
  }
  const imageWarning = model && inputs.images.length > model.maxImages
    ? model.maxImages ? `${model.name} uses only the first ${model.maxImages} image(s)` : `${model.name} ignores image inputs`
    : model?.requiresImage && !inputs.images.length ? `${model.name} needs a connected image` : ''

  return (
    <div className="composer nodrag nowheel" style={{ transform: `translateX(-50%) scale(${Math.min(2.5, Math.max(1, 1 / zoom))})` }}
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(id) } }}>
      {data.kind !== 'text' && (
        <div className="composer-prompt">
          <textarea ref={ta} autoFocus value={data.prompt} rows={3}
            placeholder={(data.kind === 'video' ? 'Describe the motion, camera and action…' : data.kind === 'audio' ? 'Text to speak…' : 'Describe the image…') + (upstream.length ? '  Type @ to reference an input' : '')}
            onChange={e => onPrompt(e.target.value, e.target.selectionStart)}
            onKeyDown={e => { if (mention && candidates[0] && (e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey) { e.preventDefault(); pick(candidates[0].data.title) } if (e.key === 'Escape') setMention(null) }} />
          {mention && candidates.length > 0 && (
            <div className="mention-pop down">
              {candidates.map(n => <button key={n.id} onMouseDown={e => { e.preventDefault(); pick(n.data.title) }}><Icon name={n.data.kind} size={12} /> {n.data.title}</button>)}
            </div>
          )}
        </div>
      )}
      {data.kind === 'audio' && (
        <div className="composer-row audio-mode">
          <div className="seg small">{(['speech', 'music', 'sfx'] as const).map(m => <button key={m} className={audioMode === m ? 'on' : ''} onClick={() => setAudioMode(m)}>{m === 'sfx' ? 'Sound FX' : m}</button>)}</div>
          {audioMode === 'speech' && <>
            <label className="mini">Speed {(data.params.speed ?? 1).toFixed(1)}×<input type="range" min={0.5} max={2} step={0.1} value={data.params.speed ?? 1} onChange={e => setParam({ speed: Number(e.target.value) })} /></label>
            <label className="mini">Pitch {data.params.pitch ?? 0}<input type="range" min={-12} max={12} step={1} value={data.params.pitch ?? 0} onChange={e => setParam({ pitch: Number(e.target.value) })} /></label>
          </>}
        </div>
      )}
      {data.kind === 'video' && !data.tool && (
        <div className="camera-chips">
          {['static camera', 'slow dolly-in', 'dolly-out', 'orbit left', 'crane up', 'tracking shot', 'handheld', 'whip pan', 'zoom in'].map(c => (
            <button key={c} onClick={() => updateData(id, { prompt: data.prompt.includes(c) ? data.prompt : `${data.prompt.trim()}${data.prompt.trim() ? ', ' : ''}${c}` })}>{c}</button>
          ))}
        </div>
      )}
      {(inputChips.length > 0 || imageWarning || needsWarning) && (
        <div className="composer-inputs">
          {inputChips.length > 0 && <span className="chip ghost">Inputs: {inputChips.join(' · ')}</span>}
          {data.kind === 'video' && inputs.images.length > 1 && model && model.maxImages > 1 && <span className="chip ghost">first + last frame</span>}
          {imageWarning && <span className="chip warn">{imageWarning}</span>}
          {needsWarning && <span className="chip warn">{needsWarning}</span>}
          {data.tool && <span className="chip skill">tool · {data.tool}</span>}
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
        {data.kind !== 'text' && (
          <select value={data.params.count ?? 1} title="Outputs per run" onChange={e => setParam({ count: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(c => <option key={c} value={c}>×{c}</option>)}
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
