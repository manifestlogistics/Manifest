-- Manifest: real teams. Run once in Supabase after schema10.sql: SQL Editor -> paste -> Run. Safe to run again.
-- An owner invites people by email. They sign up or log in with that address, accept, and then work inside the
-- owner's workspace. Roles are enforced here in the database, not only in the app:
--   owner / admin / operator can add and change shipments, contacts and documents; viewer can only look.
-- Only Pro (10 people) and bigger plans can have team members. If a plan drops back to Starter or Growth,
-- members lose access until the plan is back (nothing is deleted).

create table if not exists public.team_members (
  owner uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  member uuid references auth.users(id) on delete set null,
  name text not null default '',
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  last_seen timestamptz,
  emailed boolean not null default false,
  primary key (owner, email)
);
create index if not exists team_members_member_idx on public.team_members(member);
alter table public.team_members enable row level security;

create or replace function public.seats_of(o uuid) returns int
language sql stable security definer set search_path = public as $$
  select case coalesce((
    select case when b.paid or b.trial_ends is null or b.trial_ends > now() then b.plan else 'starter' end
    from billing b where b.owner = o), 'starter')
    when 'pro' then 10 when 'enterprise' then 999 else 1 end
$$;

-- The caller's role inside workspace o: 'owner', 'admin', 'operator', 'viewer', or null (no access).
create or replace function public.ws_role(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when o = auth.uid() then 'owner'
    else (select t.role from team_members t where t.owner = o and t.member = auth.uid() and t.status = 'active' and seats_of(o) > 1) end
$$;
create or replace function public.ws_role_txt(t text) returns text
language sql stable security definer set search_path = public as $$
  select case when t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then ws_role(t::uuid) end
$$;
grant execute on function public.seats_of(uuid), public.ws_role(uuid), public.ws_role_txt(text) to authenticated;

-- Team list: owner and members of the same workspace can read it. Changes only through the functions below.
drop policy if exists "team read" on public.team_members;
create policy "team read" on public.team_members for select to authenticated
  using (owner = auth.uid() or member = auth.uid() or ws_role(owner) is not null);

-- Shipments, contacts, messages, alerts: shared inside a workspace, writes need owner/admin/operator.
do $$
declare t text;
begin
  foreach t in array array['shipments', 'transporters', 'messages', 'alerts'] loop
    execute format('drop policy if exists "own %s" on public.%I', t, t);
    execute format('drop policy if exists "ws read %s" on public.%I', t, t);
    execute format('drop policy if exists "ws insert %s" on public.%I', t, t);
    execute format('drop policy if exists "ws update %s" on public.%I', t, t);
    execute format('drop policy if exists "ws delete %s" on public.%I', t, t);
    execute format('create policy "ws read %s" on public.%I for select to authenticated using (ws_role(owner) is not null)', t, t);
    execute format('create policy "ws insert %s" on public.%I for insert to authenticated with check (ws_role(owner) in (''owner'',''admin'',''operator''))', t, t);
    execute format('create policy "ws update %s" on public.%I for update to authenticated using (ws_role(owner) in (''owner'',''admin'',''operator'')) with check (ws_role(owner) in (''owner'',''admin'',''operator''))', t, t);
    execute format('create policy "ws delete %s" on public.%I for delete to authenticated using (ws_role(owner) in (''owner'',''admin'',''operator''))', t, t);
  end loop;
end $$;

-- Members can read the workspace's business profile, plan and usage (read only).
drop policy if exists "team reads profile" on public.profiles;
create policy "team reads profile" on public.profiles for select to authenticated using (ws_role(id) is not null);
do $$
declare t text;
begin
  foreach t in array array['billing', 'usage', 'pack_credits'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "team reads %s" on public.%I', t, t);
      execute format('create policy "team reads %s" on public.%I for select to authenticated using (ws_role(owner) is not null)', t, t);
    end if;
  end loop;
end $$;

-- Documents (files): the first folder in the path is the workspace owner's id.
drop policy if exists "docs read own" on storage.objects;
drop policy if exists "docs insert own" on storage.objects;
drop policy if exists "docs update own" on storage.objects;
drop policy if exists "docs delete own" on storage.objects;
drop policy if exists "docs read ws" on storage.objects;
drop policy if exists "docs insert ws" on storage.objects;
drop policy if exists "docs update ws" on storage.objects;
drop policy if exists "docs delete ws" on storage.objects;
create policy "docs read ws" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and ws_role_txt((storage.foldername(name))[1]) is not null);
create policy "docs insert ws" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and ws_role_txt((storage.foldername(name))[1]) in ('owner', 'admin', 'operator'));
create policy "docs update ws" on storage.objects for update to authenticated
  using (bucket_id = 'docs' and ws_role_txt((storage.foldername(name))[1]) in ('owner', 'admin', 'operator'));
create policy "docs delete ws" on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and ws_role_txt((storage.foldername(name))[1]) in ('owner', 'admin', 'operator'));

