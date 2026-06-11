-- ── Fix usage_logs FK to cascade on user deletion ──────────────
-- usage_logs.user_id referenced auth.users(id) without ON DELETE
-- CASCADE, so admin.auth.admin.deleteUser() failed with "Database
-- error deleting user" for any user that has usage history.
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_user_id_fkey;
ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
