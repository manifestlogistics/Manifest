-- Manifest: price region lock. Run once in Supabase after schema8.sql: SQL Editor -> paste -> Run.
-- A customer's price country is set from where they sign in, then stays fixed for 90 days.
-- Customers can read it but cannot change it.
alter table public.billing add column if not exists region text;
alter table public.billing add column if not exists region_set_at timestamptz;

create or replace function public.lock_region(guess text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb; c text; b public.billing%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  begin h := coalesce(current_setting('request.headers', true), '{}')::jsonb; exception when others then h := '{}'::jsonb; end;
  -- The country the server sees wins. The app's own guess is only used when the server cannot tell.
  c := upper(coalesce(nullif(h ->> 'cf-ipcountry', ''), nullif(left(coalesce(guess, ''), 2), '')));
  if c is null or c !~ '^[A-Z]{2}$' or c in ('XX', 'T1') then c := null; end if;
  select * into b from billing where owner = auth.uid();
  if found and b.region is not null and b.region_set_at > now() - interval '90 days' then
    return jsonb_build_object('region', b.region, 'locked_until', b.region_set_at + interval '90 days', 'changed', false);
  end if;
  if c is null then return jsonb_build_object('region', b.region, 'locked_until', null, 'changed', false); end if;
  insert into billing (owner, region, region_set_at) values (auth.uid(), c, now())
  on conflict (owner) do update set region = c, region_set_at = now(), updated_at = now();
  return jsonb_build_object('region', c, 'locked_until', now() + interval '90 days', 'changed', true);
end $$;
revoke all on function public.lock_region(text) from public, anon;
grant execute on function public.lock_region(text) to authenticated;
