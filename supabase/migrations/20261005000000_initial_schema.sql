-- Daily Check-In: initial schema for the pilot.
--
-- A circle is one parent plus the family around them. The child creates the
-- circle, invites people with one-time codes, approves them, and sets the
-- check-in plan. The parent answers check-ins. Everyone in the circle sees
-- check-ins and photos.
--
-- Writes that need checks (creating circles, joining, approving, answering a
-- check-in) go through the functions at the bottom of this file. Tables are
-- read-only to the app except where a policy says otherwise. The scheduler
-- that creates check-ins and sends reminders runs with the service role and is
-- added in a later migration.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('child', 'parent', 'caregiver', 'family');
create type public.member_status as enum ('pending', 'active', 'removed');
create type public.checkin_mode as enum ('button', 'photo', 'selfie');
create type public.reminder_firmness as enum ('gentle', 'normal', 'persistent');
create type public.checkin_status as enum ('pending', 'done', 'missed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'pending',
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  primary key (circle_id, user_id)
);

create index circle_members_user_idx on public.circle_members (user_id);

-- A circle centers on one parent.
create unique index circle_members_one_parent
  on public.circle_members (circle_id)
  where role = 'parent' and status <> 'removed';

-- One-time join codes. Each works once and expires after a day.
create table public.invites (
  code text primary key,
  circle_id uuid not null references public.circles (id) on delete cascade,
  role public.member_role not null check (role <> 'child'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  redeemed_by uuid references public.profiles (id),
  redeemed_at timestamptz
);

create index invites_circle_idx on public.invites (circle_id);

create function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- The child's settings for how and when the parent checks in.
create table public.checkin_plans (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  mode public.checkin_mode not null default 'button',
  photo_prompt text check (char_length(photo_prompt) <= 80),
  times time[] not null default array['10:00'::time]
    check (cardinality(times) between 1 and 3),
  timezone text not null check (public.is_valid_timezone(timezone)),
  firmness public.reminder_firmness not null default 'normal',
  wait_minutes int not null default 60 check (wait_minutes in (30, 60, 120)),
  quick_replies text[] not null
    default array['Love you!', 'I''m on it', 'Thanks for checking', 'Doing fine']
    check (cardinality(quick_replies) <= 4),
  personal_note text check (char_length(personal_note) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- One row per scheduled check-in. The scheduler inserts these.
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  scheduled_for timestamptz not null,
  status public.checkin_status not null default 'pending',
  reminders_sent int not null default 0,
  snoozed_until timestamptz,
  responded_at timestamptz,
  -- How the parent actually answered. A button answer on a photo plan is the
  -- "button only" fallback for a hard day.
  response_mode public.checkin_mode,
  quick_reply text,
  photo_path text,
  family_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (circle_id, scheduled_for)
);

create index checkins_status_idx on public.checkins (status, scheduled_for);

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- ---------------------------------------------------------------------------
-- Helpers used by the access rules. Security definer so they can read
-- circle_members without tripping its own rules.
-- ---------------------------------------------------------------------------

create function public.is_active_member(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create function public.has_role(p_circle uuid, p_role public.member_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle
      and m.user_id = (select auth.uid())
      and m.role = p_role
      and m.status = 'active'
  );
$$;

-- Pending members can see the circle they asked to join.
create function public.is_member_or_pending(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle
      and m.user_id = (select auth.uid())
      and m.status <> 'removed'
  );
$$;

-- True when the caller is active in a circle that the other person is in or
-- has asked to join, so the child can see who is waiting for approval.
create function public.shares_circle_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_members me
    join public.circle_members them on them.circle_id = me.circle_id
    where me.user_id = (select auth.uid())
      and me.status = 'active'
      and them.user_id = p_other
      and them.status <> 'removed'
  );
$$;

-- Photos live at "<circle_id>/<file>". Returns the circle id, or null if the
-- path does not start with one.
create function public.photo_circle(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.invites enable row level security;
alter table public.checkin_plans enable row level security;
alter table public.checkins enable row level security;
alter table public.push_tokens enable row level security;

create policy "See own profile and people in shared circles"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_circle_with(id));

create policy "Create own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Edit own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "See circles you belong to"
  on public.circles for select to authenticated
  using (public.is_member_or_pending(id));

create policy "Child renames the circle"
  on public.circles for update to authenticated
  using (public.has_role(id, 'child'))
  with check (public.has_role(id, 'child'));

create policy "See members of your circles"
  on public.circle_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_active_member(circle_id));

create policy "Child sees the circle's join codes"
  on public.invites for select to authenticated
  using (public.has_role(circle_id, 'child'));

create policy "Members see the check-in plan"
  on public.checkin_plans for select to authenticated
  using (public.is_active_member(circle_id));

create policy "Child creates the check-in plan"
  on public.checkin_plans for insert to authenticated
  with check (public.has_role(circle_id, 'child'));

create policy "Child edits the check-in plan"
  on public.checkin_plans for update to authenticated
  using (public.has_role(circle_id, 'child'))
  with check (public.has_role(circle_id, 'child'));

create policy "Members see check-ins"
  on public.checkins for select to authenticated
  using (public.is_active_member(circle_id));

create policy "Manage own push tokens"
  on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Table privileges: only what the policies above need. Everything else goes
-- through the functions below.
revoke all on public.profiles, public.circles, public.circle_members,
  public.invites, public.checkin_plans, public.checkins, public.push_tokens
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.circles to authenticated;
grant update (name) on public.circles to authenticated;
grant select on public.circle_members to authenticated;
grant select on public.invites to authenticated;
grant select on public.checkin_plans to authenticated;
grant insert (circle_id, mode, photo_prompt, times, timezone, firmness,
  wait_minutes, quick_replies, personal_note) on public.checkin_plans to authenticated;
grant update (mode, photo_prompt, times, timezone, firmness, wait_minutes,
  quick_replies, personal_note) on public.checkin_plans to authenticated;
grant select on public.checkins to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- Stamp who last changed the plan, and when.
create function public.stamp_checkin_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger checkin_plans_stamp
  before insert or update on public.checkin_plans
  for each row execute function public.stamp_checkin_plan();

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

-- The child creates a circle and becomes its first active member. Children
-- need a real account, not an anonymous one, since they own the subscription.
create function public.create_circle(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_circle uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account to start a circle.';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.circles (name, created_by)
  values (p_name, v_uid)
  returning id into v_circle;

  insert into public.circle_members (circle_id, user_id, role, status, approved_at)
  values (v_circle, v_uid, 'child', 'active', now());

  return v_circle;
end;
$$;

-- Six characters, skipping look-alikes (no 0/O, 1/I/L).
create function public.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  code text := '';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

-- The child makes a one-time code for a parent, caregiver, or family member.
create function public.create_invite(p_circle uuid, p_role public.member_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
begin
  if not public.has_role(p_circle, 'child') then
    raise exception 'Only the person who set up this circle can invite people.';
  end if;
  if p_role = 'child' then
    raise exception 'A circle has one child account.';
  end if;
  if p_role = 'parent' and exists (
    select 1 from public.circle_members
    where circle_id = p_circle and role = 'parent' and status <> 'removed'
  ) then
    raise exception 'This circle already has a parent.';
  end if;

  loop
    v_code := public.new_invite_code();
    begin
      insert into public.invites (code, circle_id, role, created_by)
      values (v_code, p_circle, p_role, v_uid);
      return v_code;
    exception when unique_violation then
      -- Rare collision with an older code; draw again.
    end;
  end loop;
end;
$$;

-- Anyone signed in, including an anonymous parent, joins with a code. They
-- wait as pending until the child approves them.
create function public.redeem_invite(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invites%rowtype;
  v_existing public.member_status;
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(btrim(p_code))
  for update;

  if not found or v_invite.redeemed_at is not null or v_invite.expires_at < now() then
    raise exception 'That code is not valid. Ask for a new one.';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select status into v_existing
  from public.circle_members
  where circle_id = v_invite.circle_id and user_id = v_uid;

  if found and v_existing <> 'removed' then
    raise exception 'You are already in this circle.';
  end if;

  begin
    if found then
      update public.circle_members
      set role = v_invite.role, status = 'pending', joined_at = now(), approved_at = null
      where circle_id = v_invite.circle_id and user_id = v_uid;
    else
      insert into public.circle_members (circle_id, user_id, role, status)
      values (v_invite.circle_id, v_uid, v_invite.role, 'pending');
    end if;
  exception when unique_violation then
    raise exception 'This circle already has a parent.';
  end;

  update public.invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code = v_invite.code;

  return v_invite.circle_id;
end;
$$;

create function public.approve_member(p_circle uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role(p_circle, 'child') then
    raise exception 'Only the person who set up this circle can approve people.';
  end if;

  update public.circle_members
  set status = 'active', approved_at = now()
  where circle_id = p_circle and user_id = p_user and status = 'pending';

  if not found then
    raise exception 'No one is waiting for approval with that account.';
  end if;
end;
$$;

-- The child can remove anyone else. Anyone but the child can leave.
create function public.remove_member(p_circle uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_user = v_uid then
    if public.has_role(p_circle, 'child') then
      raise exception 'The person who set up the circle cannot leave it.';
    end if;
  elsif not public.has_role(p_circle, 'child') then
    raise exception 'Only the person who set up this circle can remove people.';
  end if;

  update public.circle_members
  set status = 'removed'
  where circle_id = p_circle and user_id = p_user and status <> 'removed';

  if not found then
    raise exception 'That person is not in this circle.';
  end if;
end;
$$;

-- The parent answers a check-in. A late answer after a miss still counts.
create function public.respond_checkin(
  p_checkin uuid,
  p_mode public.checkin_mode,
  p_quick_reply text default null,
  p_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkin public.checkins%rowtype;
  v_replies text[];
begin
  select * into v_checkin from public.checkins where id = p_checkin for update;

  if not found or not public.has_role(v_checkin.circle_id, 'parent') then
    raise exception 'Check-in not found.';
  end if;
  if v_checkin.status = 'done' then
    raise exception 'This check-in is already done.';
  end if;

  if p_mode = 'button' then
    if p_photo_path is not null then
      raise exception 'A button check-in has no photo.';
    end if;
  elsif p_photo_path is null
     or public.photo_circle(p_photo_path) is distinct from v_checkin.circle_id then
    raise exception 'Add the photo before checking in.';
  end if;

  if p_quick_reply is not null then
    select quick_replies into v_replies
    from public.checkin_plans where circle_id = v_checkin.circle_id;
    if v_replies is null or not (p_quick_reply = any (v_replies)) then
      raise exception 'That reply is not one of the choices.';
    end if;
  end if;

  update public.checkins
  set status = 'done',
      responded_at = now(),
      response_mode = p_mode,
      quick_reply = p_quick_reply,
      photo_path = p_photo_path
  where id = p_checkin;
end;
$$;

-- "Later": pushes reminders back once, without counting as a miss. The
-- 30-minute delay is a first guess for the pilot.
create function public.snooze_checkin(p_checkin uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkin public.checkins%rowtype;
  v_until timestamptz := now() + interval '30 minutes';
begin
  select * into v_checkin from public.checkins where id = p_checkin for update;

  if not found or not public.has_role(v_checkin.circle_id, 'parent') then
    raise exception 'Check-in not found.';
  end if;
  if v_checkin.status <> 'pending' then
    raise exception 'Only an open check-in can be put off.';
  end if;
  if v_checkin.snoozed_until is not null then
    raise exception 'Later can be used once per check-in.';
  end if;

  update public.checkins set snoozed_until = v_until where id = p_checkin;
  return v_until;
end;
$$;

-- Function privileges: signed-in users only.
revoke execute on function
  public.is_valid_timezone(text),
  public.is_active_member(uuid),
  public.has_role(uuid, public.member_role),
  public.is_member_or_pending(uuid),
  public.shares_circle_with(uuid),
  public.photo_circle(text),
  public.stamp_checkin_plan(),
  public.create_circle(text, text),
  public.new_invite_code(),
  public.create_invite(uuid, public.member_role),
  public.redeem_invite(text, text),
  public.approve_member(uuid, uuid),
  public.remove_member(uuid, uuid),
  public.respond_checkin(uuid, public.checkin_mode, text, text),
  public.snooze_checkin(uuid)
  from public, anon;

grant execute on function
  public.is_valid_timezone(text),
  public.is_active_member(uuid),
  public.has_role(uuid, public.member_role),
  public.is_member_or_pending(uuid),
  public.shares_circle_with(uuid),
  public.photo_circle(text),
  public.stamp_checkin_plan(),
  public.create_circle(text, text),
  public.create_invite(uuid, public.member_role),
  public.redeem_invite(text, text),
  public.approve_member(uuid, uuid),
  public.remove_member(uuid, uuid),
  public.respond_checkin(uuid, public.checkin_mode, text, text),
  public.snooze_checkin(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Photo storage: private bucket, files at "<circle_id>/<file>".
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-photos',
  'checkin-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do nothing;

create policy "Parent uploads check-in photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and public.has_role(public.photo_circle(name), 'parent')
  );

create policy "Circle members see check-in photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'checkin-photos'
    and public.is_active_member(public.photo_circle(name))
  );
