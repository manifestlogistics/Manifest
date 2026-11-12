-- Manifest database setup. Paste into Supabase > SQL Editor > Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text default '',
  plan text not null default 'starter',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.transporters (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  email text default '',
  phone text default '',
  language text not null default 'English',
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ref text not null,
  transporter_id uuid references public.transporters(id) on delete set null,
  origin text default '',
  destination text default '',
  eta date,
  status text not null default 'on_track',
  freq_days int not null default 7,
  last_checkin timestamptz,
  next_checkin timestamptz default now(),
  last_reply timestamptz,
  archived boolean not null default false,
  token text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  channel text not null default 'email',
  body text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete cascade,
  kind text not null,
  text text not null default '',
  seen boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists shipments_owner_idx on public.shipments(owner);
create index if not exists shipments_next_idx on public.shipments(next_checkin) where archived = false;
create index if not exists messages_ship_idx on public.messages(shipment_id, created_at);
create index if not exists alerts_owner_idx on public.alerts(owner, created_at desc);

-- Each person can only see and change their own rows.
alter table public.profiles enable row level security;
alter table public.transporters enable row level security;
alter table public.shipments enable row level security;
alter table public.messages enable row level security;
alter table public.alerts enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own transporters" on public.transporters for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own shipments" on public.shipments for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own messages" on public.messages for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own alerts" on public.alerts for all using (owner = auth.uid()) with check (owner = auth.uid());

-- Make a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, business_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'business', ''));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Public customer tracking page: anyone with the private link sees only these fields.
create or replace function public.get_tracking(t text) returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'ref', s.ref, 'origin', s.origin, 'destination', s.destination,
    'eta', s.eta, 'status', s.status, 'last_reply', s.last_reply,
    'business', p.business_name)
  from shipments s join profiles p on p.id = s.owner
  where s.token = t and s.archived = false
$$;
revoke all on function public.get_tracking(text) from public;
grant execute on function public.get_tracking(text) to anon, authenticated;
