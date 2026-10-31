import { useState } from 'react'
import { shouldWarnAboutAttachment } from '@peregrine/core/attachmentHints'
import { refusedFilesText } from '../attachmentText'
import { attachPicked, detachFile, type Draft } from '../draft'
import { explainError } from '../errors'
import type { Files } from '../files'
import { t } from '../i18n'

/**
 * The state of the screen for writing a message: what was typed, what was attached and what was said
 * about it, and the one hold-back for a message that talks of an attachment and has none.
 */
export function useComposeForm(initial: Draft, files: Files) {
  const [draft, setDraft] = useState<Draft>(initial)
  const [notice, setNotice] = useState<string | null>(null)
  const [warned, setWarned] = useState(false)

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  /** Lets the user pick files and attaches them, saying which were refused. */
  async function pick(): Promise<void> {
    try {
      const picked = await files.pick()
      if (picked.length === 0) return
      const { attachments, refused } = await attachPicked(draft.attachments, picked, files)
      update({ attachments })
      setNotice(refused.length > 0 ? refusedFilesText(refused) : null)
    } catch (error) {
      setNotice(t('Anhängen ging nicht: {n}', { n: explainError(error) }))
    }
  }

  async function detach(path: string): Promise<void> {
    update({ attachments: await detachFile(draft.attachments, path, files) })
  }

  const talksOfAnAttachment = shouldWarnAboutAttachment(draft.body, draft.attachments.length)
  /** The warning has been shown and the user is asked once more whether the message is to go as it is. */
  const confirming = talksOfAnAttachment && warned

  /** Whether the message may go now. A message that talks of an attachment and has none is held back once. */
  function mayGo(): boolean {
    if (talksOfAnAttachment && !warned) {
      setWarned(true)
      return false
    }
    return true
  }

  return { draft, update, notice, pick, detach, confirming, mayGo }
}
