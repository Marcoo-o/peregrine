import type { SqlDb } from '../db/sqlDb'
import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Attachment } from 'mailparser'
import { isInside, safeFilename } from '@peregrine/core/safeFilename'
import { insertAttachment, setAttachmentLocalPath } from '../db/repositories/attachmentsRepo'

/**
 * Writes the attachments of a parsed message to the cache and records them.
 *
 * Shared by the plain and the PGP read path: attachments of an encrypted message only come
 * into existence after decryption, but from there on they are handled like any other. Which
 * does mean they land in the cache in the clear. The cache is emptied automatically after
 * 30 days and can be cleared by hand under Privacy.
 */
export async function persistAttachments(
  db: SqlDb,
  accountId: string,
  messageId: string,
  attachments: Attachment[]
): Promise<void> {
  for (const attachment of attachments) {
    const attachmentId = await insertAttachment(db, {
      messageId,
      // What the message called this part, kept as it arrived. Not an identifier: two parts of
      // one message can carry the same name, or no name at all. Anything that has to name one
      // attachment uses the row id this call returns.
      partId: attachment.contentId ?? attachment.filename ?? 'part',
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      sizeBytes: attachment.size,
      isInline: attachment.contentDisposition === 'inline',
      contentId: attachment.contentId ?? null
    })
    const dir = join(app.getPath('userData'), 'attachments', accountId, messageId)
    await mkdir(dir, { recursive: true })

    // The name comes from the message, so it is written by whoever sent it. Joined unchanged,
    // `../../../x` left this directory and reached anywhere the user can write. See
    // `safeFilename` for what that made possible.
    const localPath = join(dir, safeFilename(attachment.filename, attachmentId))

    // Checked again rather than trusted. If a future change to `safeFilename` ever lets
    // something through, the write is refused here instead of landing somewhere unexpected.
    if (!isInside(dir, localPath, sep)) {
      console.error('refusing to write an attachment outside the cache:', localPath)
      continue
    }

    await writeFile(localPath, attachment.content)
    await setAttachmentLocalPath(db, attachmentId, localPath)
  }
}
