import type { AuthResults } from '@peregrine/core/authResults'
import type { LinkFinding, LinkRisk, SenderFinding, SenderRisk } from '@peregrine/core/linkSafety'
import type { SpamAssessment } from '@peregrine/core/spamScore'
import { t, msg } from '../i18n'

/**
 * What is said about what was found, in the words of the desktop (`links.*` and `spam.*` of its German
 * texts), so that the same finding reads the same on both. A record that has to name every risk makes the
 * compiler say so when the core learns a new one.
 */

const LINK_RISK_TITLES: Record<LinkRisk, string> = {
  punycode: msg('Verschleierte Adresse'),
  mixedScript: msg('Gemischte Alphabete'),
  invisibleCharacters: msg('Unsichtbare Zeichen'),
  textMismatch: msg('Text und Ziel stimmen nicht überein'),
  userInfo: msg('Echtes Ziel hinter dem @'),
  ipAddressHost: msg('Nackte IP-Adresse'),
  lookalikeDomain: msg('Ähnelt einem deiner Kontakte')
}

const LINK_RISK_DETAILS: Record<LinkRisk, (detail: string) => string> = {
  punycode: (detail) => t('Die Adresse ist kodiert geschrieben und steht in Wahrheit für „{detail}".', { detail }),
  mixedScript: (detail) =>
    t('Ein Teil der Adresse mischt {detail}. So lassen sich Buchstaben nachbauen, die identisch aussehen.', { detail }),
  invisibleCharacters: (detail) =>
    t('Die Adresse enthält Zeichen ohne Darstellung ({detail}). Gelesen wird also etwas anderes als aufgerufen.', { detail }),
  textMismatch: (detail) => t('Der sichtbare Text nennt {detail}.', { detail }),
  userInfo: (detail) => t('Alles vor dem @ ist Zugangsdaten und wird ignoriert. Aufgerufen wird „{detail}".', { detail }),
  ipAddressHost: (detail) =>
    t('Die Adresse ist {detail} und damit kein Name, an dem sich der Betreiber erkennen ließe.', { detail }),
  lookalikeDomain: (detail) =>
    t('Sehr ähnlich zu „{detail}", mit der du regelmäßig zu tun hast, aber nicht dieselbe Domain.', { detail })
}

const SENDER_RISK_TITLES: Record<SenderRisk, string> = {
  nameContainsOtherAddress: msg('Angezeigter Name nennt eine andere Adresse'),
  replyToMismatch: msg('Antworten gehen an eine andere Domain'),
  invisibleCharacters: msg('Unsichtbare Zeichen im Absender'),
  mixedScript: msg('Absenderdomain mischt Alphabete'),
  punycode: msg('Absenderdomain ist kodiert geschrieben'),
  lookalikeDomain: msg('Ähnelt einem deiner Kontakte')
}

const AUTH_FAILED: Record<keyof AuthResults, { name: string; text: string }> = {
  dmarc: {
    name: 'DMARC',
    text: msg('Die Absenderdomain hat festgelegt, wer in ihrem Namen senden darf. Dieser Server gehört nicht dazu.')
  },
  spf: { name: 'SPF', text: msg('Der versendende Server ist für diese Absenderdomain nicht eingetragen.') },
  dkim: { name: 'DKIM', text: msg('Die Signatur der Absenderdomain fehlt oder passt nicht zum Inhalt.') }
}

/** One finding about a link, as a title and an explanation. */
export function linkFindingText(finding: LinkFinding): { title: string; detail: string } {
  return { title: t(LINK_RISK_TITLES[finding.risk]), detail: LINK_RISK_DETAILS[finding.risk](finding.detail) }
}

/** One finding about the sender. What it found is the explanation, as the desktop shows it. */
export function senderFindingText(finding: SenderFinding): { title: string; detail: string } {
  return { title: t(SENDER_RISK_TITLES[finding.risk]), detail: finding.detail }
}

/** A check of the sender that failed, by its name, with what that means. */
export function authFailedText(check: keyof AuthResults): { name: string; text: string } {
  return { name: AUTH_FAILED[check].name, text: t(AUTH_FAILED[check].text) }
}

export const AUTH_BANNER = msg('Der Server konnte den Absender dieser Nachricht nicht bestätigen')

const SPAM_SOURCES: Record<SpamAssessment['source'], string> = {
  rspamd: msg('Rspamd'),
  spamassassin: msg('SpamAssassin'),
  flag: msg('Vom Server markiert')
}

/** The verdict of the server's spam filter: what it says, who said it, and what it means. */
export function spamText(assessment: SpamAssessment): { banner: string; source: string; detail: string } {
  const spam = assessment.verdict === 'spam'
  return {
    banner: spam
      ? t('Ihr Mailserver hat diese Nachricht als Spam eingestuft')
      : t('Ihr Mailserver fand diese Nachricht grenzwertig'),
    source: t(SPAM_SOURCES[assessment.source]),
    detail: spam
      ? t('Der Wert hat die Grenze erreicht, ab der Ihr Server von Spam ausgeht.')
      : t('Über der Hälfte der Grenze. Zugestellt wurde die Nachricht, sie liegt aber höher als gewöhnliche Post.')
  }
}

/**
 * The words for a first message from an address. The desktop's say that nothing ever arrived from it before; the
 * phone only knows what it has fetched, so what it says is that.
 */
export const FIRST_CONTACT = {
  banner: msg('Erste Nachricht von dieser Adresse'),
  detail:
    msg('Unter den Nachrichten auf diesem Gerät ist nichts anderes von dieser Adresse. Das ist für sich genommen unverdächtig, die meisten Erstkontakte sind harmlos. Es lohnt sich nur, bei Zahlungsaufforderungen oder Anmeldedaten genauer hinzusehen.')
}

export const REMOTE_CONTENT_BLOCKED = msg('Externe Bilder wurden zum Schutz Ihrer Privatsphäre blockiert.')

/** The words for the images that only report that the message was opened, as a title and an explanation. */
export function trackingPixelsText(count: number): { banner: string; detail: string } {
  return count === 1
    ? {
        banner: t('Diese Nachricht enthält ein Zählpixel'),
        detail:
          t('Ein unsichtbares Bild meldet dem Absender das Öffnen. Es wird nur geladen, wenn du externe Bilder freigibst.')
      }
    : {
        banner: t('Diese Nachricht enthält {count} Zählpixel', { count }),
        detail: t('{count} unsichtbare Bilder melden dem Absender das Öffnen. Sie werden nur geladen, wenn du externe Bilder freigibst.', { count })
      }
}
