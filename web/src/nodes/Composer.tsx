import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { activeOutput, resolveInputs, upstreamOf } from '../graph'
import { Icon } from '../icons'
import { plainText } from '../markdown'
import { capability } from '../panels/settings/ModelList'
import { startVoice, stopVoice } from '../panels/Shortcuts'
import { NODE_WIDTH, shown, useStore } from '../store'
import type { CanvasNode, CanvasNodeData, ModelInfo, NodeKind, NodeParams } from '../types'

const PROVIDER_LABEL: Record<string, string> = { mock: 'Offline (mock)', llm: 'Local LLM', comfyui: 'ComfyUI (local)', openai: 'OpenAI', fal: 'fal.ai' }
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const CAMERA = ['static camera', 'slow dolly-in', 'dolly-out', 'orbit left', 'crane up', 'tracking shot', 'handheld', 'whip pan', 'zoom in']
const AUDIO_MODES = [['speech', 'Speech'], ['music', 'Music'], ['sfx', 'Sound FX']] as const

type Pop = 'model' | 'aspect' | 'duration' | 'camera' | 'mode' | 'settings' | 'count' | 'add' | null

/** Small aspect-ratio glyph for the aspect chip. */
function AspectGlyph({ a }: { a: string }) {
  const [w, h] = a.split(':').map(Number)
  const s = 12 / Math.max(w, h)
  return <i className="aspect-glyph" style={{ width: w * s, height: h * s }} />
}

