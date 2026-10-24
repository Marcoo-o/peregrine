import type { PgpStatus } from '@peregrine/core/types'
import type { MessageAssessment, PageAssessment } from './assessment'
import {
  AUTH_BANNER,
  authFailedText,
  FIRST_CONTACT,
  linkFindingText,
  REMOTE_CONTENT_BLOCKED,
  senderFindingText,
  spamText,
  trackingPixelsText
} from './warningText'

/** One thing a message has to say for itself, to be shown above its text. */
export interface Hint {
  /** Stable for what it is about, so that a list of them can be kept as it changes. */
  id: string
  /** How sharply it is said: what is probably wrong, what is worth knowing, what only informs. */
  tone: 'danger' | 'warning' | 'info' | 'good'
  /** A picture that says it at a glance, for those hints that have one. */
  icon?: 'lock' | 'signature' | 'shieldOk' | 'shieldUnknown' | 'alert'
  title: string
  detail?: string
  /** What the user can do about it right there. */
  action?: 'showImages'
}

/** What a message has to say for itself of its signature and its encryption, or nothing for one that has neither. */
function pgpHint(status: PgpStatus): Hint | undefined {
  switch (status) {
    case 'none':
      return undefined
    case 'encrypted-verified':
      return {
        id: 'pgp',
        tone: 'good',
        icon: 'lock',
        title: 'Verschlüsselt und signiert, die Signatur stimmt',
        detail: 'Nur dieses Konto konnte die Nachricht öffnen, und sie stammt vom Besitzer des Schlüssels, den du für den Absender hinterlegt hast.'
      }
    case 'encrypted-unverified':
      return {
        id: 'pgp',
        tone: 'info',
        icon: 'lock',
        title: 'Verschlüsselt, der Absender ist nicht bestätigt',
        detail:
          'Die Nachricht war für dich verschlüsselt und ist geöffnet. Ob sie vom angegebenen Absender stammt, lässt sich nicht sagen: Sie ist nicht signiert, oder für den Absender ist kein Schlüssel hinterlegt.'
      }
    case 'encrypted-failed':
      return {
        id: 'pgp',
        tone: 'warning',
        icon: 'alert',
        title: 'Verschlüsselt, und das Handy kann sie nicht öffnen',
        detail: 'Für dieses Konto fehlt der Schlüssel, mit dem die Nachricht verschlüsselt wurde, oder sie ist beschädigt.'
      }
    case 'signed-verified':
      return {
        id: 'pgp',
        tone: 'good',
        icon: 'shieldOk',
        title: 'Signiert, die Signatur stimmt',
        detail: 'Der Inhalt ist unverändert und stammt vom Besitzer des Schlüssels, den du für den Absender hinterlegt hast.'
      }
    case 'signed-unverified':
      return {
        id: 'pgp',
        tone: 'info',
        icon: 'shieldUnknown',
        title: 'Signiert, die Signatur ist nicht geprüft',
        detail: 'Für den Absender ist kein Schlüssel hinterlegt, mit dem sich die Signatur prüfen ließe.'
      }
    case 'signed-invalid':
      return {
        id: 'pgp',
        tone: 'danger',
        icon: 'alert',
        title: 'Die Signatur dieser Nachricht stimmt nicht',
        detail: 'Der Inhalt wurde nach dem Signieren verändert, oder die Signatur stammt nicht von dem Schlüssel, den du für den Absender hinterlegt hast.'
      }
  }
}

/** How many of the findings of a spam filter are named: the rest are not worth a screen. */
const SYMBOLS_SHOWN = 5

/**
 * What a message has to say for itself, in the order the desktop says it: what the server made of it, what is
 * wrong with its sender, where its links lead, what counts its opening, and what was held back from it.
 * Nothing is said about a message that has nothing to say, and nothing before it can be looked at.
 */
export function hintsFor(input: {
  assessment: MessageAssessment | undefined
  page: PageAssessment
  /** How many images the message has that would be fetched from the sender's servers. */
  remoteImages: number
  showingImages: boolean
  /** What the message says of its signature and encryption, once it has been read for them. */
  pgp?: PgpStatus
}): Hint[] {
  const { assessment, page } = input
  if (!assessment) return []
  const hints: Hint[] = []

  const protection = input.pgp ? pgpHint(input.pgp) : undefined
  if (protection) hints.push(protection)

  if (assessment.spam) {
    const text = spamText(assessment.spam)
    const found = assessment.spam.symbols
      .slice(0, SYMBOLS_SHOWN)
      .map((symbol) => `${symbol.name} (${symbol.score})`)
      .join(', ')
    hints.push({
      id: 'spam',
      tone: assessment.spam.verdict === 'spam' ? 'danger' : 'warning',
      title: text.banner,
      detail: [text.source, found, text.detail].filter(Boolean).join('. ')
    })
  }

  if (assessment.failedAuth.length > 0) {
    hints.push({
      id: 'auth',
      tone: 'danger',
      title: AUTH_BANNER,
      detail: assessment.failedAuth
        .map((check) => authFailedText(check))
        .map(({ name, text }) => `${name}: ${text}`)
        .join('\n')
    })
  }

  for (const finding of assessment.sender) {
    const text = senderFindingText(finding)
    hints.push({ id: `sender-${finding.risk}`, tone: 'warning', title: text.title, detail: text.detail })
  }

  if (page.links.length > 0) {
    hints.push({
      id: 'links',
      tone: 'danger',
      title: 'Dieser Link führt woanders hin, als er aussieht',
      detail: page.links
        .map((link) => `${link.displayHost}: ${link.findings.map((finding) => linkFindingText(finding).title).join(', ')}`)
        .join('\n')
    })
  }

  if (page.trackingPixels > 0) {
    const text = trackingPixelsText(page.trackingPixels)
    hints.push({ id: 'pixels', tone: 'info', title: text.banner, detail: text.detail })
  }

  if (assessment.firstContact) {
    hints.push({ id: 'first-contact', tone: 'info', title: FIRST_CONTACT.banner, detail: FIRST_CONTACT.detail })
  }

  if (input.remoteImages > 0 && !input.showingImages) {
    hints.push({ id: 'images', tone: 'info', title: REMOTE_CONTENT_BLOCKED, action: 'showImages' })
  }

  return hints
}
