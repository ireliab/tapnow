import { useEffect, useState } from 'react'
import { useAgent } from '../agent/agentStore'
import { api } from '../api'
import { applyTemplate, selectionAsTemplate } from '../canvasOps'
import { activeOutput } from '../graph'
import { Icon, type IconName } from '../icons'
import { useStore } from '../store'
import type { CanvasNode, ElementItem, LibraryItem, Template } from '../types'
import { Modal } from './Chrome'
import { AssetsPanel } from './SidePanels'

type Tab = 'assets' | 'saved' | 'elements' | 'templates'

/** Library: all assets & history, saved items in folders, Elements and Templates. */
export function LibraryPanel() {
  const [tab, setTab] = useState<Tab>('assets')
  return (
    <aside className="side-panel library-panel">
      <div className="panel-head"><Icon name="folder" /> Library
        <div className="seg small">{(['assets', 'saved', 'elements', 'templates'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'assets' && <AssetsPanel embedded />}
      {tab === 'saved' && <Saved />}
      {tab === 'elements' && <Elements />}
      {tab === 'templates' && <Templates />}
    </aside>
  )
}

// ---------- saved items ----------
function Saved() {
  const [lib, setLib] = useState<{ folders: string[]; items: LibraryItem[] }>({ folders: [], items: [] })
  const [folder, setFolder] = useState('all')
  const refresh = () => api.library().then(setLib)
  useEffect(() => { refresh() }, [])
  const st = useStore.getState()
  const shown = lib.items.filter(i => folder === 'all' || i.folder === folder)
  const use = (i: LibraryItem) => {
    if (i.kind === 'text') st.addNode('text', undefined, { title: i.name, prompt: i.text ?? '' })
    else if (i.url) st.addAssetNode({ id: i.id, url: i.url, kind: i.kind, mime: i.mime ?? '', name: i.name, prompt: i.prompt, createdAt: i.createdAt })
  }
  return (
    <>
      <div className="skills-head">
        <select value={folder} onChange={e => setFolder(e.target.value)}><option value="all">All folders</option>{lib.folders.map(f => <option key={f}>{f}</option>)}</select>
        <button className="btn small" onClick={async () => { const n = prompt('New folder name'); if (n) setLib({ ...lib, ...(await api.addFolder(n)) }) }}><Icon name="plus" size={12} /> Folder</button>
      </div>
      <div className="asset-grid">
        {shown.map(i => (
          <div key={i.id} className="asset" title={`${i.name} · ${i.folder}`} onClick={() => use(i)}>
            {i.kind === 'text' ? <div className="thumb-text">{i.text?.slice(0, 160)}</div>
              : i.kind === 'audio' ? <div className="audio-tile"><Icon name="audio" size={24} /></div>
              : i.kind === 'video' && !i.mime?.includes('svg') ? <video src={i.url} muted /> : <img src={i.url} alt="" loading="lazy" />}
            <span className="badge">{i.name.slice(0, 22)}</span>
            <button className="del" title="Remove from library" onClick={async e => { e.stopPropagation(); await api.deleteLibraryItem(i.id); refresh() }}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        {!shown.length && <p className="muted pad">Save nodes here with the <Icon name="folder" size={12} /> button in a node's toolbar. Click an item to add it to the canvas.</p>}
      </div>
    </>
  )
}

export function SaveToLibraryDialog({ node, onClose }: { node: CanvasNode; onClose: () => void }) {
  const [folders, setFolders] = useState<string[]>(['General'])
  const [folder, setFolder] = useState('General')
  const [fresh, setFresh] = useState('')
  const [name, setName] = useState(node.data.title)
  useEffect(() => { api.library().then(l => setFolders(l.folders)) }, [])
  const save = async () => {
    const o = activeOutput(node)
    await api.saveToLibrary(node.data.kind === 'text'
      ? { kind: 'text', name, folder: fresh.trim() || folder, text: node.data.prompt }
      : { kind: node.data.kind, name, folder: fresh.trim() || folder, url: o?.url, mime: o?.mime, prompt: node.data.prompt })
    useStore.getState().notify(`Saved to library · ${fresh.trim() || folder}`)
    onClose()
  }
  return (
    <Modal title="Save to library" onClose={onClose}>
      <div className="settings-body">
        <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span>Folder</span><select value={folder} onChange={e => setFolder(e.target.value)}>{folders.map(f => <option key={f}>{f}</option>)}</select></label>
        <label className="field"><span>…or a new folder</span><input value={fresh} onChange={e => setFresh(e.target.value)} placeholder="e.g. Campaign A" /></label>
      </div>
      <div className="modal-foot"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={node.data.kind !== 'text' && !activeOutput(node)?.url} onClick={save}>Save</button></div>
    </Modal>
  )
}

// ---------- elements ----------
const KIND_ICON: Record<ElementItem['kind'], IconName> = { character: 'bot', product: 'image', brand: 'sparkle', other: 'grid' }

function Elements() {
  const elements = useStore(s => s.elements)
  const [editing, setEditing] = useState<Partial<ElementItem> | null>(null)
  const useInChat = (e: ElementItem) => {
    const a = useAgent.getState()
    a.addRef({ nodeId: `element:${e.id}`, title: e.name, kind: 'element', value: `${e.description} · refs: ${e.refs.map(r => r.url).join(', ')}` })
    a.set({ tab: 'chat', draft: { ...useAgent.getState().draft, text: `${useAgent.getState().draft.text} @${e.name} `.trimStart() } })
    a.focusComposer()
  }
  return (
    <>
      <div className="skills-head"><span className="muted small">Reusable characters, products and brands. Type <b>@{elements[0]?.name ?? 'Name'}</b> in any prompt to use one.</span>
        <button className="btn primary small" onClick={() => setEditing({ kind: 'character', refs: [] })}><Icon name="plus" size={12} /> Element</button></div>
      <div className="skills-list nowheel">
        {elements.map(e => (
          <div key={e.id} className="skill-card">
            <div className="element-thumbs">{e.refs.slice(0, 3).map(r => <img key={r.url} src={r.url} alt="" />)}{!e.refs.length && <Icon name={KIND_ICON[e.kind]} size={18} />}</div>
            <div className="skill-body">
              <b>@{e.name} <span className="chip ghost">{e.kind}</span></b>
              <p>{e.description || 'No description'} · {e.refs.length} reference{e.refs.length === 1 ? '' : 's'}</p>
              <div className="skill-actions">
                <button className="btn small" onClick={() => useInChat(e)}>Use in chat</button>
                <button className="link" onClick={() => setEditing(e)}>Edit</button>
              </div>
            </div>
          </div>
        ))}
        {!elements.length && <p className="muted pad">Group the references of one character or product — images plus a description of what must stay consistent.</p>}
      </div>
      {editing && <ElementEditor element={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ElementEditor({ element, onClose }: { element: Partial<ElementItem>; onClose: () => void }) {
  const [e, setE] = useState(element)
  const nodes = useStore(s => s.nodes)
  const st = useStore.getState()
  const selectedMedia = nodes.filter(n => n.selected && !n.hidden && n.data.kind === 'image').map(n => activeOutput(n)).filter(o => o?.url)
  const addSelected = () => setE({ ...e, refs: [...(e.refs ?? []), ...selectedMedia.filter(o => !e.refs?.some(r => r.url === o!.url)).map(o => ({ url: o!.url!, kind: 'image' }))] })
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const assets = await api.upload([...files].filter(f => f.type.startsWith('image/')), st.projectId)
    setE({ ...e, refs: [...(e.refs ?? []), ...assets.map(a => ({ url: a.url, kind: 'image' }))] })
  }
  const save = async () => {
    try { await api.saveElement(e); await st.loadElements(); st.notify(`Element @${e.name} saved`); onClose() } catch (err: any) { st.notify(err.message, 'error') }
  }
  return (
    <Modal title={e.id ? `Element · ${e.name}` : 'New element'} onClose={onClose} wide>
      <div className="settings-body">
        <div className="row2">
          <label className="field"><span>Name (used as @Name)</span><input value={e.name ?? ''} onChange={x => setE({ ...e, name: x.target.value.replace(/\s+/g, ' ') })} placeholder="Mara" /></label>
          <label className="field"><span>Type</span><select value={e.kind} onChange={x => setE({ ...e, kind: x.target.value as ElementItem['kind'] })}>{['character', 'product', 'brand', 'other'].map(k => <option key={k}>{k}</option>)}</select></label>
        </div>
        <label className="field"><span>What must stay consistent</span><textarea rows={3} value={e.description ?? ''} onChange={x => setE({ ...e, description: x.target.value })} placeholder="silver bob haircut, amber eyes, oversized yellow raincoat" /></label>
        <div className="field"><span>References</span>
          <div className="element-refs">
            {(e.refs ?? []).map(r => <div key={r.url} className="ref"><img src={r.url} alt="" /><button onClick={() => setE({ ...e, refs: e.refs!.filter(x => x.url !== r.url) })}>×</button></div>)}
            <label className="ref add"><Icon name="upload" /><input type="file" hidden multiple accept="image/*" onChange={x => { upload(x.target.files); x.target.value = '' }} /></label>
          </div>
          <button className="btn small" disabled={!selectedMedia.length} onClick={addSelected}>Add {selectedMedia.length || ''} selected image node{selectedMedia.length === 1 ? '' : 's'}</button>
        </div>
      </div>
      <div className="modal-foot">
        {e.id && <button className="btn danger" onClick={async () => { await api.deleteElement(e.id!); await st.loadElements(); onClose() }}>Delete</button>}
        <div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!e.name?.trim()} onClick={save}>Save element</button>
      </div>
    </Modal>
  )
}

// ---------- templates ----------
function Templates() {
  const [list, setList] = useState<Template[]>([])
  const [scope, setScope] = useState<'public' | 'mine'>('public')
  const refresh = () => api.templates().then(setList)
  useEffect(() => { refresh() }, [])
  const shown = list.filter(t => t.source === scope)
  return (
    <>
      <div className="skills-head"><div className="seg small">{(['public', 'mine'] as const).map(s => <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>{s === 'public' ? 'Public' : 'My templates'}</button>)}</div></div>
      <div className="skills-list nowheel">
        {shown.map(t => <TemplateCard key={t.id} t={t} onDelete={t.source === 'mine' ? async () => { await api.deleteTemplate(t.id); refresh() } : undefined} />)}
        {!shown.length && <p className="muted pad">{scope === 'mine' ? 'Select nodes on the canvas and choose "Save as template" in the selection toolbar.' : 'No public templates found.'}</p>}
      </div>
    </>
  )
}

export function TemplateCard({ t, onDelete, onApply }: { t: Template; onDelete?: () => void; onApply?: () => void }) {
  const counts = (['text', 'image', 'video', 'audio'] as const).map(k => [k, t.nodes.filter(n => n.kind === k).length] as const).filter(([, c]) => c)
  return (
    <div className="skill-card">
      <div className="skill-icon"><Icon name="grid" size={18} /></div>
      <div className="skill-body">
        <b>{t.name} {t.category && t.source === 'public' && <span className="chip ghost">{t.category}</span>}</b>
        <p>{t.description}</p>
        <div className="skill-actions">
          {counts.map(([k, c]) => <span key={k} className="muted small"><Icon name={k} size={11} /> {c}</span>)}
          <div className="spacer" />
          {onDelete && <button className="link" onClick={onDelete}>Delete</button>}
          <button className="btn small primary" onClick={() => (onApply ? onApply() : applyTemplate(t))}>Apply</button>
        </div>
      </div>
    </div>
  )
}

export function SaveTemplateDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [withOutputs, setWithOutputs] = useState(false)
  const save = async () => {
    const body = selectionAsTemplate(ids, withOutputs)
    if (!body.nodes.length) return useStore.getState().notify('Select some nodes first', 'error')
    await api.saveTemplate({ name: name || 'My template', description, ...body })
    useStore.getState().notify('Saved to My templates')
    onClose()
  }
  return (
    <Modal title="Save as template" onClose={onClose}>
      <div className="settings-body">
        <label className="field"><span>Name</span><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 4-shot teaser" /></label>
        <label className="field"><span>Description</span><input value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={withOutputs} onChange={e => setWithOutputs(e.target.checked)} /> Include current outputs (otherwise just prompts, models and connections)</label>
      </div>
      <div className="modal-foot"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save template</button></div>
    </Modal>
  )
}
