import { Icon } from '../../icons'
import type { ModelInfo } from '../../types'
import { PROVIDER_OF_MODEL, Toggle, useSettings } from './shared'

const TOOL_LABEL: Record<string, string> = {
  upscale: 'Enhance / upscale', cutout: 'Background cutout', inpaint: 'Erase & redraw', relight: 'Relight',
  'video-remove': 'Remove object (video)', 'video-replace': 'Replace object (video)',
}

/** What the model does, in a few words. */
export function capability(m: ModelInfo) {
  if (m.tool) return TOOL_LABEL[m.tool] ?? m.tool
  if (m.needs?.length) return m.needs.includes('audio') && m.needs.includes('video') ? 'Lip-sync (video + audio)' : `Needs ${m.needs.join(' + ')}`
  if (m.kind === 'video') return m.requiresImage ? 'Image → video' : m.maxImages > 0 ? 'Text or image → video' : 'Text → video'
  if (m.kind === 'image') return m.requiresImage ? 'Edit an image' : m.maxImages > 0 ? 'Text or image → image' : 'Text → image'
  if (m.kind === 'audio') return m.audioMode === 'music' ? 'Music' : m.audioMode === 'sfx' ? 'Sound effects' : 'Speech'
  return 'Text'
}

export const section = (m: ModelInfo) => (m.tool || m.needs?.length ? 'tools' : m.kind)
const SECTIONS: Array<[string, string]> = [['image', 'Image'], ['video', 'Video'], ['audio', 'Audio'], ['text', 'Text'], ['tools', 'Editing tools']]

function Row({ m, showProvider }: { m: ModelInfo; showProvider?: boolean }) {
  const { isOn, setOn, status } = useSettings()
  const on = isOn(m)
  const app = m.extra?.app as string | undefined
  const price = m.price ?? (app ? status.fal?.prices?.[app] : undefined)
  const missing = app && status.fal?.notFound?.includes(app)
  return (
    <div className={`model-row ${on ? '' : 'off'}`}>
      <Toggle on={on} onChange={v => setOn([m.id], v)} label={`Show ${m.name}`} />
      <Icon name={section(m) === 'tools' ? 'sliders' : m.kind} size={14} className={`k-${m.kind}`} />
      <div className="model-name">
        <b>{m.name}</b>
        <span className="muted">{capability(m)}{showProvider ? ` · ${PROVIDER_OF_MODEL[m.provider] ?? m.provider}` : ''}</span>
      </div>
      <div className="model-tags">
        {missing && <span className="chip warn" title={`fal has no endpoint "${app}"`}>not found on fal</span>}
        {!missing && !m.available && <span className="chip ghost" title={m.reason}>setup needed</span>}
        {m.discovered && <span className="chip ghost">from your account</span>}
        {price ? <span className="chip price" title="List price from fal">{price}</span> : m.paid && <span className="chip ghost">paid</span>}
        {m.provider === 'mock' && <span className="chip ghost">free · offline</span>}
      </div>
    </div>
  )
}

/** Models with show/hide switches, grouped by kind (or provider). */
export function ModelList({ models, groupBy = 'kind', empty = 'No models.' }: { models: ModelInfo[]; groupBy?: 'kind' | 'provider'; empty?: string }) {
  const { isOn, setOn } = useSettings()
  if (!models.length) return <p className="muted">{empty}</p>
  const groups: Array<[string, ModelInfo[]]> = groupBy === 'kind'
    ? SECTIONS.map(([k, l]) => [l, models.filter(m => section(m) === k)] as [string, ModelInfo[]])
    : [...new Set(models.map(m => m.provider))].map(p => [PROVIDER_OF_MODEL[p] ?? p, models.filter(m => m.provider === p)] as [string, ModelInfo[]])
  return (
    <div className="model-list">
      {groups.filter(([, list]) => list.length).map(([label, list]) => {
        const n = list.filter(isOn).length
        return (
          <div key={label} className="model-group">
            <div className="model-group-head">
              <b>{label}</b><span className="muted">{n} of {list.length} shown</span>
              <span className="spacer" />
              <button className="link" disabled={n === list.length} onClick={() => setOn(list.map(m => m.id), true)}>Show all</button>
              <button className="link" disabled={n === 0} onClick={() => setOn(list.map(m => m.id), false)}>Hide all</button>
            </div>
            {list.map(m => <Row key={m.id} m={m} showProvider={groupBy === 'kind' && new Set(models.map(x => x.provider)).size > 1} />)}
          </div>
        )
      })}
    </div>
  )
}
