-- Allow users to delete their own key row (e.g. via future self-service UI).
-- Admin deletes are handled via service role which bypasses RLS.
CREATE POLICY "user_keys_delete" ON user_keys FOR DELETE USING (auth.uid() = user_id);
