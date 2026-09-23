-- Ongoing cap on PositionStack API calls: 3,000,000 requests per rolling
-- 30-day cycle, starting today, matching the account's actual monthly plan
-- limit. Unlike migration 033's one-off 3-day window (which just went
-- uncapped after expiry), this version auto-rolls into a fresh 30-day cycle
-- whenever the current one expires, so the cap keeps applying indefinitely.

insert into api_usage_caps (service, window_start, window_end, cap, call_count)
values ('positionstack', now(), now() + interval '30 days', 3000000, 0)
on conflict (service) do update
  set window_start = excluded.window_start,
      window_end   = excluded.window_end,
      cap          = excluded.cap,
      call_count   = 0,
      updated_at   = now();

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
  -- Roll into a fresh cycle (same length as before) if the current one has
  -- expired, instead of leaving calls uncapped forever after expiry.
  update api_usage_caps
  set window_start = window_end,
      window_end   = window_end + (window_end - window_start),
      call_count   = 0,
      updated_at   = now()
  where service = 'positionstack'
    and now() > window_end;

  update api_usage_caps
  set call_count = call_count + p_n,
      updated_at = now()
  where service = 'positionstack'
  returning call_count, cap, window_end into v_call_count, v_cap, v_window_end;

  if v_call_count is null then
    return true; -- no row configured — uncapped
  end if;

  return v_call_count <= v_cap;
end;
$$;

grant execute on function increment_positionstack_calls(integer) to service_role;
