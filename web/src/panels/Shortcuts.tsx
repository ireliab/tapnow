import { useAgent } from '../agent/agentStore'
import { useStore } from '../store'
import { Modal } from './Chrome'

const GROUPS: Array<[string, Array<[string, string]>]> = [
  ['Canvas', [['T  I  V  A', 'Add text / image / video / audio node'], ['Double-click', 'Add node at cursor'], ['Ctrl C / Ctrl V', 'Copy / paste nodes'], ['Ctrl D', 'Duplicate'], ['Delete', 'Delete selection'], ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'], ['Ctrl F', 'Search nodes'], ['Ctrl + / Ctrl −', 'Zoom in / out'], ['Space + drag', 'Pan'], ['C', 'Comment mode'], ['Ctrl S', 'Save now']]],
  ['Agent', [['Ctrl J', 'Open / close Agent'], ['Ctrl I', 'Point to Edit — send the selection to the Agent'], ['Hold V', 'Voice input (release to finish)'], ['@', 'Reference a node or element'], ['Enter', 'Generate from the prompt panel (Shift Enter for a new line)']]],
  ['Playlist editor', [['C', 'Split at playhead'], ['Q / E', 'Trim clip left / right to playhead'], ['Delete', 'Remove selected clip']]],
]

export function ShortcutsModal() {
  const open = useStore(s => s.shortcutsOpen)
  if (!open) return null
  return (
    <Modal title="Keyboard shortcuts" onClose={() => useStore.setState({ shortcutsOpen: false })} wide>
      <div className="shortcut-grid">
        {GROUPS.map(([title, rows]) => (
          <section key={title}><h4>{title}</h4>
            {rows.map(([k, d]) => (
              <div key={k} className="shortcut"><span>{d}</span>
                <span>{k.split(' ').filter(Boolean).map((p, i) => (p === '/' ? <em key={i}>/</em> : <kbd key={i}>{p}</kbd>))}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}

// ---------- hold-V voice input (Web Speech API) ----------
type Recognition = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean; onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void }
let rec: Recognition | null = null
let base = ''

/** Where dictated text goes: the Agent's draft by default, or a node's prompt box. */
export interface VoiceTarget { get(): string; set(text: string): void; done?(): void }
const agentTarget = (): VoiceTarget => {
  useStore.setState({ panel: 'agent' })
  useAgent.getState().set({ tab: 'chat' })
  return {
    get: () => useAgent.getState().draft.text,
    set: text => useAgent.setState(s => ({ draft: { ...s.draft, text } })),
    done: () => useAgent.getState().focusComposer(),
  }
}

export function startVoice(target?: VoiceTarget) {
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (!SR) { useStore.getState().notify('Voice input is not supported in this browser', 'error'); return false }
  rec?.abort()
  const t = target ?? agentTarget()
  base = t.get() ? t.get().trimEnd() + ' ' : ''
  rec = new SR() as Recognition
  rec.lang = navigator.language || 'en-US'
  rec.interimResults = true
  rec.continuous = true
  rec.onresult = e => t.set(base + [...e.results].map((r: any) => r[0].transcript).join(''))
  rec.onerror = e => { if (e.error !== 'aborted') useStore.getState().notify(`Voice input: ${e.error}`, 'error') }
  rec.onend = () => { rec = null; useStore.setState({ listening: false }); t.done?.() }
  rec.start()
  useStore.setState({ listening: true })
  return true
}
export function stopVoice() { rec?.stop() }
