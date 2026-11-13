-- Lets people log in with their username as well as their email.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
create or replace function public.login_email(u text) returns text
language sql security definer stable set search_path = public, auth as $$
  select au.email from public.profiles p join auth.users au on au.id = p.id
  where lower(p.settings->'user'->>'username') = lower(u)
  order by au.created_at limit 1
$$;
create or replace function public.username_taken(u text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles p where lower(p.settings->'user'->>'username') = lower(u))
$$;
revoke all on function public.login_email(text) from public;
revoke all on function public.username_taken(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;
grant execute on function public.username_taken(text) to anon, authenticated;
