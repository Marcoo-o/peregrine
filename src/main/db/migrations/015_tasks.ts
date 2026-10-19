/**
 * The daily list.
 *
 * Three tables, and the split between them is the whole design:
 *
 * `tasks` holds the *rule*. What has to happen, and how often. Nothing in here says which
 * days it landed on; those are computed from the rule and the clock, the same way a snooze
 * expires without a job. A row per future day would grow a table nobody reads and would have
 * to be cleaned up afterwards.
 *
 * `task_completions` holds one row per day a recurring task was actually finished. A `done`
 * flag on the task itself cannot work: for something that repeats, "done" is either forever
 * or nowhere.
 *
 * `task_items` is the checklist. Its `done_on` is a day, not a boolean, for the same reason:
 * an item ticked yesterday is open again today, and that follows from the date without any
 * nightly reset.
 *
 * The link to a message is deliberately loose. `message_id_header` is the part that stays
 * true; account, folder and uid ride along as the fast path, and a uid stops being valid the
 * first time the message is moved. A task whose message can no longer be found keeps
 * standing as plain text rather than disappearing with it.
 */
export const migration015Tasks = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL DEFAULT 'once',
  start_day TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  account_id TEXT,
  folder_id TEXT,
  uid INTEGER,
  message_id_header TEXT
);

CREATE TABLE IF NOT EXISTS task_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done_on TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_completions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  PRIMARY KEY (task_id, occurred_on)
);

CREATE INDEX IF NOT EXISTS idx_task_items_task ON task_items(task_id, sort_order);
`
