// Historical shape of the index triggers, kept so a fresh database has working triggers from
// the start. Migration 008 replaces them (and the FTS table) with the version that also
// indexes the recipients. The definitions below are never the ones in force afterwards.
export const migration002FtsTriggers = `
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, body_text, from_name, from_address)
  VALUES (new.rowid, new.subject, new.body_text, new.from_name, new.from_address);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, body_text, from_name, from_address)
  VALUES('delete', old.rowid, old.subject, old.body_text, old.from_name, old.from_address);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, body_text, from_name, from_address)
  VALUES('delete', old.rowid, old.subject, old.body_text, old.from_name, old.from_address);
  INSERT INTO messages_fts(rowid, subject, body_text, from_name, from_address)
  VALUES (new.rowid, new.subject, new.body_text, new.from_name, new.from_address);
END;
`
