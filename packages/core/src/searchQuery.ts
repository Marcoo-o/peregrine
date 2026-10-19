/**
 * Search syntax shared by the main process (which executes it) and the renderer (which
 * explains it). Operators are matched against SQL columns rather than full-text index
 * columns, so the syntax stays stable no matter how the FTS index is laid out.
 */
export interface ParsedSearchQuery {
  /** Whatever was not an operator. Handed to full-text search. */
  text: string
  from?: string
  to?: string
  subject?: string
  hasAttachment?: boolean
  isUnread?: boolean
  isFlagged?: boolean
  /** ISO dates; `before` is exclusive, `after` inclusive. */
  before?: string
  after?: string
}

/** Both languages are accepted, because the UI language is not the muscle memory language. */
const FIELD_ALIASES: Record<string, keyof ParsedSearchQuery> = {
  von: 'from',
  from: 'from',
  an: 'to',
  to: 'to',
  betreff: 'subject',
  subject: 'subject'
}

const FLAG_ALIASES: Record<string, 'hasAttachment' | 'isUnread' | 'isFlagged'> = {
  'hat:anhang': 'hasAttachment',
  'has:attachment': 'hasAttachment',
  'ist:ungelesen': 'isUnread',
  'is:unread': 'isUnread',
  'ist:markiert': 'isFlagged',
  'is:starred': 'isFlagged',
  'is:flagged': 'isFlagged'
}

const DATE_ALIASES: Record<string, 'before' | 'after'> = {
  vor: 'before',
  before: 'before',
  nach: 'after',
  after: 'after'
}

/**
 * Splits on spaces but keeps "quoted phrases" together. Including the quoted value of an
 * operator, as in betreff:"Ihre Rechnung".
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  const pattern = /(?:[^\s:"]+:)?"[^"]*"|\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[0])
  }
  return tokens
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/s, '$1')
}

function normalizeDate(value: string): string | undefined {
  // Accept 2026-08-05 and 05.08.2026; anything else is treated as free text by the caller.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value)
  if (german) {
    const day = german[1].padStart(2, '0')
    const month = german[2].padStart(2, '0')
    return `${german[3]}-${month}-${day}`
  }
  return undefined
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = { text: '' }
  const freeText: string[] = []

  for (const token of tokenize(input)) {
    const lower = token.toLowerCase()

    const flag = FLAG_ALIASES[lower]
    if (flag) {
      result[flag] = true
      continue
    }

    const separator = token.indexOf(':')
    if (separator > 0) {
      const key = lower.slice(0, separator)
      const value = unquote(token.slice(separator + 1))

      const dateField = DATE_ALIASES[key]
      if (dateField && value) {
        const normalized = normalizeDate(value)
        if (normalized) {
          result[dateField] = normalized
          continue
        }
      }

      const field = FIELD_ALIASES[key]
      if (field && value) {
        // Repeating an operator narrows it further rather than replacing it.
        const existing = result[field]
        result[field] = (typeof existing === 'string' ? `${existing} ${value}` : value) as never
        continue
      }
    }

    freeText.push(unquote(token))
  }

  result.text = freeText.join(' ').trim()
  return result
}

/** True when the query says something beyond free text. Used to decide whether FTS is needed. */
export function hasStructuredFilters(query: ParsedSearchQuery): boolean {
  return Boolean(
    query.from ||
      query.to ||
      query.subject ||
      query.hasAttachment ||
      query.isUnread ||
      query.isFlagged ||
      query.before ||
      query.after
  )
}
