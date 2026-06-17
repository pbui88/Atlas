-- Add list_name to skip_trace_records so records saved from the Results tab
-- can be grouped by user-defined name on the Skip Trace page.
ALTER TABLE skip_trace_records
  ADD COLUMN IF NOT EXISTS list_name TEXT;

CREATE INDEX IF NOT EXISTS skip_trace_records_list_name_idx ON skip_trace_records(list_name);
