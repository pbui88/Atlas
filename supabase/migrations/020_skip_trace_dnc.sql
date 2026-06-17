-- Add DNC scrub columns to skip_trace_orders.
-- scrub_dnc: whether the user requested DNC scrubbing for this batch.
-- dnc_queue_id: Tracerfy DNC queue ID once scrub-from-queue has been called;
--               null means not started yet (or already completed and cleared).
ALTER TABLE skip_trace_orders
  ADD COLUMN IF NOT EXISTS scrub_dnc    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dnc_queue_id TEXT;
