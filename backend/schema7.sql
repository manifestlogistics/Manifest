-- Manifest usage limits and top-up packs.
-- Run once in Supabase: SQL Editor -> paste -> Run.
-- Customers can READ their own numbers but can never change them. Only the worker (secret key) writes.

-- 1. Which plan someone is really on (a customer cannot edit this table).
create table if not exists public.billing (
  owner      uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'starter' check (plan in ('starter','growth','pro','enterprise')),
  updated_at timestamptz not null default now()
);

-- 2. What was used each calendar month (UTC).
create table if not exists public.usage (
  owner  uuid not null references auth.users(id) on delete cascade,
  month  text not null,                       -- like 2026-11
  email  int  not null default 0,
  wa     int  not null default 0,
  ai     int  not null default 0,
  warned jsonb not null default '{}'::jsonb,  -- which warnings were already sent
  primary key (owner, month)
);

-- 3. Extra messages bought as packs. They last until used.
create table if not exists public.pack_credits (
  owner      uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('email','wa','ai')),
  credits    int  not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner, kind)
);

alter table public.billing      enable row level security;
alter table public.usage        enable row level security;
alter table public.pack_credits enable row level security;
drop policy if exists "own billing" on public.billing;
drop policy if exists "own usage"   on public.usage;
drop policy if exists "own packs"   on public.pack_credits;
create policy "own billing" on public.billing      for select to authenticated using (owner = auth.uid());
create policy "own usage"   on public.usage        for select to authenticated using (owner = auth.uid());
create policy "own packs"   on public.pack_credits for select to authenticated using (owner = auth.uid());

-- 4. Spend one send. Uses the monthly allowance first, then pack credits.
--    Returns {src: plan|pack|none, used, cap, pack, warn: null|80|100}
create or replace function public.spend(o uuid, k text, cap int, m text, n int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare used int; w jsonb; src text; warn text; left_over int := 0;
begin
  if k not in ('email','wa','ai') then raise exception 'bad kind'; end if;
  insert into usage (owner, month) values (o, m) on conflict do nothing;
  execute format('select %I, warned from usage where owner = $1 and month = $2 for update', k) into used, w using o, m;
  if used + n <= cap then
    execute format('update usage set %I = %I + $3 where owner = $1 and month = $2', k, k) using o, m, n;
    used := used + n; src := 'plan';
    if cap > 0 and used * 5 >= cap * 4 and (w ->> (k || '80')) is null then warn := '80'; end if;
  else
    update pack_credits set credits = credits - n, updated_at = now()
      where owner = o and kind = k and credits >= n returning credits into left_over;
    if found then src := 'pack';
    else
      src := 'none';
      if (w ->> (k || '100')) is null then warn := '100'; end if;
    end if;
  end if;
  if warn is not null then
    update usage set warned = warned || jsonb_build_object(k || warn, true) where owner = o and month = m;
  end if;
  if src <> 'pack' then
    select coalesce((select credits from pack_credits where owner = o and kind = k), 0) into left_over;
  end if;
  return jsonb_build_object('src', src, 'used', used, 'cap', cap, 'pack', left_over, 'warn', warn);
end $$;

-- Give one send back (for example when the email failed to go out).
create or replace function public.unspend(o uuid, k text, m text, src text, n int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if k not in ('email','wa','ai') then raise exception 'bad kind'; end if;
  if src = 'plan' then
    execute format('update usage set %I = greatest(%I - $3, 0) where owner = $1 and month = $2', k, k) using o, m, n;
  elsif src = 'pack' then
    update pack_credits set credits = credits + n, updated_at = now() where owner = o and kind = k;
  end if;
end $$;

-- Add pack credits after someone pays (you run this by hand until payments are connected).
create or replace function public.grant_pack(o uuid, k text, n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if k not in ('email','wa','ai') or n <= 0 then raise exception 'bad pack'; end if;
  insert into pack_credits (owner, kind, credits) values (o, k, n)
  on conflict (owner, kind) do update set credits = pack_credits.credits + n, updated_at = now();
end $$;

revoke all on function public.spend(uuid, text, int, text, int)      from public, anon, authenticated;
revoke all on function public.unspend(uuid, text, text, text, int)   from public, anon, authenticated;
revoke all on function public.grant_pack(uuid, text, int)            from public, anon, authenticated;
grant execute on function public.spend(uuid, text, int, text, int)    to service_role;
grant execute on function public.unspend(uuid, text, text, text, int) to service_role;
grant execute on function public.grant_pack(uuid, text, int)          to service_role;

-- To move someone to a paid plan by hand (replace the email):
--   insert into billing (owner, plan) select id, 'growth' from auth.users where email = 'them@example.com'
--   on conflict (owner) do update set plan = excluded.plan, updated_at = now();
-- To add a pack they paid for (kinds: email, wa, ai):
--   select grant_pack((select id from auth.users where email = 'them@example.com'), 'wa', 500);
