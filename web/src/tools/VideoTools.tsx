import { useMemo, useState } from 'react'
import { activeOutput } from '../graph'
import { Modal } from '../panels/Chrome'
import { defaultModelWithImages, useStore } from '../store'
import { addDerived, isMock, node, rasterize, runToolNode, toolModels, uploadCanvas, videoOp } from './media'

export type VideoTool = 'trim' | 'frame' | 'smart-clip' | 'continue' | 'prologue' | 'retake' | 'remove' | 'replace'

const TITLES: Record<VideoTool, string> = {
  trim: 'Trim', frame: 'Capture frame', 'smart-clip': 'Smart Clip', continue: 'Continue video', prologue: 'Add prologue',
  retake: 'Video Retake', remove: 'Remove object', replace: 'Replace object',
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

/** First/last/current frame as an image asset (ffmpeg for real video, rasterise for mock SVG clips). */
export async function captureFrameAsset(nodeId: string, at: number | 'first' | 'last') {
  const n = node(nodeId)!
  const o = activeOutput(n)!
  if (isMock(o)) return uploadCanvas(await rasterize(o.url!), `frame-${at}`)
  const { assets } = await videoOp({ op: 'frame', url: o.url, at })
  return assets[0]
}

export function VideoToolDialog({ nodeId, tool, onClose }: { nodeId: string; tool: VideoTool; onClose: () => void }) {
  const n = node(nodeId)
  const o = n && activeOutput(n)
  const [busy, setBusy] = useState(false)
  const notify = useStore.getState().notify
  if (!n || !o?.url) return null
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); onClose() } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  const p = { nodeId, url: o.url, mock: isMock(o), busy, run }
  return (
    <Modal title={`${TITLES[tool]} · ${n.data.title}`} onClose={onClose} wide>
      {tool === 'trim' && <Trim {...p} />}
      {tool === 'frame' && <Frame {...p} />}
      {tool === 'smart-clip' && <SmartClip {...p} />}
      {(tool === 'continue' || tool === 'prologue') && <Continue {...p} prologue={tool === 'prologue'} />}
      {tool === 'retake' && <Retake {...p} />}
      {(tool === 'remove' || tool === 'replace') && <ObjectEdit {...p} replace={tool === 'replace'} />}
    </Modal>
  )
}

type P = { nodeId: string; url: string; mock: boolean; busy: boolean; run: (fn: () => Promise<unknown>) => void }
const Foot = ({ busy, label, onRun, note, disabled }: { busy: boolean; label: string; onRun: () => void; note?: string; disabled?: boolean }) => (
  <div className="modal-foot">{note && <span className="muted small">{note}</span>}<div className="spacer" /><button className="btn primary" disabled={busy || disabled} onClick={onRun}>{busy ? 'Working…' : label}</button></div>
)
const MockNote = () => <p className="agent-banner">This is a mock (placeholder) clip — ffmpeg tools need a real video. Generate with a real model or upload an MP4.</p>

function Player({ url, mock, onTime, onDuration }: { url: string; mock: boolean; onTime?: (t: number) => void; onDuration?: (d: number) => void }) {
  if (mock) return <div className="tool-preview"><img src={url} alt="" /></div>
  return <div className="tool-preview"><video src={url} controls onTimeUpdate={e => onTime?.(e.currentTarget.currentTime)} onLoadedMetadata={e => onDuration?.(e.currentTarget.duration)} /></div>
}

