/**
 * Tags live on the server as IMAP keywords; this table only remembers what they look like.
 *
 * The membership itself is not stored here. It is in each message's flag list, which the
 * sync already brings along. That way a tag set in another client shows up here without any
 * reconciliation, and one set here is immediately visible everywhere else.
 */
export const migration011Tags = `
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#2f5d9f',
  sort_order INTEGER NOT NULL DEFAULT 0
);
`
