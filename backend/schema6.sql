-- Manifest settings: account deletion (30-day wait) and the devices list.
-- Run once in Supabase: SQL Editor -> paste -> Run.

-- 1. Account deletion requests -------------------------------------------------
create table if not exists public.account_deletions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  delete_at    timestamptz not null,
  reason       text not null default '',
  name         text not null default '',
  email        text not null default '',
  email_sent   boolean not null default false
);
alter table public.account_deletions enable row level security;
drop policy if exists "own deletion read" on public.account_deletions;
create policy "own deletion read" on public.account_deletions
  for select to authenticated using (user_id = auth.uid());

create or replace function public.request_deletion(r text, n text) returns timestamptz
language plpgsql security definer set search_path = public, auth as $$
declare d timestamptz := now() + interval '30 days';
begin
  insert into public.account_deletions (user_id, delete_at, reason, name, email, email_sent)
  values (auth.uid(), d, left(coalesce(r, ''), 200), left(coalesce(n, ''), 100),
          coalesce((select email from auth.users where id = auth.uid()), ''), false)
  on conflict (user_id) do update
    set requested_at = now(), delete_at = d, reason = excluded.reason,
        name = excluded.name, email = excluded.email, email_sent = false;
  return d;
end $$;
revoke all on function public.request_deletion(text, text) from public;
grant execute on function public.request_deletion(text, text) to authenticated;

-- Logging back in before the date cancels the deletion.
create or replace function public.cancel_deletion() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from public.account_deletions where user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.cancel_deletion() from public;
grant execute on function public.cancel_deletion() to authenticated;

-- 2. Devices (where you are logged in) ----------------------------------------
create table if not exists public.devices (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null default 'Computer',
  os         text not null default '',
  browser    text not null default '',
  place      text not null default '',
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked    boolean not null default false
);
alter table public.devices enable row level security;
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
