import { decodeMimeWords } from './mime'
import { ProtocolError, tokenText, type ServerMessage, type Token } from './protocol'

/**
 * What a FETCH response says, as values.
 *
 * Three things need real work. The envelope, a fixed list of ten fields whose addresses are lists
 * of lists. The body structure, a tree whose shape depends on whether a part is a multipart, a
 * plain part or an embedded message. And the data items around them, which arrive in whatever
 * order the server likes.
 */

export interface Address {
  name?: string
  address?: string
}

export interface ParsedEnvelope {
  /** The Date header as the sender wrote it. Turning it into a moment is the caller's call. */
  date: string | null
  subject: string | null
  from: Address[]
  sender: Address[]
  replyTo: Address[]
  to: Address[]
  cc: Address[]
  bcc: Address[]
  inReplyTo: string | null
  messageId: string | null
}

export interface BodyNode {
  type: string
  subtype: string
  parameters: Record<string, string>
  /** Lower case: `attachment`, `inline`. */
  disposition: string | null
  dispositionParameters: Record<string, string>
  encoding: string | null
  size: number | null
  /** The parts of a multipart, or the single part inside a message/rfc822. */
  childNodes?: BodyNode[]
  /** The envelope of an embedded message. */
  envelope?: ParsedEnvelope
}

export interface FetchData {
  sequence: number
  uid?: number
  flags?: string[]
  size?: number
  internalDate?: string
  envelope?: ParsedEnvelope
  bodyStructure?: BodyNode
  /** Sections the response carried, by name: `BODY[]`, `BODY[TEXT]` and so on. */
  sections: Map<string, Uint8Array>
}

function nullableText(token: Token | undefined): string | null {
  if (!token || token.type === 'nil' || token.type === 'list') return null
  return tokenText(token)
}

function nullableDecoded(token: Token | undefined): string | null {
  const text = nullableText(token)
  return text === null ? null : decodeMimeWords(text)
}

/**
 * Turns the address lists of an envelope into addresses.
 *
 * A group, `Team: a@x, b@y;`, is written as an entry with a name and no host, then the members,
 * then an entry with neither. Both markers are dropped and the members are kept, so the people
 * in a group are not lost behind a name that is not an address.
 */
function readAddresses(token: Token | undefined): Address[] {
  if (!token || token.type !== 'list') return []
  const out: Address[] = []
  for (const entry of token.items) {
    if (entry.type !== 'list') continue
    const [name, , mailbox, host] = entry.items
    if (!mailbox || mailbox.type === 'nil') continue
    if (!host || host.type === 'nil') continue
    const decodedName = nullableDecoded(name)
    out.push({
      ...(decodedName ? { name: decodedName } : {}),
      address: `${tokenText(mailbox)}@${tokenText(host)}`
    })
  }
  return out
}

export function parseEnvelope(token: Token | undefined): ParsedEnvelope {
  if (!token || token.type !== 'list' || token.items.length < 10) {
    throw new ProtocolError('Envelope is not a list of ten fields')
  }
  const [date, subject, from, sender, replyTo, to, cc, bcc, inReplyTo, messageId] = token.items
  return {
    date: nullableText(date),
    subject: nullableDecoded(subject),
    from: readAddresses(from),
    sender: readAddresses(sender),
    replyTo: readAddresses(replyTo),
    to: readAddresses(to),
    cc: readAddresses(cc),
    bcc: readAddresses(bcc),
    inReplyTo: nullableText(inReplyTo),
    messageId: nullableText(messageId)
  }
}

function readParameters(token: Token | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!token || token.type !== 'list') return out
  for (let i = 0; i + 1 < token.items.length; i += 2) {
    out[tokenText(token.items[i]).toLowerCase()] = tokenText(token.items[i + 1])
  }
  return out
}

