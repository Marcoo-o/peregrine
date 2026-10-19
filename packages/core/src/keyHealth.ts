/**
 * Whether a key can still be relied on, and how urgently that changes.
 *
 * Peregrine reads expiry and revocation when a key is imported and then never mentions them
 * again. Both matter after the fact rather than at import time: an expired key of one's own
 * keeps signing, and nobody accepts the signature; a revoked key of someone else's keeps
 * being used to encrypt, and its owner has publicly said not to.
 *
 * Kept as a plain function over plain values so the wording of the warning and the moment it
 * appears can be tested without touching OpenPGP or the database.
 */

export type KeyHealth =
  /** Usable, and not about to stop being usable. */
  | 'ok'
  /** Still valid, but the expiry is close enough to act on. */
  | 'expiringSoon'
  /** Past its expiry. Still needed for old mail, useless for new. */
  | 'expired'
  /**
   * Withdrawn by its owner.
   *
   * The gravest of the three and not a matter of time: the owner has declared the key unsafe,
   * so it must not be used for anything new even though it still decrypts the past.
   */
  | 'revoked'

/**
 * How much warning is useful.
 *
 * Four weeks is long enough to generate a key, publish it and tell people, and short enough
 * that the warning still reads as something to do rather than background noise. A warning
 * that stands for months is one people learn to look past.
 */
export const EXPIRY_WARNING_DAYS = 28

export interface KeyFacts {
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt: string | null
  revoked?: boolean
}

export function keyHealth(facts: KeyFacts, now: Date = new Date()): KeyHealth {
  if (facts.revoked) return 'revoked'
  if (!facts.expiresAt) return 'ok'

  const expiry = new Date(facts.expiresAt)
  if (Number.isNaN(expiry.getTime())) return 'ok'
  if (expiry <= now) return 'expired'

  const days = (expiry.getTime() - now.getTime()) / 86_400_000
  return days <= EXPIRY_WARNING_DAYS ? 'expiringSoon' : 'ok'
}

/** Whether this state is worth putting in front of the user rather than only recording. */
export function needsAttention(health: KeyHealth): boolean {
  return health !== 'ok'
}

/** Days until expiry, rounded up. "in 1 day" rather than "in 0 days" on the last one. */
export function daysUntilExpiry(expiresAt: string | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null
  const expiry = new Date(expiresAt)
  if (Number.isNaN(expiry.getTime())) return null
  return Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
}
