import { useState } from 'react'
import { activeOutput } from '../graph'
import { Icon } from '../icons'
import { useStore } from '../store'
import type { CanvasNodeData } from '../types'
import { ImageToolDialog, type ImageTool } from './ImageTools'
import { node, runToolNode } from './media'
import { VideoToolDialog, type VideoTool } from './VideoTools'

type Entry = [id: string, label: string, hint: string]
const IMAGE: Array<[string, Entry[]]> = [
  ['Edit locally', [['crop', 'Crop', 'Trim edges or reframe to an aspect'], ['resize', 'Resize pixels', 'Exact width × height'], ['split', 'Quick Split', 'Grid → separate nodes'], ['annotate', 'Annotate', 'Mark what to change']]],
  ['AI edits', [['enhance', 'Enhance', 'Upscale and add detail'], ['cutout', 'Cutout', 'Remove the background'], ['redraw', 'Redraw', 'Change a painted area'], ['erase', 'Erase', 'Remove a marked object'], ['outpaint', 'Outpaint', 'Extend beyond the frame'], ['relight', 'Relight', 'Direction, warmth, rim light'], ['angle', 'Multi-angle', 'New viewpoint of the subject']]],
]
const VIDEO: Array<[string, Entry[]]> = [
  ['Edit locally', [['trim', 'Trim', 'Keep a section'], ['frame', 'Capture frame', 'First / current / last → image'], ['smart-clip', 'Smart Clip', 'Split at scene cuts']]],
  ['AI edits', [['continue', 'Continue video', 'Extend from the last frame'], ['prologue', 'Add prologue', 'Lead in to the first frame'], ['retake', 'Retake', 'New view, scale or camera move'], ['remove', 'Remove object', 'Needs a custom model'], ['replace', 'Replace object', 'Needs a custom model']]],
]

/** "Edit ▾" in the node toolbar: TapNow's per-node image/video tools. */
export function ToolsMenu({ id, data }: { id: string; data: CanvasNodeData }) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<string | null>(null)
  const hasOutput = !!activeOutput({ data } as never)?.url
  const sections = data.kind === 'image' ? IMAGE : data.kind === 'video' ? VIDEO : null
  if (!sections) return null
  const pick = (tool: string) => {
    setOpen(false)
    if (!hasOutput) return useStore.getState().notify('Generate or upload media first', 'info')
    // cutout needs no settings
    if (tool === 'cutout') return runToolNode(id, { tool: 'cutout', title: `${node(id)?.data.title} · cutout` })
    setDialog(tool)
  }
  return (
    <span className="tools-menu">
      <button title="Edit tools" className={open ? 'on' : ''} onClick={() => setOpen(!open)}><Icon name="sparkle" /><Icon name="chevron" size={10} /></button>
      {open && (
        <>
          <div className="backdrop-clear" onPointerDown={() => setOpen(false)} />
          <div className="tools-pop">
            {sections.map(([title, list]) => (
              <div key={title}>
                <div className="menu-title">{title}</div>
                {list.map(([tid, label, hint]) => <button key={tid} disabled={!hasOutput} onClick={() => pick(tid)}><b>{label}</b><span>{hint}</span></button>)}
              </div>
            ))}
          </div>
        </>
      )}
      {dialog && data.kind === 'image' && <ImageToolDialog nodeId={id} tool={dialog as ImageTool} onClose={() => setDialog(null)} />}
      {dialog && data.kind === 'video' && <VideoToolDialog nodeId={id} tool={dialog as VideoTool} onClose={() => setDialog(null)} />}
    </span>
  )
}
