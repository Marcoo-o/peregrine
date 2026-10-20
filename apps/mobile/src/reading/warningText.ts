import type { AuthResults } from '@peregrine/core/authResults'
import type { LinkFinding, LinkRisk, SenderFinding, SenderRisk } from '@peregrine/core/linkSafety'
import type { SpamAssessment } from '@peregrine/core/spamScore'

/**
 * What is said about what was found, in the words of the desktop (`links.*` and `spam.*` of its German
 * texts), so that the same finding reads the same on both. A record that has to name every risk makes the
 * compiler say so when the core learns a new one.
 */

const LINK_RISK_TITLES: Record<LinkRisk, string> = {
  punycode: 'Verschleierte Adresse',
  mixedScript: 'Gemischte Alphabete',
  invisibleCharacters: 'Unsichtbare Zeichen',
  textMismatch: 'Text und Ziel stimmen nicht überein',
  userInfo: 'Echtes Ziel hinter dem @',
  ipAddressHost: 'Nackte IP-Adresse',
  lookalikeDomain: 'Ähnelt einem deiner Kontakte'
}

const LINK_RISK_DETAILS: Record<LinkRisk, (detail: string) => string> = {
  punycode: (detail) => `Die Adresse ist kodiert geschrieben und steht in Wahrheit für „${detail}".`,
  mixedScript: (detail) =>
    `Ein Teil der Adresse mischt ${detail}. So lassen sich Buchstaben nachbauen, die identisch aussehen.`,
  invisibleCharacters: (detail) =>
    `Die Adresse enthält Zeichen ohne Darstellung (${detail}). Gelesen wird also etwas anderes als aufgerufen.`,
  textMismatch: (detail) => `Der sichtbare Text nennt ${detail}.`,
  userInfo: (detail) => `Alles vor dem @ ist Zugangsdaten und wird ignoriert. Aufgerufen wird „${detail}".`,
  ipAddressHost: (detail) =>
    `Die Adresse ist ${detail} und damit kein Name, an dem sich der Betreiber erkennen ließe.`,
  lookalikeDomain: (detail) =>
    `Sehr ähnlich zu „${detail}", mit der du regelmäßig zu tun hast, aber nicht dieselbe Domain.`
}

const SENDER_RISK_TITLES: Record<SenderRisk, string> = {
  nameContainsOtherAddress: 'Angezeigter Name nennt eine andere Adresse',
  replyToMismatch: 'Antworten gehen an eine andere Domain',
  invisibleCharacters: 'Unsichtbare Zeichen im Absender',
  mixedScript: 'Absenderdomain mischt Alphabete',
  punycode: 'Absenderdomain ist kodiert geschrieben',
  lookalikeDomain: 'Ähnelt einem deiner Kontakte'
}

const AUTH_FAILED: Record<keyof AuthResults, { name: string; text: string }> = {
  dmarc: {
    name: 'DMARC',
    text: 'Die Absenderdomain hat festgelegt, wer in ihrem Namen senden darf. Dieser Server gehört nicht dazu.'
  },
  spf: { name: 'SPF', text: 'Der versendende Server ist für diese Absenderdomain nicht eingetragen.' },
  dkim: { name: 'DKIM', text: 'Die Signatur der Absenderdomain fehlt oder passt nicht zum Inhalt.' }
}

/** One finding about a link, as a title and an explanation. */
export function linkFindingText(finding: LinkFinding): { title: string; detail: string } {
  return { title: LINK_RISK_TITLES[finding.risk], detail: LINK_RISK_DETAILS[finding.risk](finding.detail) }
}

/** One finding about the sender. What it found is the explanation, as the desktop shows it. */
export function senderFindingText(finding: SenderFinding): { title: string; detail: string } {
  return { title: SENDER_RISK_TITLES[finding.risk], detail: finding.detail }
}

/** A check of the sender that failed, by its name, with what that means. */
export function authFailedText(check: keyof AuthResults): { name: string; text: string } {
  return AUTH_FAILED[check]
}

export const AUTH_BANNER = 'Der Server konnte den Absender dieser Nachricht nicht bestätigen'

const SPAM_SOURCES: Record<SpamAssessment['source'], string> = {
  rspamd: 'Rspamd',
  spamassassin: 'SpamAssassin',
  flag: 'Vom Server markiert'
}

/** The verdict of the server's spam filter: what it says, who said it, and what it means. */
export function spamText(assessment: SpamAssessment): { banner: string; source: string; detail: string } {
  const spam = assessment.verdict === 'spam'
  return {
    banner: spam
      ? 'Ihr Mailserver hat diese Nachricht als Spam eingestuft'
      : 'Ihr Mailserver fand diese Nachricht grenzwertig',
    source: SPAM_SOURCES[assessment.source],
    detail: spam
      ? 'Der Wert hat die Grenze erreicht, ab der Ihr Server von Spam ausgeht.'
      : 'Über der Hälfte der Grenze. Zugestellt wurde die Nachricht, sie liegt aber höher als gewöhnliche Post.'
  }
}

export const REMOTE_CONTENT_BLOCKED = 'Externe Bilder wurden zum Schutz Ihrer Privatsphäre blockiert.'

/** The words for the images that only report that the message was opened, as a title and an explanation. */
export function trackingPixelsText(count: number): { banner: string; detail: string } {
  return count === 1
    ? {
        banner: 'Diese Nachricht enthält ein Zählpixel',
        detail:
          'Ein unsichtbares Bild meldet dem Absender das Öffnen. Es wird nur geladen, wenn du externe Bilder freigibst.'
      }
    : {
        banner: `Diese Nachricht enthält ${count} Zählpixel`,
        detail: `${count} unsichtbare Bilder melden dem Absender das Öffnen. Sie werden nur geladen, wenn du externe Bilder freigibst.`
      }
}
