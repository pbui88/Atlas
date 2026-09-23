-- Temporary hard cap on PositionStack API calls: 500,000 requests over the
-- next 3 days, as a safety valve while confirming the removed zip-backfill
-- job (the actual cause of the earlier quota overage) stays fixed.
-- Once increment_positionstack_calls() reports the cap exceeded,
-- geocode-points.js stops making PositionStack requests entirely until the
-- window resets (or the row is manually adjusted/removed).

create table if not exists api_usage_caps (
  service      text primary key,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  cap          integer     not null,
  call_count   integer     not null default 0,
  updated_at   timestamptz not null default now()
);

insert into api_usage_caps (service, window_start, window_end, cap, call_count)
values ('positionstack', now(), now() + interval '3 days', 500000, 0)
on conflict (service) do update
  set window_start = excluded.window_start,
      window_end   = excluded.window_end,
      cap          = excluded.cap,
      call_count   = 0,
      updated_at   = now();

-- Atomically increments the call counter and reports whether the request
-- that's about to happen is still within cap. Returns true (allowed) if
-- there's no active window row at all, so this fails open rather than
-- silently breaking geocoding if the row is ever removed.
create or replace function increment_positionstack_calls(p_n integer default 1)
returns boolean
language plpgsql
security definer
as $$
declare
  v_call_count integer;
  v_cap        integer;
  v_window_end timestamptz;
begin
  update api_usage_caps
  set call_count = call_count + p_n,
      updated_at = now()
  where service = 'positionstack'
  returning call_count, cap, window_end into v_call_count, v_cap, v_window_end;

  if v_call_count is null then
    return true; -- no row configured — uncapped
  end if;

  if now() > v_window_end then
    return true; -- window expired — treat as uncapped until reconfigured
  end if;

  return v_call_count <= v_cap;
end;
$$;

grant execute on function increment_positionstack_calls(integer) to service_role;
