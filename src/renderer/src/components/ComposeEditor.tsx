import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Lock, Paperclip, PenLine, Send, Trash2, X } from 'lucide-react'
import type {
  AccountSummary,
  ComposeAttachmentInput,
  ComposeInput,
  ComposeSeed,
  Contact,
  Identity,
  EmailAddress
} from '@peregrine/core/types'
import { attachmentsFromPaths, shouldWarnAboutAttachment } from '@peregrine/core/attachmentHints'
import { toastError } from '@renderer/state/toastStore'
import { useSettingsStore } from '@renderer/state/settingsStore'
import RecipientInput, { splitRecipients } from './RecipientInput'
import RichTextEditor, { htmlToPlainText } from './RichTextEditor'
import SnoozeDialog from './SnoozeDialog'

export type ComposeInitialValues = Omit<ComposeSeed, 'accountId'>

interface ComposeEditorProps {
  accountId: string
  accounts: AccountSummary[]
  initialValues?: ComposeInitialValues
  /** Standalone compose windows close themselves; the embedded editor returns to the mailbox. */
  /** Receives the pending id when the send is waiting out its undo window. */
  onSent: (pendingId?: string) => void
  onCancel: () => void
  onAccountChange?: (accountId: string) => void
}

const AUTOSAVE_DELAY_MS = 4000

function parseAddressList(value: string): EmailAddress[] {
  return splitRecipients(value).map((address) => ({ name: '', address }))
}

function signatureHtml(signature: string | undefined): string {
  const trimmed = signature?.trim()
  if (!trimmed) return ''
  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  return `<br><br>-- <br>${escaped}`
}

/**
 * Swaps the signature when the sender changes.
 *
 * The delimiter `-- ` is the long-standing convention for where a signature starts, so
 * everything from the last one onwards is replaced. Anything typed above it survives. Which
 * matters, because switching sender halfway through writing is exactly when this happens.
 */
function replaceSignature(body: string, next: string): string {
  const marker = body.lastIndexOf('<br><br>-- <br>')
  const withoutOld = marker === -1 ? body : body.slice(0, marker)
  return `${withoutOld}${signatureHtml(next)}`
}

