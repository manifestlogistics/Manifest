-- Manifest: 3-day free trial. Run once in Supabase after schema7.sql: SQL Editor -> paste -> Run.
alter table public.billing add column if not exists trial_ends timestamptz;
alter table public.billing add column if not exists trial_used boolean not null default false;
alter table public.billing add column if not exists paid       boolean not null default false;

-- One free 3-day trial of Growth or Pro per account. After 3 days an unpaid trial drops back to Starter by itself.
create or replace function public.start_trial(p text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e timestamptz := now() + interval '3 days';
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p not in ('growth','pro') then raise exception 'bad plan'; end if;
  if exists (select 1 from billing where owner = auth.uid() and (trial_used or paid)) then raise exception 'trial_used'; end if;
  insert into billing (owner, plan, trial_ends, trial_used, paid) values (auth.uid(), p, e, true, false)
  on conflict (owner) do update set plan = p, trial_ends = e, trial_used = true, paid = false, updated_at = now();
  return e;
end $$;
revoke all on function public.start_trial(text) from public, anon;
grant execute on function public.start_trial(text) to authenticated;

-- When someone pays you by hand, mark them paid so it never expires:
--   insert into billing (owner, plan, paid) select id, 'growth', true from auth.users where email = 'them@example.com'
--   on conflict (owner) do update set plan = excluded.plan, paid = true, updated_at = now();
