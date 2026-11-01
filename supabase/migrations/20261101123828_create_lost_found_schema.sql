/*
# Create Lost & Found tables (schema)

Creates users, items, and item_photos tables with indexes, foreign keys,
RLS, and service_role grants. The Express backend manages its own JWT auth
and accesses the database via the service role key (bypassing RLS).
*/

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  whatsapp      VARCHAR(20)  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email);

CREATE TABLE IF NOT EXISTS items (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('lost','found')),
  title       VARCHAR(120) NOT NULL,
  description TEXT NULL,
  category    VARCHAR(60)  NOT NULL,
  location    VARCHAR(60)  NULL,
  event_date  DATE NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_feed     ON items (status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_items_type     ON items (type, status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_user     ON items (user_id);

CREATE TABLE IF NOT EXISTS item_photos (
  id             SERIAL PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename       VARCHAR(255) NOT NULL,
  thumb_filename VARCHAR(255) NOT NULL,
  size_bytes     INTEGER NOT NULL,
  position       SMALLINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photos_item ON item_photos (item_id, position);

-- Enable RLS on all tables (locked down; service_role bypasses RLS anyway)
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_photos  ENABLE ROW LEVEL SECURITY;

-- The Express backend uses the service role key, which bypasses RLS.
-- Grant CRUD to service_role only — the frontend never touches Supabase directly.
GRANT SELECT, INSERT, UPDATE, DELETE ON users        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON items        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON item_photos TO service_role;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq        TO service_role;
GRANT USAGE, SELECT ON SEQUENCE items_id_seq        TO service_role;
GRANT USAGE, SELECT ON SEQUENCE item_photos_id_seq TO service_role;