function ComposeEditor({
  accountId,
  accounts,
  initialValues,
  onSent,
  onCancel,
  onAccountChange
}: ComposeEditorProps): JSX.Element {
  const { t } = useTranslation()
  const account = accounts.find((a) => a.id === accountId)
  const settings = useSettingsStore((s) => s.settings)

  const [to, setTo] = useState(initialValues?.to ?? '')
  const [cc, setCc] = useState(initialValues?.cc ?? '')
  const [bcc, setBcc] = useState(initialValues?.bcc ?? '')
  const [showCc, setShowCc] = useState(Boolean(initialValues?.cc || initialValues?.bcc))
  const [subject, setSubject] = useState(initialValues?.subject ?? '')
  const [body, setBody] = useState(() => {
    if (initialValues?.htmlBody) return initialValues.htmlBody
    const quoted = initialValues?.textBody
      ? `<br><br>${initialValues.textBody.replace(/\n/g, '<br>')}`
      : ''
    return `${quoted}${signatureHtml(account?.signature)}`
  })
  const [attachments, setAttachments] = useState<ComposeAttachmentInput[]>([])
  const [sending, setSending] = useState(false)
  /** Highlights the window while files hover over it, so the drop has a visible target. */
  const [dropActive, setDropActive] = useState(false)
  /** The "send later" picker; open while set. */
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [encrypt, setEncrypt] = useState(account?.encryptByDefault ?? false)
  const [sign, setSign] = useState(settings.signByDefault)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [identityId, setIdentityId] = useState<string | undefined>(initialValues?.identityId)

  useEffect(() => {
    void window.peregrine.identities.list().then((all) => {
      setIdentities(all)
      // Keep whatever the seed chose (a reply answers from the address it was sent to);
      // otherwise start from this account's default.
      setIdentityId((current) => {
        if (current && all.some((i) => i.id === current)) return current
        const forAccount = all.filter((i) => i.accountId === accountId)
        const chosen = forAccount.find((i) => i.isDefault) ?? forAccount[0]
        // The body was built before the identities arrived, from the account signature.
        // Put the chosen identity's own signature in its place, but never over a draft or a
        // reply that was seeded with text already.
        if (chosen?.signature && !initialValues?.htmlBody) {
          setBody((body) => replaceSignature(body, chosen.signature))
        }
        return chosen?.id
      })
    })
  }, [accountId])
  const [draftUid, setDraftUid] = useState<number | null>(initialValues?.draftUid ?? null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirtyRef = useRef(false)
  const draftUidRef = useRef(draftUid)
  const sentRef = useRef(false)

  useEffect(() => {
    draftUidRef.current = draftUid
  }, [draftUid])

  useEffect(() => {
    window.peregrine.contacts.list().then(setContacts)
  }, [])

  function buildPayload(): ComposeInput {
    return {
      accountId,
      to: parseAddressList(to),
      cc: parseAddressList(cc),
      bcc: parseAddressList(bcc),
      subject,
      textBody: htmlToPlainText(body),
      htmlBody: body,
      attachments,
      inReplyTo: initialValues?.inReplyTo,
      references: initialValues?.references,
      identityId,
      encrypt,
      sign,
      draftUid: draftUidRef.current ?? undefined
    }
  }

  async function saveDraft(): Promise<void> {
    if (sentRef.current) return
    setSaving(true)
    try {
      const result = await window.peregrine.compose.saveDraft(buildPayload())
      setDraftUid(result.draftUid)
      setSavedAt(result.savedAt)
      dirtyRef.current = false
    } catch (err) {
      toastError(err, t('compose.draftSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Debounced autosave: every edit restarts the timer, so a save only lands once typing pauses.
  useEffect(() => {
    if (!dirtyRef.current) return
    const handle = setTimeout(() => void saveDraft(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(handle)
  }, [to, cc, bcc, subject, body, attachments])

  function markDirty<T>(setter: (value: T) => void): (value: T) => void {
    return (value: T) => {
      dirtyRef.current = true
      setter(value)
    }
  }

  function addAttachments(paths: string[]): void {
    setAttachments((prev) => {
      const added = attachmentsFromPaths(
        paths,
        prev.map((a) => a.path)
      )
      if (added.length === 0) return prev
      dirtyRef.current = true
      return [...prev, ...added]
    })
  }

  async function handlePickAttachments(): Promise<void> {
    const { filePaths } = await window.peregrine.attachments.pickFiles()
    addAttachments(filePaths)
  }

  /**
   * Files dropped onto the composer.
   *
   * The whole window accepts them, not just the attachment strip: aiming at a narrow target
   * is exactly the fiddling that dragging was meant to save. Text dragged in from elsewhere
   * still lands in the editor, so only drops carrying files are taken.
   */
  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    const paths = [...event.dataTransfer.files].map((file) => window.peregrine.filePath(file))
    if (paths.length === 0) return
    event.preventDefault()
    addAttachments(paths)
    setDropActive(false)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDropActive(true)
  }

  async function handleSend(sendAt?: number): Promise<void> {
    // Asked once, and only when the text actually announced an enclosure. Sending anyway is
    // the default answer: the writer knows better than the pattern does.
    if (shouldWarnAboutAttachment(body, attachments.length)) {
      if (!window.confirm(t('compose.attachmentMissing'))) return
    }

    setSending(true)
    try {
      const result = await window.peregrine.compose.send({ ...buildPayload(), sendAt })
      sentRef.current = true
      // With a grace period the window closes at once and the countdown runs in the mailbox;
      // keeping the composer open would suggest the mail had not gone yet.
      onSent(result.pendingId)
    } catch (err) {
      toastError(err, t('compose.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  async function handleDiscard(): Promise<void> {
    if (draftUidRef.current != null) {
      try {
        await window.peregrine.compose.deleteDraft({ accountId, uid: draftUidRef.current })
      } catch (err) {
        toastError(err, t('compose.draftDeleteFailed'))
      }
    }
    sentRef.current = true
    onCancel()
  }

  const recipientCount = splitRecipients(to).length + splitRecipients(cc).length + splitRecipients(bcc).length

  return (
    <div
      className={dropActive ? 'compose-editor drop-active' : 'compose-editor'}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <div className="compose-header">
        <label className="compose-from">
          <span className="compose-row-label">{t('compose.from')}</span>
          {/* One entry per identity, not per account: an account with three sender addresses
              offers all three, and picking one also switches the account it sends over. */}
          <select
            value={identityId ?? ''}
            onChange={(event) => {
              const identity = identities.find((i) => i.id === event.target.value)
              if (!identity) return
              const previous = identities.find((i) => i.id === identityId)
              setIdentityId(identity.id)
              // Only touch the body when the signature actually differs, so switching between
              // two identities that share one leaves the text completely alone.
              if (previous?.signature !== identity.signature) {
                setBody((current) => replaceSignature(current, identity.signature))
              }
              if (identity.accountId !== accountId) onAccountChange?.(identity.accountId)
            }}
            disabled={identities.length <= 1}
          >
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.displayName
                  ? `${identity.displayName} <${identity.emailAddress}>`
                  : identity.emailAddress}
              </option>
            ))}
          </select>
        </label>
        <span className="compose-draft-state">
          {saving
            ? t('compose.savingDraft')
            : savedAt
              ? t('compose.draftSaved', {
                  time: new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(
                    new Date(savedAt)
                  )
                })
              : ''}
        </span>
      </div>

      <RecipientInput
        label={t('compose.to')}
        value={to}
        contacts={contacts}
        autoFocus={!initialValues?.to}
        onChange={markDirty(setTo)}
      />
      {showCc ? (
        <>
          <RecipientInput
            label={t('compose.cc')}
            value={cc}
            contacts={contacts}
            onChange={markDirty(setCc)}
          />
          <RecipientInput
            label={t('compose.bcc')}
            value={bcc}
            contacts={contacts}
            onChange={markDirty(setBcc)}
          />
        </>
      ) : (
        <button className="compose-cc-toggle" onClick={() => setShowCc(true)}>
          {t('compose.addCcBcc')}
        </button>
      )}

      <div className="compose-subject-row">
        <span className="compose-row-label">{t('compose.subject')}</span>
        <input
          className="compose-field compose-subject"
          value={subject}
          onChange={(e) => markDirty(setSubject)(e.target.value)}
        />
      </div>

      <RichTextEditor html={body} onChange={markDirty(setBody)} />

      <div className="compose-attachments">
        <button onClick={handlePickAttachments}>
          <Paperclip size={15} strokeWidth={1.75} />
          {t('compose.addAttachment')}
        </button>
        <ul>
          {attachments.map((a) => (
            <li key={a.path}>
              {a.filename}
              <button
                className="icon-button"
                aria-label={t('compose.removeAttachment')}
                onClick={() => {
                  dirtyRef.current = true
                  setAttachments((prev) => prev.filter((item) => item.path !== a.path))
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="compose-security-toggles">
        <label className="compose-encrypt-toggle">
          <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
          <Lock size={14} strokeWidth={1.75} />
          {t('compose.encrypt')}
        </label>
        {/* Encrypting always signs as well, so the separate switch would only be misleading. */}
        <label className="compose-encrypt-toggle">
          <input
            type="checkbox"
            checked={sign || encrypt}
            disabled={encrypt}
            onChange={(e) => setSign(e.target.checked)}
          />
          <PenLine size={14} strokeWidth={1.75} />
          {t('compose.sign')}
        </label>
      </div>

      <div className="compose-actions">
        <button onClick={handleDiscard} disabled={sending}>
          <Trash2 size={15} strokeWidth={1.75} />
          {t('compose.discard')}
        </button>
        <button onClick={() => void saveDraft()} disabled={sending || saving}>
          {t('compose.saveDraft')}
        </button>
        <button onClick={onCancel} disabled={sending}>
          <X size={15} strokeWidth={1.75} />
          {t('compose.close')}
        </button>
        {/* The same choices as "remind me later", and for the same reason: picking a moment
            is a two-second decision, and a date picker as the first thing on screen costs
            more attention than the message did. */}
        <button
          onClick={() => setScheduleOpen(true)}
          disabled={sending || recipientCount === 0}
          title={t('compose.sendLater')}
        >
          <Clock size={15} strokeWidth={1.75} />
        </button>
        <button onClick={() => void handleSend()} disabled={sending || recipientCount === 0}>
          <Send size={15} strokeWidth={1.75} />
          {sending ? t('compose.sending') : t('compose.send')}
        </button>
      </div>

      {scheduleOpen && (
        <SnoozeDialog
          count={1}
          title={t('compose.sendLater')}
          onChoose={(at) => {
            setScheduleOpen(false)
            void handleSend(at)
          }}
          onCancel={() => setScheduleOpen(false)}
        />
      )}
    </div>
  )
}

export default ComposeEditor
