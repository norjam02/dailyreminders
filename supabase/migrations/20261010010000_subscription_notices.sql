-- DailyPulse: subscription notice emails.
--
-- The Terms promise that once a year, and 7 to 30 days before any price
-- change, the organizer gets an email saying what they pay, how often, and
-- how to cancel. The subscription-notices server function sends them; this
-- table remembers what went out so nobody gets the same notice twice.
--
-- Only store subscriptions (App Store, Google Play) get these. Pilot codes
-- and manual grants don't charge anyone.

create table public.subscription_notices (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('annual', 'price_change')),
  -- Which notice: the send date for a yearly one, or the plan and date of a
  -- price change. Each is recorded, and so sent, once.
  notice_key text not null,
  sent_at timestamptz not null default now(),
  unique (circle_id, kind, notice_key)
);

create index subscription_notices_recent_idx on public.subscription_notices (circle_id, kind, sent_at desc);

-- Server only; the app never reads or writes it.
alter table public.subscription_notices enable row level security;
revoke all on public.subscription_notices from public, anon, authenticated;

-- Circles paid through a store, still active, with their organizer. For the
-- annual notice, leaves out circles that got one in the last 330 days.
create function public.store_subscribed_circles(p_kind text)
returns table (
  circle_id uuid,
  organizer_id uuid,
  source text,
  plan text,
  max_members integer,
  active_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.organizer_id, a.source, a.plan, a.max_members, a.active_until
  from public.circles c
  join public.circle_access a on a.circle_id = c.id
  where a.source in ('apple', 'google')
    and (a.active_until is null or a.active_until > now())
    and (
      p_kind <> 'annual'
      or not exists (
        select 1 from public.subscription_notices n
        where n.circle_id = c.id and n.kind = 'annual'
          and n.sent_at > now() - interval '330 days'
      )
    )
  order by c.created_at, c.id;
$$;

revoke execute on function public.store_subscribed_circles(text) from public, anon, authenticated;
grant execute on function public.store_subscribed_circles(text) to service_role;
grant select, insert, delete on public.subscription_notices to service_role;
grant usage on sequence public.subscription_notices_id_seq to service_role;

-- Once a day at 15:00 UTC (9 or 10 a.m. in Minnesota), ask the server
-- function to send any annual notices that are due. It needs two Vault
-- secrets, added once in the SQL Editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as NOTICES_SECRET>', 'notices_secret');
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'dailypulse-subscription-notices',
      '0 15 * * *',
      $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/subscription-notices',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-notices-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notices_secret')
        ),
        body := jsonb_build_object('kind', 'annual', 'dryRun', false)
      )
      where exists (select 1 from vault.decrypted_secrets where name = 'notices_secret');
      $job$
    );
  end if;
end;
$$;
