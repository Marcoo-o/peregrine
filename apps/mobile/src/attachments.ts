import { analyzeAttachmentName, type AttachmentFinding } from '@peregrine/core/attachmentSafety'
import { safeFilename } from '@peregrine/core/safeFilename'
import { decodeMimeWords } from '@peregrine/imap/mime'
import { childrenOf, parseHeaderValue, splitPart, undoTransferEncoding, type Part } from './mimeParts'
import { extensionFor, OCTET_STREAM } from './mimeTypes'

/** One attachment of a message, as a screen shows it. */
export interface AttachmentInfo {
  /** Where in the structure of the message it is, `2` or `2.1`. What `attachmentContent` takes. */
  id: string
  /** What it is called here: the name from the message made safe to write to a file system. */
  filename: string
  /** The name as the message gave it, or null when it gave none. */
  originalName: string | null
  contentType: string
  /** The size of the file, after the transfer encoding is undone. */
  size: number
  /** What the name gives away about it, see `analyzeAttachmentName`. */
  findings: AttachmentFinding[]
}

function nameOf(part: Part): string | null {
  const disposition = parseHeaderValue(part.headers.get('content-disposition'))
  const type = parseHeaderValue(part.headers.get('content-type'))
  const raw = disposition.params.get('filename') ?? type.params.get('name')
  if (raw === undefined || raw.trim() === '') return null
  // Some senders put an encoded word where only a plain value is allowed, and clients read it.
  return decodeMimeWords(raw).trim()
}

/**
 * Whether a part is an attachment and not a part of the text.
 *
 * It says so itself, or it has a name, or it is a file by its type: an image that is shown inside the
 * message has no name and is not text, and is listed all the same, as the attachment it is for anybody
 * who wants it. Text that has no name is the message.
 */
function isAttachment(part: Part): boolean {
  const type = parseHeaderValue(part.headers.get('content-type'))
  if (type.value.startsWith('multipart/')) return false
  if (parseHeaderValue(part.headers.get('content-disposition')).value === 'attachment') return true
  if (nameOf(part) !== null) return true
  const kind = type.value || 'text/plain'
  return !kind.startsWith('text/')
}

function describe(part: Part, id: string, position: number): AttachmentInfo {
  const type = parseHeaderValue(part.headers.get('content-type'))
  const contentType = type.value || OCTET_STREAM
  const originalName = nameOf(part)
  const fallback = `anhang-${position}${extensionFor(contentType)}`
  const filename = safeFilename(originalName, fallback)
  return {
    id,
    filename,
    originalName,
    contentType,
    size: undoTransferEncoding(part).length,
    // Judged by the name it will be saved under, which is the one a program would be started by.
    findings: analyzeAttachmentName(filename)
  }
}

/** The attachments of a message, in the order they are in it. */
export function listAttachments(source: Uint8Array): AttachmentInfo[] {
  const found: AttachmentInfo[] = []
  const walk = (part: Part, id: string): void => {
    const children = childrenOf(part)
    if (children.length > 0) {
      children.forEach((child, index) => walk(child, id === '' ? String(index + 1) : `${id}.${index + 1}`))
      return
    }
    if (isAttachment(part)) found.push(describe(part, id === '' ? '1' : id, found.length + 1))
  }
  walk(splitPart(source), '')
  return found
}

/** The bytes of one attachment, or undefined when the message has no such part. */
export function attachmentContent(source: Uint8Array, id: string): Uint8Array | undefined {
  let part = splitPart(source)
  // A message that is one part has it as its `1`.
  if (id === '1' && childrenOf(part).length === 0) return isAttachment(part) ? undoTransferEncoding(part) : undefined
  for (const step of id.split('.')) {
    const index = Number(step)
    if (!Number.isInteger(index) || index < 1) return undefined
    const child = childrenOf(part)[index - 1]
    if (!child) return undefined
    part = child
  }
  return isAttachment(part) ? undoTransferEncoding(part) : undefined
}
