/**
 * Tiny, safe markdown → HTML: headings (#–###), **bold**, *italic*, `code`,
 * [links](https://…), bullet / numbered lists, --- rules and paragraphs.
 * All input is HTML-escaped first; only http(s) links are emitted.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>')
}

export function renderMarkdown(src: string) {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = [] } }
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    let m: RegExpMatchArray | null
    if (!line.trim()) { flushPara(); closeList(); continue }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara()
      const kind = /^\s*\d/.test(line) ? 'ol' : 'ul'
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inline(m[1])}</li>`)
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara(); closeList()
  return out.join('')
}
