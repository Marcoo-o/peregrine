/**
 * Actions that were taken without a connection and still have to reach the server.
 *
 * Until now such an action was applied locally and quietly forgotten. Marking a message as
 * read offline changed it here and nowhere else, and nothing ever said so. That is worse
 * than an error message: the two sides drift apart and neither says which is right.
 *
 * `id` is an autoincrementing integer on purpose. The replay order has to be the order in
 * which the user acted. Marking as read and then moving is not the same as the reverse,
 * and a rowid gives that ordering for free, where a timestamp would need a tie-breaker for
 * two actions in the same millisecond.
 */
export const migration013PendingActions = `
CREATE TABLE IF NOT EXISTS pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_account ON pending_actions(account_id, id);
`
