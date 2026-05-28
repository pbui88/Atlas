-- ── Per-user API keys (write-only from client, read-only via service role) ───
-- Users can save their own Google Maps key so their scans are billed
-- directly to their own Google Cloud account (BYOK).
-- The SELECT policy is intentionally omitted — only the service role reads keys.

CREATE TABLE IF NOT EXISTS user_keys (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_maps_key TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;

-- Users can insert or update their own row, but cannot read it back
CREATE POLICY "user_keys_insert" ON user_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_keys_update" ON user_keys FOR UPDATE USING (auth.uid() = user_id);
