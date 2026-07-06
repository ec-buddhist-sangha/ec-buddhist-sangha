-- Native comments: single-level threading, keyed to the page (thread) path.
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread       TEXT NOT NULL,
  parent_id    INTEGER REFERENCES comments(id),
  author_email TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'published',
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
