-- Shared schema: the local server runs this on start; Cloudflare D1 applies it as a migration.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  currency TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshots (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  fx REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, date)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  name TEXT NOT NULL,
  principal REAL NOT NULL,
  rate REAL NOT NULL,
  start TEXT NOT NULL,
  grace_months INTEGER NOT NULL DEFAULT 0,
  total_months INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
