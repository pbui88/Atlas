-- ── Skip Trace ───────────────────────────────────────────────
-- Records saved from the Results tab (or uploaded via CSV) for skip tracing.
-- Orders group a batch submission to the Tracerfy API.

CREATE TABLE IF NOT EXISTS skip_trace_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tracerfy_order_id   TEXT,
  record_count        INTEGER     NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(10,2) NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'processing',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS skip_trace_orders_user_id_idx ON skip_trace_orders(user_id);

CREATE TABLE IF NOT EXISTS skip_trace_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_point_id UUID,
  project_id      UUID,
  address         TEXT        NOT NULL DEFAULT '',
  city            TEXT,
  state_code      TEXT,
  zip             TEXT,
  first_name      TEXT,
  last_name       TEXT,
  status          TEXT        NOT NULL DEFAULT 'saved',
  order_id        UUID        REFERENCES skip_trace_orders(id) ON DELETE SET NULL,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS skip_trace_records_user_id_idx ON skip_trace_records(user_id);
CREATE INDEX IF NOT EXISTS skip_trace_records_status_idx  ON skip_trace_records(status);
CREATE INDEX IF NOT EXISTS skip_trace_records_order_id_idx ON skip_trace_records(order_id);

-- RLS: users can only see their own records
ALTER TABLE skip_trace_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE skip_trace_orders  ENABLE ROW LEVEL SECURITY;

CREATE POLICY skip_trace_records_self ON skip_trace_records
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY skip_trace_orders_self ON skip_trace_orders
  FOR ALL USING (auth.uid() = user_id);
