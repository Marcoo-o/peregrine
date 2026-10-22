import type { SqlDb } from '@peregrine/core/sqlDb'

/**
 * How many of the messages this phone has, in any folder of any account, are from an address. The desktop keeps a
 * count of contacts for this; the phone has no such table and does not need one, because the sender of every message
 * it has is stored with it. The count is of what was fetched, which is not everything that ever arrived.
 */
export async function messagesFrom(db: SqlDb, address: string): Promise<number> {
  const wanted = address.trim().toLowerCase()
  if (wanted === '') return 0
  // A sender is stored as `Name <address>`, or as the address alone. `instr` is no pattern, so nothing in an address
  // can mean anything but itself.
  const rows = await db.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE lower(sender) = ? OR instr(lower(sender), '<' || ? || '>') > 0`,
    wanted,
    wanted
  )
  return rows[0]?.n ?? 0
}

/** Whether the message that is open is the only one from its sender, which counts the message itself. */
export const isFirstContact = (messagesFromSender: number): boolean => messagesFromSender <= 1
