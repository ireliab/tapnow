import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../icons'
import type { CustomModel, FalSearchResult } from '../../types'
import { Card, PageHead, useSettings } from './shared'

const CATEGORIES: Array<[string, string]> = [
  ['', 'All categories'], ['text-to-image', 'Text → image'], ['image-to-image', 'Image → image'],
  ['text-to-video', 'Text → video'], ['image-to-video', 'Image → video'], ['video-to-video', 'Video → video'],
  ['text-to-speech', 'Text → speech'], ['text-to-audio', 'Text → audio'],
]
const TOOLS: Array<[string, string]> = [
  ['', 'Generate (normal node)'], ['upscale', 'Enhance / upscale'], ['cutout', 'Cutout'], ['inpaint', 'Erase & redraw'],
  ['relight', 'Relight'], ['video-remove', 'Remove object (video)'], ['video-replace', 'Replace object (video)'],
]

/** Best guess at how a fal model plugs into TapLocal, from its gallery category. */
export function fromFal(r: FalSearchResult): CustomModel {
  const c = r.category
  const kind: CustomModel['kind'] = /video/.test(c.split('-to-').pop() ?? '') ? 'video' : /speech|audio|music/.test(c) ? 'audio' : 'image'
  const imageField = c.startsWith('image-to-') ? 'image_url' : undefined
  const tool = c === 'video-to-video' ? 'video-remove' : undefined
  return { id: r.id, name: r.name, provider: 'fal', kind, ...(imageField ? { imageField } : {}), ...(tool ? { tool } : {}) }
}

export function CustomModelsPage() {
  const { s, setS, status } = useSettings()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [results, setResults] = useState<FalSearchResult[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [json, setJson] = useState(() => JSON.stringify(s.customModels, null, 2))
  const [jsonError, setJsonError] = useState('')
  const list = s.customModels
  const setList = (next: CustomModel[]) => { setS({ ...s, customModels: next }); setJson(JSON.stringify(next, null, 2)); setJsonError('') }
  const patch = (i: number, p: Partial<CustomModel>) => setList(list.map((m, j) => (j === i ? { ...m, ...p } : m)))

  useEffect(() => {
    if (!q.trim() && !category) { setResults(undefined); return }
    const t = setTimeout(() => {
      setLoading(true)
      api.falSearch(q.trim(), category || undefined)
        .then(r => { setResults(r); setError('') })
        .catch(e => setError(String(e.message ?? e)))
        .finally(() => setLoading(false))
    }, 400)
    return () => clearTimeout(t)
  }, [q, category])

  return <>
    <PageHead icon="plus" title="Custom fal models" blurb="Add any model from fal.ai's gallery. Added models appear on the fal.ai page and in the canvas like the built-in ones." />
    <Card title="Find a model on fal.ai">
      <div className="set-filters">
        <div className="search-box"><Icon name="search" size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search, e.g. wan, seedance, recraft, upscale" autoFocus /></div>
        <select value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {loading && <p className="muted small">Searching…</p>}
      {error && <p className="warn-text">{error}</p>}
      {results && !results.length && !loading && <p className="muted small">Nothing found.</p>}
      {results && results.length > 0 && (
        <div className="fal-results">
          {results.map(r => {
            const added = list.some(m => m.id === r.id)
            return (
              <div key={r.id} className="fal-result">
                {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <div className="thumb-ph" />}
                <div className="fal-info">
                  <div className="fal-title"><b>{r.name}</b>{r.category && r.category !== 'unknown' && <span className="chip ghost">{r.category}</span>}</div>
                  <code>{r.id}</code>
                  <small className="muted">{r.description}</small>
                </div>
                <button className="btn" disabled={added} onClick={() => setList([...list, fromFal(r)])}>{added ? <><Icon name="check" size={13} /> Added</> : <><Icon name="plus" size={13} /> Add</>}</button>
              </div>
            )
          })}
        </div>
      )}
    </Card>

    <Card title={`Your models (${list.length})`}>
      {!list.length && <p className="muted small">None yet — search above, or paste JSON under Advanced.</p>}
      {list.map((m, i) => {
        const missing = status.fal?.notFound?.includes(m.id)
        const price = status.fal?.prices?.[m.id]
        return (
          <div key={m.id + i} className="custom-row">
            <div className="custom-top">
              <input className="name" value={m.name} onChange={e => patch(i, { name: e.target.value })} aria-label="Display name" />
              <a href={`https://fal.ai/models/${m.id}`} target="_blank" rel="noreferrer"><code>{m.id}</code></a>
              {missing && <span className="chip warn">not found on fal</span>}
              {price && <span className="chip price">{price}</span>}
              <span className="spacer" />
              <button className="icon-btn" title="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
            </div>
            <div className="custom-fields">
              <label>Makes<select value={m.kind} onChange={e => patch(i, { kind: e.target.value as CustomModel['kind'] })}>
                <option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option></select></label>
              <label>Used as<select value={m.tool ?? ''} onChange={e => patch(i, { tool: e.target.value || undefined })}>{TOOLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Image input field<input value={m.imageField ?? ''} placeholder="none (text only)" onChange={e => patch(i, { imageField: e.target.value || undefined })} /></label>
            </div>
          </div>
        )
      })}
      <small className="muted">Field names differ between models — check the model's API tab on fal.ai if a run fails.</small>
    </Card>

    <details className="set-help">
      <summary>Advanced: edit as JSON</summary>
      <textarea className="code" rows={8} value={json} spellCheck={false} onChange={e => {
        setJson(e.target.value)
        try {
          const v = JSON.parse(e.target.value || '[]')
          if (!Array.isArray(v) || v.some(m => !m?.id || !['image', 'video', 'audio'].includes(m.kind))) throw new Error('Each model needs an "id" and a "kind" of image, video or audio')
          setS({ ...s, customModels: v.map(m => ({ provider: 'fal', name: m.id, ...m })) }); setJsonError('')
        } catch (err) { setJsonError(err instanceof SyntaxError ? 'Not valid JSON yet' : String((err as Error).message)) }
      }} />
      {jsonError && <small className="warn-text">{jsonError}</small>}
    </details>
  </>
}
