-- Manifest database setup, part 2. Run this AFTER schema.sql. Safe to run twice.

alter table public.transporters add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.shipments add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.shipments add column if not exists freq_hours int not null default 168;
alter table public.shipments add column if not exists reply_token text not null default replace(gen_random_uuid()::text,'-','');
create unique index if not exists shipments_reply_token_idx on public.shipments(reply_token);
alter table public.messages add column if not exists kind text not null default 'sent';
create unique index if not exists alerts_once on public.alerts(shipment_id, kind, text);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null,
  category text default '',
  urgency text default 'Low',
  body text default '',
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tickets enable row level security;
drop policy if exists "own tickets" on public.tickets;
create policy "own tickets" on public.tickets for all using (owner = auth.uid()) with check (owner = auth.uid());

-- People cannot give themselves a paid plan.
create or replace function public.lock_plan() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then new.plan := 'starter';
    elsif new.plan is distinct from old.plan then new.plan := old.plan;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_lock_plan on public.profiles;
create trigger profiles_lock_plan before insert or update on public.profiles
  for each row execute function public.lock_plan();

-- Monthly shipment limit, enforced by the database too.
create or replace function public.limit_shipments() returns trigger language plpgsql as $$
declare lim int; n int; pl text;
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  select plan into pl from public.profiles where id = new.owner;
  lim := case coalesce(pl,'starter') when 'starter' then 7 when 'growth' then 52 when 'pro' then 252 else 1000000 end;
  select count(*) into n from public.shipments where owner = new.owner and created_at >= date_trunc('month', now());
  if n >= lim then raise exception 'You have reached this month''s shipment limit.'; end if;
  return new;
end $$;
drop trigger if exists shipments_limit on public.shipments;
create trigger shipments_limit before insert on public.shipments
  for each row execute function public.limit_shipments();

-- Delete my own account and everything in it.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- One-tap buttons in the transporter's email.
create or replace function public.submit_update(t text, s text) returns json
language plpgsql security definer set search_path = public as $$
declare sh public.shipments%rowtype; st text; lbl text;
begin
  select * into sh from public.shipments where reply_token = t and archived = false;
  if not found then return json_build_object('ok', false); end if;
  st := case s when 'moving' then 'in_transit' when 'customs' then 'customs_hold' when 'delayed' then 'delayed' when 'delivered' then 'delivered' else null end;
  if st is null then return json_build_object('ok', false); end if;
  lbl := case s when 'moving' then 'On the way' when 'customs' then 'Held at customs' when 'delayed' then 'Delayed' else 'Delivered' end;
  insert into public.messages(owner, shipment_id, direction, channel, body, kind)
    values (sh.owner, sh.id, 'in', 'email', 'Reply: "' || lbl || '" (tapped in the email)', 'reply');
  if st in ('delayed','customs_hold') then
    insert into public.messages(owner, shipment_id, direction, channel, body, kind)
      values (sh.owner, sh.id, 'out', 'email', 'Status changed to ' || lbl || ', based on the reply', 'warn');
  elsif st = 'delivered' then
    insert into public.messages(owner, shipment_id, direction, channel, body, kind)
      values (sh.owner, sh.id, 'out', 'email', 'Marked as Delivered', 'rep');
  end if;
  update public.shipments set status = st, last_reply = now() where id = sh.id;
  return json_build_object('ok', true, 'ref', sh.ref, 'label', lbl,
    'business', (select business_name from public.profiles where id = sh.owner));
end $$;
revoke all on function public.submit_update(text, text) from public;
grant execute on function public.submit_update(text, text) to anon, authenticated;
