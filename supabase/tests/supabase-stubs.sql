-- Minimal stand-ins for the parts of Supabase the migrations rely on, so the
-- schema and access rules can be tested in an in-memory Postgres without
-- Docker. These mirror Supabase's names, not its full behavior.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid()
);

alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;

-- pg_cron and pg_net stand-ins: jobs are recorded, not run, and HTTP posts are
-- recorded instead of sent.
create schema cron;

create table cron.jobs (
  name text primary key,
  schedule text not null,
  command text not null
);

create function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.jobs (name, schedule, command)
  values (job_name, schedule, command)
  on conflict (name) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint;
$$;

create schema net;

create table net.requests (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  headers jsonb
);

create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int default 2000
)
returns bigint
language sql
as $$
  insert into net.requests (url, body, headers) values (url, body, headers) returning id;
$$;
