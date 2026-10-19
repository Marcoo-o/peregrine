export const migration001Init = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL,
  imap_secure TEXT NOT NULL,
  imap_username TEXT NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_secure TEXT NOT NULL,
  smtp_username TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'password',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  imap_secret_encrypted BLOB,
  smtp_secret_encrypted BLOB,
  oauth_provider TEXT,
  oauth_refresh_token_encrypted BLOB,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  imap_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  special_use TEXT,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  uid_validity INTEGER,
  uid_next INTEGER,
  highest_modseq INTEGER,
  last_synced_at TEXT,
  UNIQUE(account_id, imap_path)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id_header TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  subject TEXT,
  from_address TEXT,
  from_name TEXT,
  to_addresses TEXT,
  cc_addresses TEXT,
  bcc_addresses TEXT,
  date TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  is_read INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER,
  preview_text TEXT,
  body_text TEXT,
  body_html TEXT,
  headers_json TEXT,
  synced_fully INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(folder_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder_id, date DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  is_inline INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  local_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, body_text, from_name, from_address,
  content='messages', content_rowid='rowid'
);
`
