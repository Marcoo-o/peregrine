import type { SqlDb } from '../sqlDb'
import { randomUUID } from 'node:crypto'
import type { AttachmentMeta } from '@peregrine/core/types'

interface AttachmentRow {
  id: string
  filename: string | null
  content_type: string | null
  size_bytes: number | null
  is_inline: number
  content_id: string | null
}

function toMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    filename: row.filename ?? '',
    contentType: row.content_type ?? 'application/octet-stream',
    sizeBytes: row.size_bytes ?? 0,
    isInline: row.is_inline === 1,
    contentId: row.content_id
  }
}

export async function listAttachments(db: SqlDb, messageId: string): Promise<AttachmentMeta[]> {
  const rows = await db.all<AttachmentRow>(
    'SELECT * FROM attachments WHERE message_id = ?',
    messageId
  )
  return rows.map(toMeta)
}

export interface NewAttachmentInput {
  messageId: string
  partId: string
  filename: string | null
  contentType: string | null
  sizeBytes: number
  isInline: boolean
  contentId: string | null
}

export async function insertAttachment(db: SqlDb, input: NewAttachmentInput): Promise<string> {
  const id = randomUUID()
  await db.run(
    `INSERT INTO attachments (id, message_id, part_id, filename, content_type, size_bytes, is_inline, content_id)
     VALUES (@id, @messageId, @partId, @filename, @contentType, @sizeBytes, @isInline, @contentId)`,
    {
      id,
      messageId: input.messageId,
      partId: input.partId,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      isInline: input.isInline ? 1 : 0,
      contentId: input.contentId
    }
  )
  return id
}

/**
 * The cached file behind one attachment, or null when it was never downloaded or was cleared.
 *
 * By the row's own id, and the message is asked for as well so a caller cannot reach an
 * attachment of some other message by holding its id alone.
 */
export async function getAttachmentLocalPath(
  db: SqlDb,
  messageId: string,
  attachmentId: string
): Promise<string | null> {
  const row = await db.get<{ local_path: string | null }>(
    'SELECT local_path FROM attachments WHERE id = ? AND message_id = ?',
    attachmentId,
    messageId
  )
  return row?.local_path ?? null
}

/** Forgets every cached file path, for when the cache itself has been emptied. */
export async function clearAttachmentLocalPaths(db: SqlDb): Promise<void> {
  await db.run('UPDATE attachments SET local_path = NULL')
}

export async function setAttachmentLocalPath(
  db: SqlDb,
  attachmentId: string,
  localPath: string
): Promise<void> {
  await db.run('UPDATE attachments SET local_path = ? WHERE id = ?', localPath, attachmentId)
}
