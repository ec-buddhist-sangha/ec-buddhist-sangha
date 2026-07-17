-- Native D1 content: replaces the Decap CMS Markdown collections.
--   posts  = admin-authored community feed (announcements + events)
--   topics = member-authored forum threads (comments stay in the comments
--            table, keyed by thread = 'topic:' || slug)
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,               -- 'announcement' | 'event'
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT,
  body         TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  location     TEXT,                        -- events only
  start_at     TEXT,                        -- events only
  end_at       TEXT,                        -- events only
  published_at TEXT NOT NULL,               -- display/sort date
  status       TEXT NOT NULL DEFAULT 'published',  -- published | hidden | deleted
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(kind, status, published_at);

CREATE TABLE IF NOT EXISTS topics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  author_email   TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'published',  -- published | hidden | deleted
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  last_active_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_active ON topics(status, last_active_at);