-- ---------- team functions ----------
create or replace function public.team_invite(o uuid, e text, r text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := ws_role(o); em text := lower(trim(e)); n int;
begin
  if me is null or me not in ('owner', 'admin') then raise exception 'Only an owner or admin can invite people.'; end if;
  if r not in ('admin', 'operator', 'viewer') then raise exception 'Unknown role.'; end if;
  if r = 'admin' and me <> 'owner' then raise exception 'Only the owner can add an admin.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right.'; end if;
  if exists (select 1 from auth.users u where u.id = o and lower(u.email) = em) then raise exception 'That is the owner of this workspace.'; end if;
  if seats_of(o) <= 1 then raise exception 'Your plan is for one person. Upgrade to Pro to add a team.'; end if;
  select count(*) into n from team_members where owner = o;
  if n + 1 >= seats_of(o) then raise exception 'All the spots on your team are taken.'; end if;
  if exists (select 1 from team_members where owner = o and email = em) then raise exception 'That person is already on your team.'; end if;
  insert into team_members (owner, email, role) values (o, em, r);
  return jsonb_build_object('email', em, 'role', r);
end $$;

create or replace function public.team_set_role(o uuid, e text, r text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := ws_role(o);
begin
  if me is null or me not in ('owner', 'admin') then raise exception 'Not allowed.'; end if;
  if r not in ('admin', 'operator', 'viewer') then raise exception 'Unknown role.'; end if;
  if (r = 'admin' or (select role from team_members where owner = o and email = lower(e)) = 'admin') and me <> 'owner' then
    raise exception 'Only the owner can change an admin.'; end if;
  update team_members set role = r where owner = o and email = lower(e);
end $$;

create or replace function public.team_set_suspended(o uuid, e text, s boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me text := ws_role(o); t team_members%rowtype;
begin
  if me is null or me not in ('owner', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from team_members where owner = o and email = lower(e);
  if not found then return; end if;
  if t.role = 'admin' and me <> 'owner' then raise exception 'Only the owner can change an admin.'; end if;
  update team_members set status = case when s then 'suspended' when member is null then 'invited' else 'active' end
   where owner = o and email = lower(e);
end $$;

create or replace function public.team_remove(o uuid, e text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := ws_role(o); t team_members%rowtype;
begin
  if me is null or me not in ('owner', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from team_members where owner = o and email = lower(e);
  if found and t.role = 'admin' and me <> 'owner' then raise exception 'Only the owner can remove an admin.'; end if;
  delete from team_members where owner = o and email = lower(e);
end $$;

-- Invitations waiting for the signed-in person (matched by the email they signed in with).
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('owner', t.owner, 'role', t.role, 'biz', coalesce(nullif(p.business_name, ''), 'a Manifest workspace'))), '[]'::jsonb)
  from team_members t left join profiles p on p.id = t.owner
  where t.status = 'invited' and t.email = lower(coalesce(auth.jwt() ->> 'email', '')) and seats_of(t.owner) > 1
$$;

create or replace function public.accept_invite(o uuid, nm text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); t team_members%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from team_members where member = auth.uid() and status in ('active', 'suspended')) then
    raise exception 'You are already on a team. Leave it first.'; end if;
  select * into t from team_members where owner = o and email = em and status = 'invited';
  if not found then raise exception 'That invitation is no longer open.'; end if;
  update team_members set member = auth.uid(), status = 'active', joined_at = now(), last_seen = now(), name = left(coalesce(nm, ''), 80)
   where owner = o and email = em;
  return jsonb_build_object('owner', o, 'role', t.role);
end $$;

-- The workspace the signed-in person works in, if they joined someone's team. Also notes "last seen".
create or replace function public.my_workspace() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t team_members%rowtype; biz text;
begin
  if auth.uid() is null then return null; end if;
  select * into t from team_members where member = auth.uid() and status = 'active' limit 1;
  if not found or seats_of(t.owner) <= 1 then return null; end if;
  if t.last_seen is null or t.last_seen < now() - interval '5 minutes' then
    update team_members set last_seen = now() where owner = t.owner and email = t.email;
  end if;
  select business_name into biz from profiles where id = t.owner;
  return jsonb_build_object('owner', t.owner, 'role', t.role, 'biz', coalesce(biz, ''));
end $$;

create or replace function public.team_leave() returns void
language sql security definer set search_path = public as $$
  delete from team_members where member = auth.uid()
$$;

-- Documents list lives in the owner's profile. Owner/admin/operator may change just that part.
create or replace function public.ws_vault_set(o uuid, v jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if ws_role(o) not in ('owner', 'admin', 'operator') then raise exception 'Not allowed.'; end if;
  update profiles set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{vault}', coalesce(v, '[]'::jsonb), true) where id = o;
end $$;

revoke all on function public.team_invite(uuid, text, text), public.team_set_role(uuid, text, text), public.team_set_suspended(uuid, text, boolean),
  public.team_remove(uuid, text), public.my_invites(), public.accept_invite(uuid, text), public.my_workspace(), public.team_leave(),
  public.ws_vault_set(uuid, jsonb) from public, anon;
grant execute on function public.team_invite(uuid, text, text), public.team_set_role(uuid, text, text), public.team_set_suspended(uuid, text, boolean),
  public.team_remove(uuid, text), public.my_invites(), public.accept_invite(uuid, text), public.my_workspace(), public.team_leave(),
  public.ws_vault_set(uuid, jsonb) to authenticated;
