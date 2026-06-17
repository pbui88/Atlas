-- Enable realtime updates for skip_trace_records so the UI can
-- receive live record status changes without polling.
ALTER TABLE skip_trace_records REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE skip_trace_records;
