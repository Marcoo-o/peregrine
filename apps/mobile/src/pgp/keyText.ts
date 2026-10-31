import { daysUntilExpiry, keyHealth, type KeyFacts } from '@peregrine/core/keyHealth'
import { t, tn } from '../i18n'

/**
 * What to tell of a key that is not in order, for a tag on its card, or null for a key that is. A key that was withdrawn or
 * has expired cannot be used for anything new; one that expires soon still can, and is said to be, early enough to do
 * something about it.
 */
export function healthTag(facts: KeyFacts, now: Date = new Date()): { text: string; tone: 'warning' | 'danger' } | null {
  const health = keyHealth(facts, now)
  if (health === 'ok') return null
  if (health === 'revoked') return { text: t('Widerrufen'), tone: 'danger' }
  if (health === 'expired') return { text: t('Abgelaufen'), tone: 'danger' }
  const days = daysUntilExpiry(facts.expiresAt, now) ?? 0
  const when = days <= 0 ? t('heute') : days === 1 ? t('morgen') : t('in {days} Tagen', { days })
  return { text: t('Läuft {when} ab', { when }), tone: 'warning' }
}

/** Whether an attachment is, by its name and its type, a file with keys in it, which can be taken from the message. */
export function looksLikeKeyFile(attachment: { filename: string; contentType: string }): boolean {
  if (attachment.contentType.toLowerCase() === 'application/pgp-signature') return false
  return attachment.contentType.toLowerCase() === 'application/pgp-keys' || /\.(asc|gpg|pgp|key)$/i.test(attachment.filename)
}

/**
 * A fingerprint as people compare it: in groups of four, in upper case, in two lines of five groups. It is 40 characters
 * long, and what is read out or checked against what the owner of the key says is all of it.
 */
export function fingerprintLines(fingerprint: string): string {
  const groups = fingerprint.toUpperCase().match(/.{1,4}/g) ?? []
  return [groups.slice(0, 5).join(' '), groups.slice(5).join(' ')].filter((line) => line !== '').join('\n')
}

/**
 * The name a public key is saved under: the address it is for, with nothing in it that a file name cannot hold. It has no
 * extension of its own: the system adds the one that goes with the kind of file, which is the one programs look for.
 */
export function keyFileName(address: string): string {
  const name = address.replace(/[^A-Za-z0-9@._+-]/g, '_')
  return name === '' ? 'schluessel' : name
}
