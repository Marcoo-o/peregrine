/**
 * Reading and writing vCard files, the format every address book exports to.
 *
 * Only the two fields Peregrine stores are handled: a display name and an address. A card
 * carries far more, and dropping the rest on import is a real loss, but inventing columns
 * for fields nothing in the application reads would be a worse one.
 */

export interface VCardEntry {
  name: string
  email: string
}

/**
 * Folds long lines back together.
 *
 * RFC 6350 lets a writer break a line anywhere and continue it on the next one, marked by a
 * leading space or tab. Base64 photos are the usual reason, but a long name is enough, so
 * unfolding has to happen before anything is parsed rather than only for the fields we skip.
 */
function unfoldLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const unfolded: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1)
      continue
    }
    unfolded.push(line)
  }
  return unfolded
}

/** Splits `FN;CHARSET=UTF-8:John` into its name, its parameters and its value. */
function splitProperty(line: string): { name: string; params: string[]; value: string } | null {
  const colon = line.indexOf(':')
  if (colon === -1) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(';')
  return {
    name: (parts[0] ?? '').trim().toUpperCase(),
    params: parts.slice(1).map((p) => p.trim().toUpperCase()),
    value
  }
}

/** Undoes the escaping the format requires inside a value. */
function unescapeValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

/** Builds a display name out of the structured N property, which is surname-first. */
function nameFromStructured(value: string): string {
  const [family, given, additional] = value.split(';').map((part) => unescapeValue(part))
  return [given, additional, family].filter((part) => part).join(' ')
}

/**
 * Reads every card in a file.
 *
 * A card without an address is skipped rather than stored under an empty one: the address is
 * the only thing that makes a contact usable here, and the unique index on it would collapse
 * all of them into a single row anyway.
 */
export function parseVCards(text: string): VCardEntry[] {
  const entries: VCardEntry[] = []
  let formattedName = ''
  let structuredName = ''
  let emails: string[] = []
  let inCard = false

  for (const line of unfoldLines(text)) {
    const property = splitProperty(line)
    if (!property) continue

    if (property.name === 'BEGIN' && property.value.trim().toUpperCase() === 'VCARD') {
      inCard = true
      formattedName = ''
      structuredName = ''
      emails = []
      continue
    }
    if (!inCard) continue

    if (property.name === 'END' && property.value.trim().toUpperCase() === 'VCARD') {
      inCard = false
      const name = formattedName || (structuredName ? nameFromStructured(structuredName) : '')
      // One card, several addresses: each becomes its own contact, since a contact here is
      // an address. They share the name, which is what the address book shows.
      for (const email of emails) entries.push({ name, email })
      continue
    }

    // Quoted-printable and base64 values are not decoded; a name in either is rare enough
    // that carrying an encoder for it costs more than it returns.
    if (property.params.some((p) => p.startsWith('ENCODING='))) continue

    if (property.name === 'FN') formattedName = unescapeValue(property.value)
    else if (property.name === 'N') structuredName = property.value
    else if (property.name === 'EMAIL') {
      const email = unescapeValue(property.value).replace(/^mailto:/i, '')
      if (email.includes('@')) emails.push(email)
    }
  }

  return entries
}

/** Escapes a value so that a comma or a line break survives the round trip. */
function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * Writes cards in vCard 3.0.
 *
 * Version 4 is the current one, but 3.0 is what Outlook, the macOS address book and most
 * phones read without complaint, and nothing written here needs anything newer.
 */
export function serializeVCards(entries: VCardEntry[]): string {
  const cards = entries.map((entry) => {
    const name = escapeValue(entry.name || entry.email)
    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${name}`,
      `N:${name};;;;`,
      `EMAIL;TYPE=INTERNET:${escapeValue(entry.email)}`,
      'END:VCARD'
    ].join('\r\n')
  })
  return cards.length > 0 ? cards.join('\r\n') + '\r\n' : ''
}
