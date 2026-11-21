-- Manifest payments (Polar). Run once in Supabase after schema11.sql. Safe to run again.
-- Only the payment function (and you, by hand) can change these. Customers can only read their own row.
alter table public.billing
  add column if not exists polar_customer_id text,
  add column if not exists polar_subscription_id text,
  add column if not exists polar_status text,
  add column if not exists period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists pay_country text;

-- Remembers which Polar notifications were already handled, so a repeat does nothing.
create table if not exists public.polar_events (
  id text primary key,
  type text not null default '',
  received_at timestamptz not null default now()
);
alter table public.polar_events enable row level security;   -- no policies: nobody but the server can touch it
