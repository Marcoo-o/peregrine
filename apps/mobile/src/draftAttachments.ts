import { attachmentContent, type AttachmentInfo } from './attachments'
import { attachPicked, type DraftAttachment, type RefusedFile } from './draft'
import { MAX_ATTACHMENT_BYTES, type Files, type PickedFile } from './files'
import { t } from './i18n'

/** What of the attachments of a message was taken over, and what was not and why. */
export interface BroughtAttachments {
  attachments: DraftAttachment[]
  /** Left out because the message would otherwise be too large. */
  refused: RefusedFile[]
  /** Left out because the message has no such part any more, or none that can be read. */
  missing: string[]
}

/**
 * Makes files of the phone of the attachments of a message that is written on again or passed on: each is copied into the
 * application's storage as a picked file is, and is attached like one, under the same limit for the message as a whole. What
 * does not fit is refused and its copy removed, as for a picked file, and what the message has no content for is said.
 * Nothing is left behind when copying one of them fails: the copies made so far are removed, and the failure is raised.
 */
export async function bringAttachments(
  source: Uint8Array | undefined,
  infos: AttachmentInfo[],
  files: Pick<Files, 'stash' | 'read' | 'remove'>,
  limit: number = MAX_ATTACHMENT_BYTES
): Promise<BroughtAttachments> {
  const stashed: PickedFile[] = []
  const missing: string[] = []
  try {
    for (const info of infos) {
      const content = source ? attachmentContent(source, info.id) : undefined
      if (!content) {
        missing.push(info.filename)
        continue
      }
      stashed.push(await files.stash(info.filename, info.contentType, content))
    }
  } catch (error) {
    await files.remove(stashed.map((file) => file.path)).catch(() => undefined)
    throw error
  }
  const { attachments, refused } = await attachPicked([], stashed, files, limit)
  return { attachments, refused, missing }
}

/** A line about what was not taken over, for the screen, or undefined when all of it was. */
export function notBroughtText(brought: Pick<BroughtAttachments, 'refused' | 'missing'>): string | undefined {
  const parts = [
    ...brought.refused.map((file) => t('{name} (zu groß für eine Nachricht)', { name: file.name })),
    ...brought.missing.map((name) => t('{name} (nicht lesbar)', { name }))
  ]
  return parts.length === 0 ? undefined : t('Nicht angehängt: {n}.', { n: parts.join(', ') })
}
