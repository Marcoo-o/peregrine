import type { SqlDb } from '@peregrine/core/sqlDb'

/** The checks that stand between a message and what it asks the phone to do, which the desktop lets each be switched off. */
export interface SafetySettings {
  /** A link that looks like another one than it says, or leads where its text does not, is asked about before it is opened. */
  warnSuspiciousLinks: boolean
  /** Every link is asked about, not only those that look wrong. */
  confirmAllLinks: boolean
  /** An attachment that would start a program, or is not what its name says, is not handed to another application. */
  warnRiskyAttachments: boolean
}

/** The same as on the desktop: warned of what looks wrong and of what runs, and not asked about the rest. */
export const DEFAULT_SAFETY: SafetySettings = { warnSuspiciousLinks: true, confirmAllLinks: false, warnRiskyAttachments: true }

const NAME = 'safety'

/** The settings as stored, with each one that is missing or is not a switch taking its default. */
export async function loadSafety(db: SqlDb): Promise<SafetySettings> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return DEFAULT_SAFETY
  try {
    const given = (JSON.parse(row.value) as Record<string, unknown> | null) ?? {}
    const pick = (key: keyof SafetySettings): boolean => (typeof given[key] === 'boolean' ? (given[key] as boolean) : DEFAULT_SAFETY[key])
    return { warnSuspiciousLinks: pick('warnSuspiciousLinks'), confirmAllLinks: pick('confirmAllLinks'), warnRiskyAttachments: pick('warnRiskyAttachments') }
  } catch {
    return DEFAULT_SAFETY
  }
}

/** Changes some of the settings and returns all of them as they are stored now. */
export async function saveSafety(db: SqlDb, change: Partial<SafetySettings>): Promise<SafetySettings> {
  const next = { ...(await loadSafety(db)), ...change }
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify(next)
  )
  return next
}
