-- Manifest: smarter location check. Run once in Supabase after schema12.sql: SQL Editor -> paste -> Run. Safe to run again.
-- The price country is only trusted when TWO signals agree: the country the server sees (network address)
-- and the country of the device's timezone. A VPN changes the first but almost never the second.
--   * They agree (or the device timezone is unknown): the country is trusted, recorded, and can set the price country.
--   * They disagree: nothing is recorded or changed for that visit. A brand-new account stays without a country
--     (shows plain USD) until the two agree.
--   * Free accounts whose country was set in the last 3 days are corrected straight away if a trusted visit shows
--     they are somewhere else (so one visit through a VPN does not stick).
--   * Everything else works as in schema10: the home country over the last 30 days, 7 or 21 days to move,
--     and paying customers are never moved automatically (a different home country is only recorded for review).
drop function if exists public.lock_region(text);
create or replace function public.lock_region(guess text default null, tz text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb; c text; t text; b public.billing%rowtype; home text; have boolean; n int; total int; up_ boolean; ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  begin h := coalesce(current_setting('request.headers', true), '{}')::jsonb; exception when others then h := '{}'::jsonb; end;
  c := upper(coalesce(nullif(h ->> 'cf-ipcountry', ''), nullif(left(coalesce(guess, ''), 2), '')));
  if c is null or c !~ '^[A-Z]{2}$' or c in ('XX', 'T1') then c := null; end if;
  t := upper(left(coalesce(tz, ''), 2));
  if t !~ '^[A-Z]{2}$' then t := null; end if;
  if c is null then c := t; end if;                              -- no network country: use the timezone one

  select * into b from billing where owner = auth.uid();
  have := found;

  -- Two signals that disagree: do not trust this visit.
  if c is not null and t is not null and c <> t then
    return jsonb_build_object('region', b.region, 'changed', false, 'claim', b.region_claim, 'unverified', true);
  end if;

  if c is not null then
    insert into region_log (owner, day, country) values (auth.uid(), current_date, c) on conflict do nothing;
  end if;
  delete from region_log where owner = auth.uid() and day < current_date - 90;

  if not have or b.region is null then
    if c is null then return jsonb_build_object('region', null, 'changed', false); end if;
    insert into billing (owner, region, region_set_at) values (auth.uid(), c, now())
    on conflict (owner) do update set region = c, region_set_at = now(), updated_at = now();
    return jsonb_build_object('region', c, 'changed', true);
  end if;

  -- A fresh, free account whose country was set from a different trusted place: correct it now.
  if c is not null and c <> b.region and not coalesce(b.paid, false) and b.region_set_at > now() - interval '3 days' then
    update billing set region = c, region_set_at = now(), region_claim = null, region_claim_at = null, updated_at = now() where owner = auth.uid();
    return jsonb_build_object('region', c, 'changed', true, 'claim', null);
  end if;

  select country, count(*) into home, n from region_log
   where owner = auth.uid() and day > current_date - 30
   group by country order by count(*) desc, max(day) desc limit 1;
  select count(distinct day) into total from region_log where owner = auth.uid() and day > current_date - 30;

  if home is null or home = b.region then
    if b.region_claim is not null then
      update billing set region_claim = null, region_claim_at = null where owner = auth.uid();
    end if;
    return jsonb_build_object('region', b.region, 'changed', false, 'claim', null);
  end if;

  up_ := price_rank(home) > price_rank(b.region);
  ok := n * 2 > total and n >= case when up_ then 7 else 21 end;
  if ok and not coalesce(b.paid, false) then
    update billing set region = home, region_set_at = now(), region_claim = null, region_claim_at = null, updated_at = now()
     where owner = auth.uid();
    return jsonb_build_object('region', home, 'changed', true, 'claim', null);
  end if;
  if ok then
    update billing set region_claim = home, region_claim_at = coalesce(region_claim_at, now()) where owner = auth.uid();
    return jsonb_build_object('region', b.region, 'changed', false, 'claim', home);
  end if;
  return jsonb_build_object('region', b.region, 'changed', false, 'claim', b.region_claim);
end $$;
revoke all on function public.lock_region(text, text) from public, anon;
grant execute on function public.lock_region(text, text) to authenticated;