function readDisposition(token: Token | undefined): {
  disposition: string | null
  parameters: Record<string, string>
} {
  if (!token || token.type !== 'list' || token.items.length === 0) {
    return { disposition: null, parameters: {} }
  }
  return {
    disposition: tokenText(token.items[0]).toLowerCase(),
    parameters: readParameters(token.items[1])
  }
}

/**
 * Reads a body structure (RFC 3501, section 7.4.2).
 *
 * A multipart starts with its parts, each a list of its own, and then the subtype. Anything else
 * starts with the type. After the fields every kind has, the layout differs: a text part carries
 * a line count, an embedded message carries its envelope, its structure and a line count, and the
 * extension fields, of which only the disposition is read, follow after those.
 */
export function parseBodyStructure(token: Token | undefined): BodyNode {
  if (!token || token.type !== 'list') throw new ProtocolError('Body structure is not a list')
  const items = token.items

  if (items[0]?.type === 'list') {
    const childNodes: BodyNode[] = []
    let i = 0
    while (items[i]?.type === 'list') childNodes.push(parseBodyStructure(items[i++]))
    // After the parts: subtype, then parameters, disposition, language and location.
    const extension = items.slice(i + 1)
    const { disposition, parameters } = readDisposition(extension[1])
    return {
      type: 'multipart',
      subtype: tokenText(items[i]).toLowerCase(),
      parameters: readParameters(extension[0]),
      disposition,
      dispositionParameters: parameters,
      encoding: null,
      size: null,
      childNodes
    }
  }

  const type = tokenText(items[0]).toLowerCase()
  const subtype = tokenText(items[1]).toLowerCase()
  const node: BodyNode = {
    type,
    subtype,
    parameters: readParameters(items[2]),
    disposition: null,
    dispositionParameters: {},
    encoding: nullableText(items[5])?.toLowerCase() ?? null,
    size: items[6]?.type === 'number' ? items[6].value : null
  }

  // Fields 0 to 6 are common. Where the extension fields begin depends on what kind of part this is.
  let next = 7
  if (type === 'text') {
    next += 1
  } else if (type === 'message' && subtype === 'rfc822') {
    try {
      node.envelope = parseEnvelope(items[7])
      if (items[8]?.type === 'list') node.childNodes = [parseBodyStructure(items[8])]
    } catch {
      // A malformed embedded message must not take the whole structure down with it.
    }
    next += 3
  }
  // md5, then disposition.
  const { disposition, parameters } = readDisposition(items[next + 1])
  node.disposition = disposition
  node.dispositionParameters = parameters
  return node
}

/** Reads the data of one `* n FETCH (…)` response. */
export function parseFetch(message: ServerMessage): FetchData {
  if (message.kind !== 'data' || message.name !== 'FETCH' || message.number === null) {
    throw new ProtocolError('Not a FETCH response')
  }
  const list = message.tokens[0]
  if (!list || list.type !== 'list') throw new ProtocolError('FETCH without data items')

  const data: FetchData = { sequence: message.number, sections: new Map() }
  for (let i = 0; i + 1 < list.items.length; i += 2) {
    const name = tokenText(list.items[i]).toUpperCase()
    const value = list.items[i + 1]
    switch (name) {
      case 'UID':
        if (value.type === 'number') data.uid = value.value
        break
      case 'FLAGS':
        if (value.type === 'list') data.flags = value.items.map(tokenText)
        break
      case 'RFC822.SIZE':
        if (value.type === 'number') data.size = value.value
        break
      case 'INTERNALDATE':
        data.internalDate = tokenText(value)
        break
      case 'ENVELOPE':
        data.envelope = parseEnvelope(value)
        break
      case 'BODYSTRUCTURE':
        data.bodyStructure = parseBodyStructure(value)
        break
      default:
        if (name.startsWith('BODY[') || name.startsWith('BINARY[') || name === 'RFC822') {
          if (value.type === 'string') data.sections.set(name, value.bytes)
          // NIL means the section does not exist or was refused. Absence says the same.
        }
    }
  }
  return data
}
