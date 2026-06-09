-- Single authoritative calendar store document with optimistic locking.
CREATE TABLE IF NOT EXISTS calendar_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  store_json TEXT    NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL
);