function ModelPicker({ models, value, onPick, onClose }: { models: ModelInfo[]; value: string; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = models.filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()))
  const groups = [...new Set(list.map(m => m.provider))]
  return (
    <div className="cmp-pop cmp-models">
      {models.length > 7 && <div className="cmp-search"><Icon name="search" size={13} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search models" onKeyDown={e => e.key === 'Escape' && onClose()} /></div>}
      <div className="cmp-model-list">
        {groups.map(g => (
          <div key={g}>
            <div className="cmp-pop-label">{PROVIDER_LABEL[g] ?? g}</div>
            {list.filter(m => m.provider === g).map(m => (
              <button key={m.id} className={`cmp-model ${m.id === value ? 'on' : ''}`} disabled={!m.available} title={m.reason}
                onClick={() => { onPick(m.id); onClose() }}>
                <span className="n">{m.name}{shown(m) ? '' : ' (hidden)'}</span>
                <span className="d">{m.available ? capability(m) : m.reason}</span>
                {m.id === value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        ))}
        {!list.length && <p className="muted pad">No models match.</p>}
      </div>
      <button className="cmp-manage" onClick={() => { try { sessionStorage.setItem('taplocal:settings-page', 'models') } catch { /* ignore */ } useStore.getState().set({ settingsOpen: true }); onClose() }}>
        <Icon name="layers" size={13} /> Manage models
      </button>
    </div>
  )
}

/** TapNow-style prompt panel that docks under the selected node. */
export function Composer({ id, data, zoom, onUpload }: { id: string; data: CanvasNodeData; zoom: number; onUpload: () => void }) {
  const models = useStore(s => s.models)
  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const elements = useStore(s => s.elements)
  const listening = useStore(s => s.listening)
  const { updateData, generate, cancel, notify } = useStore.getState()
  const [pop, setPop] = useState<Pop>(null)
  const [voice, setVoice] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const refFile = useRef<HTMLInputElement>(null)
  const textFile = useRef<HTMLInputElement>(null)
  const isText = data.kind === 'text'
  // text nodes: the box holds an instruction; media nodes: the generation prompt
  const value = isText ? data.ask ?? '' : data.prompt
  const setValue = (v: string) => updateData(id, isText ? { ask: v } : { prompt: v })

  const inputs = useMemo(() => resolveInputs(id, nodes, edges), [id, nodes, edges])
  const upstream = useMemo(() => upstreamOf(id, nodes, edges), [id, nodes, edges])
  // tool nodes (enhance, cutout, …) offer that tool's models; audio nodes filter by mode
  const audioMode = data.params.audioMode ?? models.find(m => m.id === data.model)?.audioMode ?? 'speech'
  // models hidden in Settings stay listed only while this node still uses one
  const kindModels = models.filter(m => m.kind === data.kind && (shown(m) || m.id === data.model) && (data.tool ? m.tool === data.tool : !m.tool)
    && (data.kind !== 'audio' || !m.audioMode || m.audioMode === audioMode))
  const model = kindModels.find(m => m.id === data.model)
  const busy = data.status === 'queued' || data.status === 'running'
  const setParam = (p: Partial<NodeParams>) => updateData(id, { params: { ...data.params, ...p } })
  const toggle = (p: Pop) => setPop(pop === p ? null : p)

  // grow the prompt box with its content
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, Math.max(76, el.scrollHeight))}px`
  }, [value])
  useEffect(() => () => { if (voice) stopVoice() }, [voice])
  useEffect(() => { if (!listening) setVoice(false) }, [listening])

  // @mentions of connected upstream nodes and library elements
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  const candidates = mention ? [
    ...upstream.map(n => ({ id: n.id, title: n.data.title, icon: n.data.kind as string })),
    ...elements.map(e => ({ id: e.id, title: e.name, icon: 'element' })),
  ].filter(c => c.title.toLowerCase().includes(mention.q.toLowerCase())) : []
  const onPrompt = (v: string, caret: number) => {
    setValue(v)
    const m = v.slice(0, caret).match(/(^|\s)@([^\s@]*)$/)
    setMention(m && (upstream.length || elements.length) ? { q: m[2], at: caret - m[2].length - 1 } : null)
  }
  const pick = (title: string) => {
    if (!mention) return
    const end = mention.at + 1 + mention.q.length
    setValue(value.slice(0, mention.at) + '@' + title + ' ' + value.slice(end))
    setMention(null)
    requestAnimationFrame(() => ta.current?.focus())
  }

  const setAudioMode = (m: 'speech' | 'music' | 'sfx') => {
    const first = models.find(x => x.kind === 'audio' && x.audioMode === m && x.available && shown(x) && x.provider !== 'mock') ?? models.find(x => x.kind === 'audio' && x.audioMode === m && x.available && shown(x))
    updateData(id, { params: { ...data.params, audioMode: m, duration: first?.durations?.[0] }, ...(first ? { model: first.id } : {}) })
  }
  const imageWarning = model && inputs.images.length > model.maxImages
    ? model.maxImages ? `${model.name} uses only the first ${model.maxImages} image(s)` : `${model.name} ignores image inputs`
    : model?.requiresImage && !inputs.images.length ? `${model.name} needs a connected image` : ''
  const needsWarning = model?.needs?.filter(k => !(k === 'video' ? inputs.videos : inputs.audios).length).map(k => `${model.name} needs a connected ${k}`).join(' · ')

  const disconnect = (sourceId: string) => {
    const st = useStore.getState()
    st.onEdgesChange(st.edges.filter(e => e.source === sourceId && e.target === id).map(e => ({ type: 'remove' as const, id: e.id })))
  }
  // "+": upload a reference as a new node, already connected to this one
  const addReference = async (file?: File) => {
    if (!file) return
    const st = useStore.getState()
    const me = st.nodes.find(n => n.id === id)
    try {
      const [asset] = await api.upload([file], st.projectId)
      const pos = me ? { x: me.position.x - NODE_WIDTH[asset.kind] - 80, y: me.position.y + upstream.length * 40 } : undefined
      const newId = st.addAssetNode(asset, pos)
      st.onConnect({ source: newId, target: id, sourceHandle: null, targetHandle: null })
      // keep this node selected so the panel stays open
      useStore.setState(s => ({ nodes: s.nodes.map(n => ({ ...n, selected: n.id === id })) }))
    } catch (e) { notify((e as Error).message, 'error') }
  }
  const importText = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    updateData(id, { prompt: data.prompt.trim() ? `${data.prompt.trimEnd()}\n\n${text}` : text })
  }
  const toggleVoice = () => {
    if (voice) { stopVoice(); return }
    const ok = startVoice({ get: () => (isText ? useStore.getState().nodes.find(n => n.id === id)?.data.ask ?? '' : useStore.getState().nodes.find(n => n.id === id)?.data.prompt ?? ''), set: setValue, done: () => ta.current?.focus() })
    setVoice(!!ok)
  }
  const send = () => { setPop(null); if (busy) cancel(id); else generate(id) }

  const thumb = (n: CanvasNode) => {
    const o = activeOutput(n)
    if (o?.url && (o.kind === 'image' || (o.kind === 'video' && o.mime?.includes('svg')))) return <img src={o.url} alt="" />
    if (o?.url && o.kind === 'video') return <video src={o.url} muted />
    return <Icon name={n.data.kind} size={16} />
  }
  const placeholder = isText
    ? (data.prompt.trim() ? 'Describe how to change this text…' : 'Describe anything you want to write')
    : 'Describe anything you want to generate'

  return (
    <div className="composer nodrag nowheel" style={{ transform: `translateX(-50%) scale(${Math.min(2.5, Math.max(1, 1 / zoom))})` }}
      onPointerDown={e => e.stopPropagation()}>
      {pop && <div className="backdrop-clear" onPointerDown={() => setPop(null)} />}

      <div className="cmp-refs">
        <div className="cmp-add-wrap">
          <button className="cmp-add" title="Add a reference" onClick={() => toggle('add')}><Icon name="plus" size={20} /></button>
          {pop === 'add' && (
            <div className="cmp-pop cmp-menu down">
              <button onClick={() => { setPop(null); refFile.current?.click() }}><Icon name="upload" size={14} /> Upload a reference<small>Adds a connected image, video or audio node</small></button>
              {!isText && <button onClick={() => { setPop(null); onUpload() }}><Icon name={data.kind as NodeKind} size={14} /> Upload as this node's result</button>}
              {isText && <button onClick={() => { setPop(null); textFile.current?.click() }}><Icon name="text" size={14} /> Import a .txt or .md file</button>}
              {(upstream.length > 0 || elements.length > 0) && (
                <button onClick={() => { setPop(null); const v = value + (value && !value.endsWith(' ') ? ' @' : '@'); setValue(v); setMention({ q: '', at: v.length - 1 }); requestAnimationFrame(() => ta.current?.focus()) }}>
                  <Icon name="sparkle" size={14} /> Mention an input or element<small>Type @ in the prompt</small>
                </button>
              )}
            </div>
          )}
        </div>
        {upstream.map(n => (
          <div key={n.id} className={`cmp-ref kind-${n.data.kind}`} title={n.data.kind === 'text' ? plainText(n.data.prompt).slice(0, 200) : n.data.title}>
            {n.data.kind === 'text' ? <span className="t">{plainText(n.data.prompt).slice(0, 48) || n.data.title}</span> : thumb(n)}
            <span className="cap">{n.data.title}</span>
            <button className="x" title="Disconnect" onClick={() => disconnect(n.id)}><Icon name="x" size={10} /></button>
          </div>
        ))}
      </div>

      <div className="cmp-prompt">
        <textarea ref={ta} autoFocus value={value} placeholder={placeholder} rows={2}
          onChange={e => onPrompt(e.target.value, e.target.selectionStart)}
          onKeyDown={e => {
            if (mention && candidates[0] && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(candidates[0].title); return }
            if (e.key === 'Escape') { setMention(null); return }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && model?.available) generate(id) }
          }} />
        {mention && candidates.length > 0 && (
          <div className="mention-pop down">
            {candidates.map(c => <button key={c.id} onMouseDown={e => { e.preventDefault(); pick(c.title) }}>{c.icon === 'element' ? <span className="chip skill">element</span> : <Icon name={c.icon as NodeKind} size={12} />} {c.title}</button>)}
          </div>
        )}
      </div>

      {(imageWarning || needsWarning || data.tool || (data.kind === 'video' && inputs.images.length > 1 && model && model.maxImages > 1)) && (
        <div className="cmp-notes">
          {data.kind === 'video' && inputs.images.length > 1 && model && model.maxImages > 1 && <span className="chip ghost">first + last frame</span>}
          {imageWarning && <span className="chip warn">{imageWarning}</span>}
          {needsWarning && <span className="chip warn">{needsWarning}</span>}
          {data.tool && <span className="chip skill">tool · {data.tool}</span>}
        </div>
      )}

      <div className="cmp-foot">
        <div className="cmp-chip-wrap">
          <button className="cmp-model-btn" onClick={() => toggle('model')} title={model?.reason ?? 'Choose a model'}>
            <Icon name="sparkle" size={16} /><span>{model?.name ?? 'Choose a model'}</span><Icon name="chevron" size={12} />
          </button>
          {pop === 'model' && <ModelPicker models={kindModels} value={data.model} onPick={m => updateData(id, { model: m })} onClose={() => setPop(null)} />}
        </div>

        {data.kind === 'audio' && (
          <div className="cmp-chip-wrap">
            <button className="cmp-chip" onClick={() => toggle('mode')}>{AUDIO_MODES.find(([k]) => k === audioMode)?.[1]}</button>
            {pop === 'mode' && <div className="cmp-pop cmp-menu">{AUDIO_MODES.map(([k, l]) => <button key={k} className={audioMode === k ? 'on' : ''} onClick={() => { setAudioMode(k); setPop(null) }}>{l}</button>)}</div>}
          </div>
        )}
        {model?.aspects && (
          <div className="cmp-chip-wrap">
            <button className="cmp-chip" title="Aspect ratio" onClick={() => toggle('aspect')}><AspectGlyph a={data.params.aspect ?? model.aspects[0]} />{data.params.aspect ?? model.aspects[0]}</button>
            {pop === 'aspect' && <div className="cmp-pop cmp-menu">{model.aspects.map(a => <button key={a} className={(data.params.aspect ?? model.aspects![0]) === a ? 'on' : ''} onClick={() => { setParam({ aspect: a }); setPop(null) }}><AspectGlyph a={a} />{a}</button>)}</div>}
          </div>
        )}
        {model?.durations && (
          <div className="cmp-chip-wrap">
            <button className="cmp-chip" title="Duration" onClick={() => toggle('duration')}>{data.params.duration ?? model.durations[0]}s</button>
            {pop === 'duration' && <div className="cmp-pop cmp-menu">{model.durations.map(d => <button key={d} className={(data.params.duration ?? model.durations![0]) === d ? 'on' : ''} onClick={() => { setParam({ duration: d }); setPop(null) }}>{d} seconds</button>)}</div>}
          </div>
        )}
        {data.kind === 'video' && !data.tool && (
          <div className="cmp-chip-wrap">
            <button className="cmp-chip icon" title="Camera moves" onClick={() => toggle('camera')}><Icon name="camera" size={15} /></button>
            {pop === 'camera' && (
              <div className="cmp-pop cmp-menu">
                <div className="cmp-pop-label">Add a camera move to the prompt</div>
                {CAMERA.map(c => <button key={c} className={value.includes(c) ? 'on' : ''} onClick={() => setValue(value.includes(c) ? value : `${value.trim()}${value.trim() ? ', ' : ''}${c}`)}>{c}</button>)}
              </div>
            )}
          </div>
        )}
        {!isText && (data.kind !== 'audio' || audioMode === 'speech') && (
          <div className="cmp-chip-wrap">
            <button className="cmp-chip icon" title="More settings" onClick={() => toggle('settings')}><Icon name="sliders" size={15} /></button>
            {pop === 'settings' && (
              <div className="cmp-pop cmp-settings">
                {data.kind !== 'audio' && (
                  <label>Seed<input placeholder="random" value={data.params.seed ?? ''} onChange={e => setParam({ seed: e.target.value === '' ? undefined : Number(e.target.value.replace(/\D/g, '')) })} /></label>
                )}
                {data.kind === 'audio' && <>
                  {model?.provider === 'openai' && <label>Voice<select value={data.params.voice ?? 'alloy'} onChange={e => setParam({ voice: e.target.value })}>{VOICES.map(v => <option key={v}>{v}</option>)}</select></label>}
                  <label>Speed {(data.params.speed ?? 1).toFixed(1)}×<input type="range" min={0.5} max={2} step={0.1} value={data.params.speed ?? 1} onChange={e => setParam({ speed: Number(e.target.value) })} /></label>
                  <label>Pitch {data.params.pitch ?? 0}<input type="range" min={-12} max={12} step={1} value={data.params.pitch ?? 0} onChange={e => setParam({ pitch: Number(e.target.value) })} /></label>
                </>}
              </div>
            )}
          </div>
        )}

        <span className="spacer" />
        <button className={`cmp-icon ${voice ? 'live' : ''}`} title={voice ? 'Stop dictation' : 'Dictate'} onClick={toggleVoice}><Icon name="mic" size={18} /></button>
        {!isText && <>
          <span className="cmp-sep" />
          <div className="cmp-chip-wrap">
            <button className="cmp-count" title="Results per run" onClick={() => toggle('count')}>{data.params.count ?? 1}×</button>
            {pop === 'count' && <div className="cmp-pop cmp-menu right">{[1, 2, 3, 4].map(c => <button key={c} className={(data.params.count ?? 1) === c ? 'on' : ''} onClick={() => { setParam({ count: c }); setPop(null) }}>{c} result{c > 1 ? 's' : ''}</button>)}</div>}
          </div>
        </>}
        <button className={`cmp-send ${busy ? 'busy' : ''}`} onClick={send} disabled={!busy && !model?.available}
          title={busy ? 'Cancel' : !model?.available ? model?.reason ?? 'Choose a model' : `${isText ? 'Write' : data.outputs.length ? 'Regenerate' : 'Generate'} (Enter)`}>
          <Icon name={busy ? 'stop' : 'arrow-up'} size={18} />
        </button>
      </div>

      <input ref={refFile} type="file" hidden accept="image/*,video/*,audio/*" onChange={e => { addReference(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={textFile} type="file" hidden accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => { importText(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
