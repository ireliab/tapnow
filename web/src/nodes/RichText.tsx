import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import { TableKit } from '@tiptap/extension-table'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import { useStore } from '../store'

/**
 * WYSIWYG markdown editor. The value stays markdown, so connected nodes, @mentions,
 * the agent and the library read text nodes exactly as before.
 */
export function useMarkdownEditor(value: string, onChange: (md: string) => void, opts: { editable: boolean; placeholder?: string; autofocus?: boolean }) {
  const last = useRef(value)
  const change = useRef(onChange)
  change.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown,
      Placeholder.configure({ placeholder: opts.placeholder ?? 'Write something…' }),
    ],
    content: value,
    contentType: 'markdown',
    editable: opts.editable,
    autofocus: opts.autofocus ? 'end' : false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown()
      if (md === last.current) return
      last.current = md
      change.current(md)
    },
  })
  // content changed elsewhere (generation, agent, the other editor) — load it without echoing back
  useEffect(() => {
    if (!editor || value === last.current) return
    last.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])
  useEffect(() => { if (editor && editor.isEditable !== opts.editable) editor.setEditable(opts.editable) }, [editor, opts.editable])
  return editor
}

type Fmt = { key: string; label: React.ReactNode; title: string; run: (e: Editor) => void; active?: (e: Editor) => boolean }
const FORMATS: Array<Fmt | '|'> = [
  { key: 'h1', label: <>H<sub>1</sub></>, title: 'Heading 1', run: e => e.chain().focus().toggleHeading({ level: 1 }).run(), active: e => e.isActive('heading', { level: 1 }) },
  { key: 'h2', label: <>H<sub>2</sub></>, title: 'Heading 2', run: e => e.chain().focus().toggleHeading({ level: 2 }).run(), active: e => e.isActive('heading', { level: 2 }) },
  { key: 'h3', label: <>H<sub>3</sub></>, title: 'Heading 3', run: e => e.chain().focus().toggleHeading({ level: 3 }).run(), active: e => e.isActive('heading', { level: 3 }) },
  { key: 'p', label: '¶', title: 'Paragraph', run: e => e.chain().focus().setParagraph().run(), active: e => e.isActive('paragraph') && !e.isActive('listItem') },
  '|',
  { key: 'b', label: <b>B</b>, title: 'Bold (Ctrl+B)', run: e => e.chain().focus().toggleBold().run(), active: e => e.isActive('bold') },
  { key: 'i', label: <i>I</i>, title: 'Italic (Ctrl+I)', run: e => e.chain().focus().toggleItalic().run(), active: e => e.isActive('italic') },
  '|',
  { key: 'ul', label: <Icon name="list" size={15} />, title: 'Bulleted list', run: e => e.chain().focus().toggleBulletList().run(), active: e => e.isActive('bulletList') },
  { key: 'ol', label: <Icon name="list-ol" size={15} />, title: 'Numbered list', run: e => e.chain().focus().toggleOrderedList().run(), active: e => e.isActive('orderedList') },
  '|',
  { key: 'hr', label: '—', title: 'Divider', run: e => e.chain().focus().setHorizontalRule().run() },
]

/** Floating format bar (fullscreen editor). */
export function FormatBar({ editor, markdown }: { editor: Editor; markdown: string }) {
  const active = useEditorState({ editor, selector: ({ editor: e }) => Object.fromEntries(FORMATS.flatMap(f => (f === '|' || !f.active ? [] : [[f.key, f.active(e)]]))) })
  return (
    <div className="doc-bar" onMouseDown={e => e.preventDefault()}>
      <button title="Copy all" onClick={() => { navigator.clipboard.writeText(markdown); useStore.getState().notify('Copied') }}><Icon name="copy" size={15} /></button>
      <span className="sep" />
      {FORMATS.map((f, i) => f === '|' ? <span key={i} className="sep" />
        : <button key={f.key} title={f.title} className={active?.[f.key] ? 'on' : ''} onClick={() => f.run(editor)}>{f.label}</button>)}
    </div>
  )
}

/** Text node body: the document, editable in place while the node is selected. */
export function RichText({ id, value, selected }: { id: string; value: string; selected: boolean }) {
  const editor = useMarkdownEditor(value, md => useStore.getState().updateData(id, { prompt: md }), {
    editable: selected, placeholder: 'Write here, or describe what you want below and press ↑',
  })
  return <EditorContent editor={editor} className={`rich-text ${selected ? 'nodrag nowheel editing' : ''}`} />
}

/** TapNow-style full-page document editor. */
export function FullscreenDoc({ id, onClose }: { id: string; onClose: () => void }) {
  const value = useStore(s => s.nodes.find(n => n.id === id)?.data.prompt ?? '')
  const title = useStore(s => s.nodes.find(n => n.id === id)?.data.title ?? '')
  const editor = useMarkdownEditor(value, md => useStore.getState().updateData(id, { prompt: md }), { editable: true, autofocus: true, placeholder: 'Start writing…' })
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    // keep canvas shortcuts (Delete, Ctrl+C…) from firing while typing
    <div className="doc-full" onKeyDown={e => e.stopPropagation()} onCopy={e => e.stopPropagation()} onPaste={e => e.stopPropagation()}>
      <button className="doc-back" title="Back to canvas (Esc)" onClick={onClose}><Icon name="arrow-left" size={18} /></button>
      <div className="doc-scroll">
        <div className="doc-page">
          {title && <div className="doc-title">{title}</div>}
          <EditorContent editor={editor} className="rich-text doc-body" />
        </div>
      </div>
      {editor && <FormatBar editor={editor} markdown={value} />}
    </div>,
    document.body,
  )
}
