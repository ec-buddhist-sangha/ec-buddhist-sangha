-- Membership store: current role + pending upgrade request, keyed by email.
CREATE TABLE IF NOT EXISTS members (
  email          TEXT PRIMARY KEY,
  name           TEXT,
  role           TEXT NOT NULL DEFAULT 'reader',
  request_status TEXT NOT NULL DEFAULT 'none',
  created_at     TEXT,
  updated_at     TEXT
);
