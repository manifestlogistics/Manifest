-- Manifest: price region lock. Run once in Supabase after schema8.sql: SQL Editor -> paste -> Run.
-- A customer's price country is set from where they sign in, then stays fixed for 90 days.
-- Rules after that: paying customers are never moved; a move to a MORE expensive group is automatic;
-- a move to a CHEAPER group is never automatic, it is only recorded for you to review.
-- Customers can read all of this but cannot change it.
alter table public.billing add column if not exists region text;
alter table public.billing add column if not exists region_set_at timestamptz;
alter table public.billing add column if not exists region_claim text;       -- a cheaper country we noticed, waiting for you to review
alter table public.billing add column if not exists region_claim_at timestamptz;

-- 1 = lower-income group C, 2 = middle group B, 3 = everyone else (group A and USD).
create or replace function public.price_rank(c text) returns int language sql immutable as $$
  select case
    when c = any (array['PK','IN','BD','LK','NP','EG','NG','KE','MA','ID','VN','PH','AR','UA']) then 1
    when c = any (array['PL','CZ','HU','RO','MY','TH','MX','BR','CL','ZA','TR','PE','CO']) then 2
    else 3 end
$$;

create or replace function public.lock_region(guess text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb; c text; b public.billing%rowtype; until_ timestamptz;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  begin h := coalesce(current_setting('request.headers', true), '{}')::jsonb; exception when others then h := '{}'::jsonb; end;
  -- The country the server sees wins. The app's own guess is only used when the server cannot tell.
  c := upper(coalesce(nullif(h ->> 'cf-ipcountry', ''), nullif(left(coalesce(guess, ''), 2), '')));
  if c is null or c !~ '^[A-Z]{2}$' or c in ('XX', 'T1') then c := null; end if;
  select * into b from billing where owner = auth.uid();
  if found and b.region is not null then
    until_ := b.region_set_at + interval '90 days';
    -- Paying customers keep their price country for as long as they pay.
    if b.paid or until_ > now() then
      return jsonb_build_object('region', b.region, 'locked_until', until_, 'changed', false, 'claim', b.region_claim);
    end if;
    if c is null or c = b.region then
      return jsonb_build_object('region', b.region, 'locked_until', until_, 'changed', false, 'claim', b.region_claim);
    end if;
    -- Seen in a cheaper group: do not change anything, just note it for review.
    if price_rank(c) < price_rank(b.region) then
      update billing set region_claim = c, region_claim_at = now() where owner = auth.uid();
      return jsonb_build_object('region', b.region, 'locked_until', until_, 'changed', false, 'claim', c);
    end if;
  end if;
  if c is null then return jsonb_build_object('region', b.region, 'locked_until', null, 'changed', false); end if;
  insert into billing (owner, region, region_set_at) values (auth.uid(), c, now())
  on conflict (owner) do update set region = c, region_set_at = now(), region_claim = null, region_claim_at = null, updated_at = now();
  return jsonb_build_object('region', c, 'locked_until', now() + interval '90 days', 'changed', true);
end $$;
revoke all on function public.lock_region(text) from public, anon;
grant execute on function public.lock_region(text) to authenticated;

-- To review who was seen in a cheaper country:
--   select u.email, b.region, b.region_claim, b.region_claim_at from billing b join auth.users u on u.id = b.owner where b.region_claim is not null;
-- To approve a move (for example someone who really relocated):
--   update billing set region = 'PK', region_set_at = now(), region_claim = null where owner = (select id from auth.users where email = 'them@example.com');
