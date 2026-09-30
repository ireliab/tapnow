import { useRef, useState } from 'react'
import { Icon } from '../icons'
import { renderMarkdown } from '../markdown'
import { Modal } from '../panels/Chrome'
import { useStore } from '../store'
import type { CanvasNodeData } from '../types'

export const TEXT_BGS = ['', '#2a2438', '#1f2d3d', '#1f3329', '#3a3222', '#3a2227']

type Fmt = 'h1' | 'h2' | 'h3' | 'b' | 'i' | 'ul' | 'ol' | 'hr'

/** Apply a markdown format to the textarea selection and return the new value + caret. */
export function applyFormat(value: string, start: number, end: number, f: Fmt): { value: string; start: number; end: number } {
  const sel = value.slice(start, end)
  const wrap = (m: string) => {
    const v = value.slice(0, start) + m + (sel || 'text') + m + value.slice(end)
    return { value: v, start: start + m.length, end: start + m.length + (sel || 'text').length }
  }
  if (f === 'b') return wrap('**')
  if (f === 'i') return wrap('*')
  if (f === 'hr') {
    const ins = `${start && value[start - 1] !== '\n' ? '\n' : ''}---\n`
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length }
  }
  // line-level formats apply to every line touched by the selection
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = (() => { const i = value.indexOf('\n', end); return i < 0 ? value.length : i })()
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const strip = (l: string) => l.replace(/^(#{1,3}\s+|[-*]\s+|\d+[.)]\s+)/, '')
  const prefix = (i: number) => (f === 'h1' ? '# ' : f === 'h2' ? '## ' : f === 'h3' ? '### ' : f === 'ul' ? '- ' : `${i + 1}. `)
  const already = lines.every((l, i) => l.startsWith(prefix(i)))
  const next = lines.map((l, i) => (already ? strip(l) : prefix(i) + strip(l))).join('\n')
  return { value: value.slice(0, lineStart) + next + value.slice(lineEnd), start: lineStart, end: lineStart + next.length }
}

const BUTTONS: Array<[Fmt, string, string]> = [['h1', 'H1', 'Heading 1'], ['h2', 'H2', 'Heading 2'], ['h3', 'H3', 'Heading 3'], ['b', 'B', 'Bold'], ['i', 'I', 'Italic'], ['ul', '•', 'Bulleted list'], ['ol', '1.', 'Numbered list'], ['hr', '—', 'Divider']]

export function TextBody({ id, data, selected }: { id: string; data: CanvasNodeData; selected: boolean }) {
  const updateData = useStore.getState().updateData
  const ta = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(!data.prompt)
  const [full, setFull] = useState(false)
  const format = (f: Fmt, el = ta.current) => {
    if (!el) return
    const r = applyFormat(el.value, el.selectionStart, el.selectionEnd, f)
    updateData(id, { prompt: r.value })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end) })
  }
  const bar = (el: () => HTMLTextAreaElement | null) => (
    <div className="fmt-bar nodrag">
      {BUTTONS.map(([f, label, title]) => <button key={f} title={title} onMouseDown={e => { e.preventDefault(); format(f, el()) }} className={`fmt-${f}`}>{label}</button>)}
      <span className="fmt-sep" />
      {TEXT_BGS.map(c => <button key={c || 'none'} title="Background" onMouseDown={e => { e.preventDefault(); updateData(id, { bg: c || undefined }) }}><i className="swatch" style={{ background: c || 'var(--card)' }} /></button>)}
      <span className="spacer" />
      <button title="Copy all" onMouseDown={e => { e.preventDefault(); navigator.clipboard.writeText(data.prompt); useStore.getState().notify('Copied') }}><Icon name="copy" size={12} /></button>
      <button title="Full screen" onMouseDown={e => { e.preventDefault(); setFull(true) }}><Icon name="expand" size={12} /></button>
    </div>
  )
  const show = editing || (selected && !data.prompt)
  return (
    <div className="text-node" style={{ background: data.bg }}>
      {selected && show && bar(() => ta.current)}
      {show ? (
        <textarea ref={ta} autoFocus={selected} className="nodrag nowheel text-body" value={data.prompt} placeholder="Write a prompt, script or notes… (markdown)"
          onChange={e => updateData(id, { prompt: e.target.value })}
          onBlur={() => data.prompt && setEditing(false)}
          onKeyDown={e => {
            const mod = e.ctrlKey || e.metaKey
            if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); format('b') }
            if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); format('i') }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }} />
      ) : (
        <div className="md text-view nowheel" onDoubleClick={() => setEditing(true)} title="Double-click to edit"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(data.prompt) }} />
      )}
      {full && (
        <Modal title={data.title} onClose={() => setFull(false)} wide>
          <FullEditor id={id} data={data} bar={bar} />
        </Modal>
      )}
    </div>
  )
}

function FullEditor({ id, data, bar }: { id: string; data: CanvasNodeData; bar: (el: () => HTMLTextAreaElement | null) => JSX.Element }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return (
    <div className="full-editor">
      {bar(() => ref.current)}
      <div className="full-split">
        <textarea ref={ref} autoFocus value={data.prompt} onChange={e => useStore.getState().updateData(id, { prompt: e.target.value })} spellCheck />
        <div className="md doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.prompt) }} />
      </div>
    </div>
  )
}
