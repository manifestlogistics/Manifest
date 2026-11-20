-- Manifest: ongoing location check (replaces the fixed 90-day lock). Run once in Supabase AFTER schema9.sql.
-- Every visit records the country the server sees (one row per day per country).
-- A customer's "home country" is the country they are actually in most days, so one trip, one login
-- from abroad, or a VPN for a few days never changes the price. It follows where they really live.
-- Rules: the first country seen sets the price country. After that, the home country is checked on every visit:
--   * a move to a MORE expensive group applies automatically once they have been there 7+ days and it is most of their recent days;
--   * a move to a CHEAPER group applies automatically only for free / trial accounts, after 21+ days and most of their recent days;
--   * paying customers are never moved automatically. Any different home country is just recorded for you to review.
create table if not exists public.region_log (
  owner uuid not null references auth.users(id) on delete cascade,
  day date not null,
  country text not null,
  primary key (owner, day, country)
);
alter table public.region_log enable row level security;   -- no policies: customers cannot read or change it

create or replace function public.lock_region(guess text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb; c text; b public.billing%rowtype; home text; n int; total int; up_ boolean; ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  begin h := coalesce(current_setting('request.headers', true), '{}')::jsonb; exception when others then h := '{}'::jsonb; end;
  c := upper(coalesce(nullif(h ->> 'cf-ipcountry', ''), nullif(left(coalesce(guess, ''), 2), '')));
  if c is null or c !~ '^[A-Z]{2}$' or c in ('XX', 'T1') then c := null; end if;

  if c is not null then
    insert into region_log (owner, day, country) values (auth.uid(), current_date, c) on conflict do nothing;
  end if;
  delete from region_log where owner = auth.uid() and day < current_date - 90;

  select * into b from billing where owner = auth.uid();
  if not found or b.region is null then
    if c is null then return jsonb_build_object('region', null, 'changed', false); end if;
    insert into billing (owner, region, region_set_at) values (auth.uid(), c, now())
    on conflict (owner) do update set region = c, region_set_at = now(), updated_at = now();
    return jsonb_build_object('region', c, 'changed', true);
  end if;

  -- Home country = the country seen on the most days in the last 30 days (latest wins a tie).
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
  -- Paying customers (or not enough days yet): keep the price, remember what we see.
  if ok then
    update billing set region_claim = home, region_claim_at = coalesce(region_claim_at, now()) where owner = auth.uid();
    return jsonb_build_object('region', b.region, 'changed', false, 'claim', home);
  end if;
  return jsonb_build_object('region', b.region, 'changed', false, 'claim', b.region_claim);
end $$;
revoke all on function public.lock_region(text) from public, anon;
grant execute on function public.lock_region(text) to authenticated;

-- Review paying customers whose home country differs from their price country:
--   select u.email, b.region, b.region_claim, b.region_claim_at from billing b join auth.users u on u.id = b.owner where b.region_claim is not null;
-- Approve a move by hand:
--   update billing set region = 'PK', region_set_at = now(), region_claim = null where owner = (select id from auth.users where email = 'them@example.com');
