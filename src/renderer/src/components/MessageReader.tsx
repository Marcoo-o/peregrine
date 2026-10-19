import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  BadgeCheck,
  BookOpenText,
  FileCode2,
  ChevronDown,
  Forward,
  ImageOff,
  Mail,
  MailOpen,
  MoreHorizontal,
  Printer,
  FileDown,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Star,
  Trash2
} from 'lucide-react'
import type { AttachmentMeta, FolderNode, MessageDetail } from '@peregrine/core/types'
import { analyzeLink, analyzeSender, type LinkAnalysis } from '@peregrine/core/linkSafety'
import { analyzeAttachmentName } from '@peregrine/core/attachmentSafety'
import { failedChecks } from '@peregrine/core/authResults'
import { useSettingsStore } from '@renderer/state/settingsStore'
import { toastError, toastInfo } from '@renderer/state/toastStore'
import SuspiciousBanner from './SuspiciousBanner'
import MessageSourceDialog from './MessageSourceDialog'
import SenderKeyRow from './SenderKeyRow'
import { buildPrintDocument, suggestedPdfName } from '@renderer/util/printMessage'
import { sanitizeMailHtml } from '@renderer/util/sanitizeMail'
import { formatBytes, formatFullDate, initialFor } from '@renderer/util/format'
import { folderLabel } from '@renderer/util/folderLabel'

export interface ReaderActions {
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onArchive: () => void
  onJunk: () => void
  onDelete: () => void
  onMarkUnread: () => void
  onToggleFlag: () => void
  onMoveTo: (folderId: string) => void
  /**
   * The sender's key changed, so the message has to be read again.
   *
   * The PGP status is decided while decrypting and verifying, which happens once when the
   * message is opened. Fetching the key afterwards makes that verdict stale: the badge would
   * keep saying "sender key missing" right underneath a line naming the key that was just
   * found. Re-reading recomputes it. And if the signature turns out not to match the key,
   * that is a different verdict again, and one worth seeing.
   */
  onSenderKeyStored: () => void
}

interface MessageReaderProps {
  message: MessageDetail | null
  loading: boolean
  /** Move targets: the folders of the message's own account. */
  moveTargets: FolderNode[]
  flagged: boolean
  actions: ReaderActions
}

const HEIGHT_MESSAGE_SOURCE = 'peregrine-mail-reader'

// Runs inside the sandboxed peregrine-mail:// document to report its content height back to
// the host page, so the reader panel can grow to fit the message instead of double-scrolling.
// The exact text is hashed into the document's CSP (script-src 'sha256-...') so only this
// known-safe snippet may execute. Any script surviving DOMPurify would still be blocked.
const RESIZE_SCRIPT = `function reportHeight(){try{window.parent.postMessage({source:'${HEIGHT_MESSAGE_SOURCE}',height:document.documentElement.scrollHeight},'*')}catch(e){}}
window.addEventListener('load',reportHeight);
new ResizeObserver(reportHeight).observe(document.documentElement);
reportHeight();`

async function sha256Base64(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

function blockRemoteContent(html: string): string {
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])(https?:)/gi, '<img$1 data-blocked-src=$2$3')
}

function allowRemoteContent(html: string): string {
  return html.replace(/data-blocked-src=/gi, 'src=')
}


const BASE_STYLE = 'html,body{margin:0;padding:0;overflow:hidden}'

/**
 * Newsletters routinely set light text expecting a dark *background image*. With remote
 * content blocked that background never loads, leaving white-on-white text. Reading mode
 * drops author colours/backgrounds entirely and renders the text at guaranteed contrast,
 * the same escape hatch Thunderbird offers as "simple HTML view".
 */
const READING_MODE_STYLE = `
  *{background-image:none!important;background-color:transparent!important;color:#1b1f24!important;
    border-color:#d0d4d9!important;text-shadow:none!important}
  html,body{background:#ffffff!important}
  a,a *{color:#1a4f8a!important;text-decoration:underline!important}
  img{max-width:100%!important;height:auto!important}
  table{width:auto!important;max-width:100%!important}
`

