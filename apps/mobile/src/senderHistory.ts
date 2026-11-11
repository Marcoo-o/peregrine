import type { SqlDb } from '@peregrine/core/sqlDb'

/**
 * How many of the messages this phone has, in any folder of any account, are from an address. The desktop keeps a
 * count of contacts for this; the phone has no such table and does not need one, because the sender of every message
 * it has is stored with it. The count is of what was fetched, which is not everything that ever arrived.
 */
export async function messagesFrom(db: SqlDb, address: string, atMost?: number): Promise<number> {
  const wanted = address.trim().toLowerCase()
  if (wanted === '') return 0
  // A sender is stored as `Name <address>`, or as the address alone. `instr` is no pattern, so nothing in an address
  // can mean anything but itself.
  const match = `lower(sender) = ? OR instr(lower(sender), '<' || ? || '>') > 0`
  // With a limit the search stops at that many, so a sender the phone has mail from is found in a moment and not after every message has been read.
  const rows =
    atMost === undefined
      ? await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE ${match}`, wanted, wanted)
      : await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE ${match} LIMIT ?)`, wanted, wanted, atMost)
  return rows[0]?.n ?? 0
}

/** How many messages are counted to tell a first contact from another: the message itself and one more. */
export const FIRST_CONTACT_COUNT = 2

/** Whether the message that is open is the only one from its sender, which counts the message itself. */
export const isFirstContact = (messagesFromSender: number): boolean => messagesFromSender <= 1
