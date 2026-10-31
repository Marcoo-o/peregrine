/**
 * Formatted text for writing, without an editor that draws it: the user types a few markers (`**bold**`, `_italic_`, `- ` for a list, `> ` for a quote,
 * `[text](address)` for a link) and a toolbar types them. The text as typed is the plain part of the message, which reads well without being drawn, and
 * the HTML beside it is made from it. The HTML carries a mark, so that a draft that was kept can be opened and written on again from its text.
 */

/** In the HTML of a message that was written here. It is what tells the phone the text beside it is the source and not only a plain copy. */
export const FORMAT_MARK = '<!--peregrine-markdown-->'

/** Whether the HTML of a message was made by this: the one kind of formatted draft that can be written on again. */
export const isFormattedHtml = (html: string | null | undefined): boolean => html != null && html.includes(FORMAT_MARK)

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Only these may be the target of a link that is written: nothing that runs, and nothing that reads a file of the recipient's. */
const SAFE_TARGET = /^(https?:\/\/|mailto:)/i

function inline(source: string): string {
  const kept: string[] = []
  const keep = (html: string): string => `\u0000${kept.push(html) - 1}\u0000`
  let text = escapeHtml(source)
  text = text.replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, target: string) => {
    const address = target.replace(/&amp;/g, '&')
    return SAFE_TARGET.test(address) ? keep(`<a href="${escapeHtml(address)}">${label}</a>`) : whole
  })
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_, before: string, address: string) => `${before}${keep(`<a href="${address}">${address}</a>`)}`)
  text = text.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/~~(\S(?:.*?\S)?)~~/g, '<s>$1</s>')
  text = text.replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>')
  text = text.replace(/(^|\W)_([^\s_](?:[^_\n]*?[^\s_])?)_(?!\w)/g, '$1<em>$2</em>')
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)])
}

const QUOTE_STYLE = 'border-left:3px solid #c5cbd3;margin:0 0 8px;padding-left:10px;color:#4a5568'

function blocks(lines: string[]): string {
  const out: string[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    if (line.trim() === '') {
      at++
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length + 1
      out.push(`<h${level} style="margin:0 0 8px">${inline(heading[2])}</h${level}>`)
      at++
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>')
      at++
      continue
    }
    if (/^>/.test(line)) {
      const quoted: string[] = []
      while (at < lines.length && /^>/.test(lines[at])) quoted.push(lines[at++].replace(/^>\s?/, ''))
      out.push(`<blockquote style="${QUOTE_STYLE}">${blocks(quoted)}</blockquote>`)
      continue
    }
    const bullet = /^\s*[-*•]\s+/
    const number = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line)
      const pattern = ordered ? number : bullet
      const items: string[] = []
      while (at < lines.length && pattern.test(lines[at])) items.push(`<li>${inline(lines[at++].replace(pattern, ''))}</li>`)
      out.push(`<${ordered ? 'ol' : 'ul'} style="margin:0 0 8px;padding-left:24px">${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    const paragraph: string[] = []
    while (at < lines.length && lines[at].trim() !== '' && !/^(#{1,3}\s|>|\s*[-*•]\s+\S|\s*\d+[.)]\s+\S|\s*(-{3,}|\*{3,})\s*$)/.test(lines[at])) paragraph.push(inline(lines[at++]))
    // A line that looks like a start of something but is not (a lone "-"), taken as text, so that no line is lost.
    if (paragraph.length === 0) paragraph.push(inline(lines[at++]))
    out.push(`<p style="margin:0 0 8px">${paragraph.join('<br>')}</p>`)
  }
  return out.join('')
}

/** The HTML of what was typed, with the mark that says it came from here. Nothing typed becomes a tag: it is all escaped first. */
export function renderHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  return `${FORMAT_MARK}<div style="font-family:sans-serif;font-size:15px;line-height:1.5">${blocks(lines)}</div>`
}

export interface Selection {
  start: number
  end: number
}

export interface Edit {
  text: string
  selection: Selection
}

const ordered = (a: Selection): Selection => ({ start: Math.min(a.start, a.end), end: Math.max(a.start, a.end) })

/**
 * Puts a marker round the selection, or takes it off when it is there already. With nothing selected the two markers are put in and the cursor
 * is left between them, to type the word in.
 */
export function toggleWrap(text: string, selection: Selection, marker: string): Edit {
  const { start, end } = ordered(selection)
  const before = text.slice(0, start)
  const middle = text.slice(start, end)
  const after = text.slice(end)
  if (before.endsWith(marker) && after.startsWith(marker) && middle !== '') {
    return { text: before.slice(0, -marker.length) + middle + after.slice(marker.length), selection: { start: start - marker.length, end: end - marker.length } }
  }
  if (middle.length >= marker.length * 2 && middle.startsWith(marker) && middle.endsWith(marker)) {
    const inner = middle.slice(marker.length, -marker.length)
    return { text: before + inner + after, selection: { start, end: start + inner.length } }
  }
  return { text: before + marker + middle + marker + after, selection: { start: start + marker.length, end: end + marker.length } }
}

/**
 * Puts a prefix before every line the selection touches (`- `, `> `, `# `, or numbers), or takes it off when all of them have it.
 * The selection follows the text.
 */
export function toggleLines(text: string, selection: Selection, prefix: '- ' | '> ' | '# ' | '1. '): Edit {
  const { start, end } = ordered(selection)
  const from = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', end)
  const to = lineEnd === -1 ? text.length : lineEnd
  const lines = text.slice(from, to).split('\n')
  const numbered = prefix === '1. '
  const has = (line: string) => (numbered ? /^\d+\.\s/.test(line) : line.startsWith(prefix))
  const remove = lines.every((line) => line === '' || has(line))
  const changed = lines.map((line, index) => {
    if (remove) return numbered ? line.replace(/^\d+\.\s/, '') : line.slice(prefix.length)
    if (line === '') return line
    return `${numbered ? `${index + 1}. ` : prefix}${line}`
  })
  const next = changed.join('\n')
  const delta = next.length - (to - from)
  return { text: text.slice(0, from) + next + text.slice(to), selection: { start: Math.max(from, start + (changed[0].length - lines[0].length)), end: end + delta } }
}

/** A link: the selected words become its text, or the address is its own text. */
export function insertLink(text: string, selection: Selection, address: string): Edit {
  const { start, end } = ordered(selection)
  const label = text.slice(start, end) || address
  const link = `[${label}](${address})`
  return { text: text.slice(0, start) + link + text.slice(end), selection: { start: start + link.length, end: start + link.length } }
}
