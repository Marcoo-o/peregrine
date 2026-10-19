import type { Database } from 'better-sqlite3'
import { ACCOUNT_COLORS, nextAccountColor } from '@peregrine/core/accountColors'

/**
 * Gives existing accounts a colour of their own.
 *
 * None was ever set on creation. The column is `NOT NULL DEFAULT '#2f5d9f'`, so every account
 * carried the same value. In a sidebar with twelve mailboxes that meant twelve identical dots,
 * on the very feature meant to tell them apart. The same goes for the colour stripe in the
 * unified message list.
 *
 * **Why it only runs when every account still carries the default.** The stored value does not
 * say whether someone chose blue or never chose anything, both read as `#2f5d9f`. But if
 * *every* account carries the default, nobody has chosen, and recolouring takes no decision
 * back.
 *
 * That condition limits itself. After the one run the accounts carry different colours, the
 * condition is never met again, and anyone who later sets an account to blue by hand finds it
 * unchanged on the next start. Recolouring on every start would work against the user's own
 * choice.
 *
 * A single account gets the default colour back, since the first of the series is the same one.
 * There is nothing to tell apart there either.
 */
export function applyAccountColorsMigration(db: Database): void {
  const rows = db
    .prepare('SELECT id, color FROM accounts ORDER BY sort_order, created_at')
    .all() as { id: string; color: string | null }[]
  if (rows.length < 2) return

  const fallback = ACCOUNT_COLORS[0]
  if (!rows.every((row) => !row.color || row.color === fallback)) return

  // In display order, so neighbouring rows get different colours. That is where sameness shows,
  // not at the other end of the list.
  const update = db.prepare('UPDATE accounts SET color = ? WHERE id = ?')
  db.transaction(() => {
    rows.forEach((row, index) => update.run(nextAccountColor(index), row.id))
  })()
}