function Trim({ nodeId, url, mock, busy, run }: P) {
  const [dur, setDur] = useState(0)
  const [t, setT] = useState(0)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const end = range[1] || dur
  return (
    <>
      {mock && <MockNote />}
      <Player url={url} mock={mock} onTime={setT} onDuration={d => { setDur(d); setRange([0, d]) }} />
      {!mock && dur > 0 && <>
        <div className="row2">
          <label className="field"><span>In {fmt(range[0])}</span><input type="range" min={0} max={dur} step={0.05} value={range[0]} onChange={e => setRange([Math.min(Number(e.target.value), end - 0.1), end])} /></label>
          <label className="field"><span>Out {fmt(end)}</span><input type="range" min={0} max={dur} step={0.05} value={end} onChange={e => setRange([range[0], Math.max(Number(e.target.value), range[0] + 0.1)])} /></label>
        </div>
        <div className="opts"><button onClick={() => setRange([Math.min(t, end - 0.1), end])}>Set in at playhead ({fmt(t)})</button><button onClick={() => setRange([range[0], Math.max(t, range[0] + 0.1)])}>Set out at playhead</button></div>
      </>}
      <Foot busy={busy} disabled={mock || !dur} label={`Keep ${fmt(Math.max(0, end - range[0]))}`} onRun={() => run(async () => {
        const { assets } = await videoOp({ op: 'trim', url, start: range[0], end })
        addDerived(nodeId, [{ kind: 'video', title: `${node(nodeId)?.data.title} · trim`, asset: assets[0] }])
      })} />
    </>
  )
}

function Frame({ nodeId, url, mock, busy, run }: P) {
  const [t, setT] = useState(0)
  const grab = (at: number | 'first' | 'last', label: string) => run(async () => {
    addDerived(nodeId, [{ kind: 'image', title: `${node(nodeId)?.data.title} · ${label}`, asset: await captureFrameAsset(nodeId, at) }])
  })
  return (
    <>
      <Player url={url} mock={mock} onTime={setT} />
      <div className="modal-foot">
        <div className="spacer" />
        <button className="btn" disabled={busy} onClick={() => grab('first', 'first frame')}>First frame</button>
        {!mock && <button className="btn" disabled={busy} onClick={() => grab(t, `frame ${t.toFixed(1)}s`)}>Current frame ({fmt(t)})</button>}
        <button className="btn primary" disabled={busy} onClick={() => grab('last', 'last frame')}>Last frame</button>
      </div>
    </>
  )
}

function SmartClip({ nodeId, url, mock, busy, run }: P) {
  const [threshold, setThreshold] = useState(0.3)
  return (
    <>
      {mock && <MockNote />}
      <Player url={url} mock={mock} />
      <label className="field"><span>Cut sensitivity {threshold.toFixed(2)} (lower = more cuts)</span><input type="range" min={0.1} max={0.6} step={0.05} value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label>
      <Foot busy={busy} disabled={mock} label="Detect cuts & split" note="Each detected shot becomes its own video node." onRun={() => run(async () => {
        const { assets, cuts } = await videoOp({ op: 'smart-clip', url, threshold })
        addDerived(nodeId, assets.map((a, i) => ({ kind: 'video' as const, title: `${node(nodeId)?.data.title} · shot ${i + 1}`, asset: a })), 'row')
        useStore.getState().notify(cuts?.length ? `Found ${cuts.length} cut${cuts.length > 1 ? 's' : ''} → ${assets.length} clips` : 'No cuts found — kept one clip')
      })} />
    </>
  )
}

const RETAKES = {
  'Fixed camera': 'locked-off static camera, no camera movement',
  'Switch to side view': 'the same moment seen from a side angle',
  'Switch to top view': 'the same moment seen from directly above',
  'Close-up': 'tighter close-up shot scale',
  'Wide shot': 'wider establishing shot scale',
  'Smooth dolly-in': 'smooth slow dolly-in',
  'Orbit': 'smooth orbit around the subject',
  'Crane up': 'smooth crane up',
}

function useI2V() {
  const models = useStore(s => s.models)
  const list = useMemo(() => models.filter(m => m.kind === 'video' && m.maxImages > 0 && !m.tool), [models])
  const [model, setModel] = useState(() => defaultModelWithImages(models, 'video'))
  return { list, model, setModel }
}
const VideoModel = ({ list, model, setModel }: ReturnType<typeof useI2V>) => (
  <label className="field"><span>Video model</span>
    <select value={model} onChange={e => setModel(e.target.value)}>{list.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{m.provider === 'fal' || m.provider === 'openai' ? ' · paid' : ''}</option>)}</select></label>
)

