-- Lets the "Forgot password" screen say "no account found" for unknown emails.
create or replace function public.email_exists(e text) returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(e)));
$$;
grant execute on function public.email_exists(text) to anon, authenticated;
