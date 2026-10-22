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
  tone: 'danger' | 'warning' | 'info'
  title: string
  detail?: string
  /** What the user can do about it right there. */
  action?: 'showImages'
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
}): Hint[] {
  const { assessment, page } = input
  if (!assessment) return []
  const hints: Hint[] = []

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