const EXTRA_BODY_END = `<script>${RESIZE_SCRIPT}</script>`

// `sanitizedDoc` is a full document (DOMPurify ran with WHOLE_DOCUMENT: true, see below).
// Most HTML emails carry their real layout/icon-sizing CSS in a <head><style> block, which a
// plain fragment-mode sanitize would have silently dropped. Inject our additions into the
// existing head/body rather than re-wrapping, so that block survives untouched. Our <style>
// goes in last so its !important rules win over the author stylesheet in reading mode.
function injectIntoDocument(sanitizedDoc: string, readingMode: boolean): string {
  const extraHead = `<base target="_blank"><style>${BASE_STYLE}${
    readingMode ? READING_MODE_STYLE : ''
  }</style>`

  let result = sanitizedDoc
  if (/<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${extraHead}</head>`)
  } else if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/<head[^>]*>/i, (m) => `${m}${extraHead}`)
  } else {
    result = `<head>${extraHead}</head>${result}`
  }
  if (/<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `${EXTRA_BODY_END}</body>`)
  } else {
    result = `${result}${EXTRA_BODY_END}`
  }
  return result
}

const MIN_FRAME_HEIGHT = 200

/**
 * Upper bound for the reported height.
 *
 * The number comes from the sender's own document, so it is theirs to choose. Twenty thousand
 * pixels is longer than any message anyone reads and short enough that reserving it costs
 * nothing. Beyond this the frame simply scrolls.
 */
const MAX_FRAME_HEIGHT = 20_000

function AttachmentBar({
  message,
  attachments
}: {
  message: MessageDetail
  attachments: AttachmentMeta[]
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const warnRiskyAttachments = useSettingsStore((s) => s.settings.warnRiskyAttachments)

  return (
    <div className="attachment-bar">
      <Paperclip size={13} strokeWidth={1.75} />
      <span className="attachment-bar-label">
        {t('mailbox.attachmentCount', { count: attachments.length })}
      </span>
      {attachments.map((attachment) => {
        const findings = warnRiskyAttachments
          ? analyzeAttachmentName(attachment.filename ?? '')
          : []
        return (
        <span
          className={findings.length > 0 ? 'attachment-chip risky' : 'attachment-chip'}
          key={attachment.id}
        >
          {findings.length > 0 && (
            <span
              className="attachment-risk"
              title={findings
                .map((f) => t(`attachments.risk.${f.risk}`, { detail: f.detail }))
                .join('\n')}
            >
              <ShieldAlert size={12} strokeWidth={1.75} />
            </span>
          )}
          <button
            className="attachment-open"
            title={t('mailbox.openAttachment')}
            onClick={() => {
              // An executable is opened only after saying so out loud. The dialog names the
              // extension, because that is the part the file name was built to hide.
              if (findings.some((f) => f.risk === 'executable' || f.risk === 'doubleExtension')) {
                const proceed = window.confirm(
                  t('attachments.confirmOpen', {
                    name: attachment.filename || t('mailbox.unnamedAttachment')
                  })
                )
                if (!proceed) return
              }
              // The main process reads the first bytes and refuses what runs, or what is
              // not what its name claims. Both are reported here rather than failing quietly.
              void window.peregrine.attachments
                .open({
                  messageId: message.id,
                  attachmentId: attachment.id
                })
                .then((result) => {
                  if (result.refused) {
                    toastError(
                      new Error(t(`attachments.refused.${result.refused}`)),
                      t('attachments.refusedTitle')
                    )
                  }
                })
            }}
          >
            {attachment.filename || t('mailbox.unnamedAttachment')}
          </button>
          <span className="attachment-size">{formatBytes(attachment.sizeBytes, i18n.language)}</span>
          <button
            className="attachment-save"
            title={t('mailbox.saveAttachment')}
            onClick={() =>
              void window.peregrine.attachments.saveAs({
                messageId: message.id,
                attachmentId: attachment.id,
                suggestedName: attachment.filename || 'attachment'
              })
            }
          >
            ↓
          </button>
        </span>
        )
      })}
    </div>
  )
}

function MessageReader({
  message,
  loading,
  moveTargets,
  flagged,
  actions
}: MessageReaderProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const blockRemoteImages = useSettingsStore((s) => s.settings.blockRemoteImages)
  const warnSuspiciousLinks = useSettingsStore((s) => s.settings.warnSuspiciousLinks)

  /**
   * Domains the user actually corresponds with, for spotting imitations of them.
   *
   * Only frequent contacts count. A list of famous brands instead would warn about mail from
   * companies the user has never dealt with, and stay silent about the small supplier whose
   * invoices they actually pay. Which is where the money tends to go missing.
   */
  const [knownDomains, setKnownDomains] = useState<string[]>([])
  useEffect(() => {
    void window.peregrine.contacts.list().then((contacts) => {
      const domains = new Set<string>()
      for (const contact of contacts) {
        if (contact.frequency < 3) continue
        const at = contact.email.lastIndexOf('@')
        if (at !== -1) domains.add(contact.email.slice(at + 1).toLowerCase())
      }
      setKnownDomains([...domains])
    })
  }, [])
  const [showRemoteContent, setShowRemoteContent] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_HEIGHT)
  /** Needed to tell this frame's messages from any other window's. */
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showSource, setShowSource] = useState(false)

  /**
   * Prints the open message, or writes it to a PDF.
   *
   * The page is built and sanitised here and handed over as a `peregrine-mail://` URL. The
   * same protocol the reading pane is served through, with the same restrictions. The main
   * process only opens it in a window nobody sees.
   */
  async function handlePrint(toPdf: boolean): Promise<void> {
    if (!message) return
    try {
      const html = buildPrintDocument(message, {
        from: t('compose.from'),
        to: t('compose.to'),
        cc: t('compose.cc'),
        date: t('mailbox.columns.date')
      }, showRemoteContent)
      const { url } = await window.peregrine.mailContent.publish({
        html,
        // No script hash: the print page has nothing to run, and the height reporting the
        // reading pane needs would be meaningless on paper.
        policy: { surface: 'print', allowRemoteImages: showRemoteContent }
      })
      if (toPdf) {
        const { savedPath } = await window.peregrine.print.toPdf({
          url,
          suggestedName: suggestedPdfName(message)
        })
        if (savedPath) toastInfo(t('mailbox.pdfSaved', { path: savedPath }))
        return
      }
      await window.peregrine.print.message(url)
    } catch (err) {
      toastError(err, t('mailbox.printFailed'))
    }
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setShowRemoteContent(!blockRemoteImages)
    setReadingMode(false)
    setMenuOpen(false)
    setShowSource(false)
    setFrameHeight(MIN_FRAME_HEIGHT)
    bodyRef.current?.scrollTo({ top: 0 })
  }, [message?.id, blockRemoteImages])

  // A click anywhere else dismisses the "more" menu, as a menu is expected to.
  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(event: globalThis.MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      // Only from the frame this component owns. A magic string in the payload says who claims
      // to have sent it, the window identity says who did.
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { source?: string; height?: number } | null
      if (data?.source !== HEIGHT_MESSAGE_SOURCE || typeof data.height !== 'number') return
      // Clamped at the top as well. The height comes from `scrollHeight` of a document written
      // by the sender, and an unbounded one would have the frame reserve that much memory.
      setFrameHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, data.height)))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const { sanitizedHtml, hadRemoteContent } = useMemo(() => {
    if (!message?.htmlBody) return { sanitizedHtml: null, hadRemoteContent: false }
    // Remote URLs stay in the document: links have to survive so the user can follow them, and
    // remote images are held back further down by rewriting their src and by the CSP.
    const sanitized = sanitizeMailHtml(message.htmlBody, {
      allowRemote: true,
      wholeDocument: true
    })
    const hadRemote = /\ssrc=["']https?:/i.test(sanitized)
    const withBlocking = showRemoteContent ? allowRemoteContent(sanitized) : blockRemoteContent(sanitized)
    return { sanitizedHtml: withBlocking, hadRemoteContent: hadRemote }
  }, [message?.htmlBody, showRemoteContent])

  /**
   * Every link in the message that does not lead where it reads.
   *
   * Run over the sanitized HTML rather than the original: what is examined has to be exactly
   * what will be displayed, otherwise a link the sanitizer removed would still raise a
   * warning. Or worse, one it rewrote would not.
   */
  const linkAnalyses = useMemo(() => {
    if (!warnSuspiciousLinks) return []

    const found: LinkAnalysis[] = []
    if (sanitizedHtml) {
      const doc = new DOMParser().parseFromString(sanitizedHtml, 'text/html')
      for (const anchor of doc.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href') as string
        if (!/^https?:/i.test(href)) continue
        const analysis = analyzeLink(href, anchor.textContent ?? undefined, knownDomains)
        if (analysis.findings.length > 0) found.push(analysis)
      }
    } else if (message?.textBody) {
      for (const match of message.textBody.matchAll(/https?:\/\/\S+/gi)) {
        const analysis = analyzeLink(match[0], undefined, knownDomains)
        if (analysis.findings.length > 0) found.push(analysis)
      }
    }

    // One entry per destination: a newsletter repeating the same tracking link forty times
    // must not produce forty warnings.
    const seen = new Set<string>()
    return found.filter((analysis) => {
      if (seen.has(analysis.href)) return false
      seen.add(analysis.href)
      return true
    })
  }, [sanitizedHtml, message?.textBody, warnSuspiciousLinks, knownDomains])

  /**
   * Counts the images that exist only to report that the message was opened.
   *
   * Blocked ones count too. That is the point: this says who tried, which is exactly what
   * blocking them otherwise hides. Read off the declared size, since nothing is loaded.
   */
  const trackingPixels = useMemo(() => {
    if (!warnSuspiciousLinks || !sanitizedHtml) return 0
    const doc = new DOMParser().parseFromString(sanitizedHtml, 'text/html')
    let count = 0
    for (const img of doc.querySelectorAll('img')) {
      const source = img.getAttribute('src') ?? img.getAttribute('data-blocked-src') ?? ''
      if (!/^https?:/i.test(source)) continue
      const width = img.getAttribute('width')
      const height = img.getAttribute('height')
      const style = img.getAttribute('style') ?? ''
      const tinyAttributes = width != null && height != null && +width <= 2 && +height <= 2
      const tinyStyle = /(?:width|height)\s*:\s*[012](?:px)?\b/i.test(style)
      if (tinyAttributes || tinyStyle) count += 1
    }
    return count
  }, [sanitizedHtml, warnSuspiciousLinks])

  const failedAuth = useMemo(
    () => (warnSuspiciousLinks && message ? failedChecks(message.authResults) : []),
    [message?.id, warnSuspiciousLinks]
  )

  /**
   * Whether this address has ever written before.
   *
   * Nearly every fraudulent message is a first contact, so it is worth stating plainly. But
   * only as a fact, never as an accusation: most first contacts are perfectly ordinary.
   *
   * The threshold is 1, not 0: the contact counter is raised during envelope sync, so the
   * message currently open has already been counted.
   */
  const [firstContact, setFirstContact] = useState(false)
  useEffect(() => {
    const address = message?.from[0]?.address
    if (!warnSuspiciousLinks || !address) {
      setFirstContact(false)
      return
    }
    let cancelled = false
    void window.peregrine.contacts.list(address).then((contacts) => {
      if (cancelled) return
      const match = contacts.find((c) => c.email.toLowerCase() === address.toLowerCase())
      setFirstContact(match != null && match.frequency <= 1)
    })
    return () => {
      cancelled = true
    }
  }, [message?.id, warnSuspiciousLinks])

  const senderFindings = useMemo(() => {
    if (!warnSuspiciousLinks || !message) return []
    return analyzeSender(
      message.from[0]?.name ?? '',
      message.from[0]?.address ?? '',
      message.replyTo[0]?.address ?? null,
      knownDomains
    )
  }, [message?.id, warnSuspiciousLinks])

  useEffect(() => {
    if (sanitizedHtml == null) {
      setFrameSrc(null)
      return
    }
    let cancelled = false
    sha256Base64(RESIZE_SCRIPT).then((scriptHash) => {
      if (cancelled) return
      window.peregrine.mailContent
        .publish({
          html: injectIntoDocument(sanitizedHtml, readingMode),
          policy: { surface: 'reader', allowRemoteImages: showRemoteContent, scriptHash }
        })
        .then(({ url }) => {
          if (!cancelled) setFrameSrc(url)
        })
    })
    return () => {
      cancelled = true
    }
  }, [sanitizedHtml, showRemoteContent, readingMode])

  if (loading) return <p className="message-reader-status">{t('mailbox.loadingMessage')}</p>
  if (!message) {
    return (
      <p className="message-reader-status message-reader-placeholder">
        <MailOpen size={26} strokeWidth={1.5} />
        {t('mailbox.selectMessage')}
      </p>
    )
  }

  const sender = message.from[0]
  const recipients = message.to.map((a) => a.name || a.address).join(', ')

  return (
    <div className="message-reader">
      <header className="message-reader-header">
        <div className="reader-identity">
          <span className="reader-avatar">
            {initialFor(sender?.name ?? '', sender?.address ?? '')}
          </span>
          <div className="reader-identity-text">
            <span className="reader-from-name">{sender?.name || sender?.address || ''}</span>
            <span className="reader-from-address">{sender?.address}</span>
          </div>
        </div>

        <div className="reader-actions">
          <button onClick={actions.onReply} title={t('mailbox.reply')}>
            <Reply size={14} strokeWidth={1.75} />
            <span>{t('mailbox.reply')}</span>
          </button>
          <button onClick={actions.onReplyAll} title={t('mailbox.replyAll')}>
            <ReplyAll size={14} strokeWidth={1.75} />
            <span>{t('mailbox.replyAll')}</span>
          </button>
          <button onClick={actions.onForward} title={t('mailbox.forward')}>
            <Forward size={14} strokeWidth={1.75} />
            <span>{t('mailbox.forward')}</span>
          </button>
          <button onClick={actions.onArchive} title={t('mailbox.archive')}>
            <Archive size={14} strokeWidth={1.75} />
            <span>{t('mailbox.archive')}</span>
          </button>
          <button onClick={actions.onJunk} title={t('mailbox.junk')}>
            <ShieldAlert size={14} strokeWidth={1.75} />
            <span>{t('mailbox.junk')}</span>
          </button>
          <button onClick={actions.onDelete} title={t('mailbox.delete')}>
            <Trash2 size={14} strokeWidth={1.75} />
            <span>{t('mailbox.delete')}</span>
          </button>
          <button
            className={flagged ? 'icon-only flagged' : 'icon-only'}
            onClick={actions.onToggleFlag}
            title={t('mailbox.toggleFlag')}
            aria-label={t('mailbox.toggleFlag')}
            aria-pressed={flagged}
          >
            <Star size={14} strokeWidth={1.75} fill={flagged ? 'currentColor' : 'none'} />
          </button>
          <div className="reader-more" ref={menuRef}>
            <button className="icon-only" onClick={() => setMenuOpen((v) => !v)} title={t('mailbox.more')}>
              <MoreHorizontal size={14} strokeWidth={1.75} />
              <ChevronDown size={11} strokeWidth={2} />
            </button>
            {menuOpen && (
              <div className="reader-more-menu">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    actions.onMarkUnread()
                  }}
                >
                  <Mail size={13} strokeWidth={1.75} />
                  {t('mailbox.markUnread')}
                </button>
                {sanitizedHtml != null && (
                  <button
                    className={readingMode ? 'active' : undefined}
                    onClick={() => setReadingMode((v) => !v)}
                  >
                    <BookOpenText size={13} strokeWidth={1.75} />
                    {t('mailbox.readingMode')}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void handlePrint(false)
                  }}
                >
                  <Printer size={13} strokeWidth={1.75} />
                  {t('mailbox.print')}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void handlePrint(true)
                  }}
                >
                  <FileDown size={13} strokeWidth={1.75} />
                  {t('mailbox.saveAsPdf')}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setShowSource(true)
                  }}
                >
                  <FileCode2 size={13} strokeWidth={1.75} />
                  {t('source.title')}
                </button>
                <label className="reader-move-label">
                  {t('mailbox.moveTo')}
                  <select
                    value=""
                    onChange={(event) => {
                      setMenuOpen(false)
                      actions.onMoveTo(event.target.value)
                    }}
                  >
                    <option value="">…</option>
                    {moveTargets
                      .filter((folder) => folder.id !== message.folderId)
                      .map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folderLabel(folder, t)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="message-reader-meta">
        <span className="reader-recipients">
          <span className="reader-meta-label">{t('compose.to')}</span> {recipients}
        </span>
        <span className="reader-date">{formatFullDate(message.date, i18n.language)}</span>
      </div>

      <h2 className="message-reader-subject">{message.subject || t('mailbox.noSubject')}</h2>

      {message.pgpStatus !== 'none' && (
        <p className={`pgp-badge pgp-badge-${message.pgpStatus}`}>
          {message.pgpStatus === 'encrypted-verified' && <ShieldCheck size={14} strokeWidth={1.75} />}
          {message.pgpStatus === 'encrypted-unverified' && <ShieldQuestion size={14} strokeWidth={1.75} />}
          {message.pgpStatus === 'encrypted-failed' && <ShieldAlert size={14} strokeWidth={1.75} />}
          {message.pgpStatus === 'signed-verified' && <BadgeCheck size={14} strokeWidth={1.75} />}
          {message.pgpStatus === 'signed-unverified' && <ShieldQuestion size={14} strokeWidth={1.75} />}
          {message.pgpStatus === 'signed-invalid' && <ShieldAlert size={14} strokeWidth={1.75} />}
          {t(`mailbox.pgpStatus.${message.pgpStatus}`)}
        </p>
      )}

      <SenderKeyRow
        accountId={message.accountId}
        senderAddress={sender?.address ?? ''}
        senderName={sender?.name ?? ''}
        // Offered unprompted exactly where it is missed: a signature that cannot be checked
        // because the key is absent. Encrypted mail counts too. It was decrypted with our
        // own key, and its signature is unverified for the same reason.
        signed={
          message.pgpStatus === 'signed-unverified' ||
          message.pgpStatus === 'encrypted-unverified'
        }
        onKeyStored={actions.onSenderKeyStored}
      />

      {showSource && (
        <MessageSourceDialog message={message} onClose={() => setShowSource(false)} />
      )}

      <SuspiciousBanner
        senderFindings={senderFindings}
        linkAnalyses={linkAnalyses}
        failedAuth={failedAuth}
        trackingPixels={trackingPixels}
        firstContact={firstContact}
        spam={message.spam}
      />

      {hadRemoteContent && !showRemoteContent && (
        <div className="remote-content-banner">
          <ImageOff size={15} strokeWidth={1.75} />
          <span>{t('mailbox.remoteContentBlocked')}</span>
          <button onClick={() => setShowRemoteContent(true)}>{t('mailbox.showImages')}</button>
        </div>
      )}

      {message.attachments.length > 0 && (
        <AttachmentBar message={message} attachments={message.attachments} />
      )}

      <div className="message-reader-body" ref={bodyRef}>
        {frameSrc ? (
          <iframe
            ref={frameRef}
            className="message-reader-frame"
            style={{ height: frameHeight }}
            scrolling="no"
            sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
            src={frameSrc}
            title={message.subject || 'message'}
          />
        ) : sanitizedHtml == null ? (
          <pre className="message-reader-plaintext">{message.textBody}</pre>
        ) : null}
      </div>
    </div>
  )
}

export default MessageReader