/** Continue the story from the last frame, or lead into the clip from its first frame. */
function Continue({ nodeId, url, mock, busy, run, prologue }: P & { prologue: boolean }) {
  const vm = useI2V()
  const src = node(nodeId)!
  const [prompt, setPrompt] = useState(prologue ? 'What happens just before: ' : 'What happens next: ')
  return (
    <>
      <Player url={url} mock={mock} />
      <label className="field"><span>{prologue ? 'Describe the lead-in' : 'Describe the continuation'}</span><textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <VideoModel {...vm} />
      <Foot busy={busy} label={prologue ? 'Add prologue' : 'Continue story'} note={`Uses the ${prologue ? 'first' : 'last'} frame as the ${prologue ? 'end' : 'start'} frame.`} onRun={() => run(async () => {
        const frame = await captureFrameAsset(nodeId, prologue ? 'first' : 'last')
        const [frameNode] = addDerived(nodeId, [{ kind: 'image', title: `${src.data.title} · ${prologue ? 'first' : 'last'} frame`, asset: frame }])
        runToolNode(frameNode, { kind: 'video', model: vm.model, title: `${src.data.title} · ${prologue ? 'prologue' : 'continued'}`, prompt, params: { duration: src.data.params.duration, aspect: src.data.params.aspect } })
      })} />
    </>
  )
}

function Retake({ nodeId, url, mock, busy, run }: P) {
  const vm = useI2V()
  const src = node(nodeId)!
  const [pick, setPick] = useState<keyof typeof RETAKES>('Switch to side view')
  return (
    <>
      <Player url={url} mock={mock} />
      <div className="field"><span>New view, shot scale or camera move</span>
        <div className="opts">{(Object.keys(RETAKES) as Array<keyof typeof RETAKES>).map(k => <button key={k} className={pick === k ? 'on' : ''} onClick={() => setPick(k)}>{k}</button>)}</div></div>
      <VideoModel {...vm} />
      <Foot busy={busy} label="Retake" note="Regenerates the shot from its first frame." onRun={() => run(async () => {
        const frame = await captureFrameAsset(nodeId, 'first')
        const [frameNode] = addDerived(nodeId, [{ kind: 'image', title: `${src.data.title} · first frame`, asset: frame }])
        runToolNode(frameNode, { kind: 'video', model: vm.model, title: `${src.data.title} · retake`, prompt: `${src.data.prompt ? src.data.prompt + '. ' : ''}${RETAKES[pick]}`, params: { duration: src.data.params.duration, aspect: src.data.params.aspect } })
      })} />
    </>
  )
}

/** Needs a user-configured fal model with tool video-remove / video-replace (Settings → Custom models). */
function ObjectEdit({ nodeId, url, mock, busy, run, replace }: P & { replace: boolean }) {
  const models = useStore(s => s.models)
  const list = toolModels(models, replace ? 'video-replace' : 'video-remove')
  const [model, setModel] = useState(list.find(m => m.available)?.id ?? '')
  const [prompt, setPrompt] = useState('')
  return (
    <>
      <Player url={url} mock={mock} />
      {!list.length ? (
        <div className="agent-banner">
          No {replace ? 'object-replacement' : 'object-removal'} video model is configured. Add one in Settings → Custom models, e.g.
          <code>{` { "id": "<fal model id>", "name": "…", "provider": "fal", "kind": "video", "tool": "${replace ? 'video-replace' : 'video-remove'}" }`}</code>
        </div>
      ) : <>
        <label className="field"><span>{replace ? 'What to replace, and with what (connect a reference image to the new node)' : 'What to remove'}</span><input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={replace ? 'replace the mug with a glass bottle' : 'the person on the left'} /></label>
        <label className="field"><span>Model</span><select value={model} onChange={e => setModel(e.target.value)}>{list.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}</option>)}</select></label>
      </>}
      <Foot busy={busy} disabled={!list.length || !prompt.trim()} label={replace ? 'Replace object' : 'Remove object'} onRun={() => run(async () => {
        runToolNode(nodeId, { kind: 'video', tool: replace ? 'video-replace' : 'video-remove', model, title: `${node(nodeId)?.data.title} · ${replace ? 'replaced' : 'removed'}`, prompt })
      })} />
    </>
  )
}
