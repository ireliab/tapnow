import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { removeExtra, updateExtra } from '../canvasOps'
import { Icon } from '../icons'
import { clipThumb } from '../panels/PlaylistPanel'
import { useStore } from '../store'
import type { CanvasNode, PlaylistNode } from '../types'

/** A playlist on the canvas: filmstrip of its clips; opens in the bottom editor. */
export const PlaylistNodeView = memo(function PlaylistNodeView({ id, data, selected }: NodeProps<PlaylistNode>) {
  const clipNodes = useStore(useShallow(s => data.clips.map(c => s.nodes.find(n => n.id === c.nodeId))))
  const active = useStore(s => s.activePlaylist === id)
  const open = () => useStore.setState({ activePlaylist: id })
  return (
    <div className={`playlist-node ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} onDoubleClick={open}>
      <div className="pl-head"><Icon name="timeline" size={14} />
        <input className="nodrag" value={data.title} onChange={e => updateExtra(id, { title: e.target.value })} />
        <span className="count">{data.clips.length}</span>
      </div>
      <div className="filmstrip">
        {clipNodes.slice(0, 8).map((n, i) => <div key={data.clips[i].id} className="frame">{clipThumb(n as CanvasNode | undefined)}</div>)}
        {!data.clips.length && <span className="muted small">Drop video or image nodes here</span>}
      </div>
      <NodeToolbar isVisible={selected} position={Position.Top} className="cnode-toolbar static">
        <button title="Open in editor" onClick={open}><Icon name="expand" /></button>
        <button title="Delete playlist (clips stay on the canvas)" onClick={() => removeExtra(id)}><Icon name="trash" /></button>
      </NodeToolbar>
    </div>
  )
})
