-- DailyPulse: subscriptions.
--
-- The app is free to download, sign up, set up a circle, and choose
-- check-in settings. A circle has to be active (paid, or on a pilot code)
-- before anyone can be invited, join, or be approved, and before the
-- scheduler makes or sends check-ins.
--
-- circle_access holds one row per active circle. Only the server writes it:
-- store webhooks (Apple, Google, Stripe) later, pilot codes now, or an admin
-- in the SQL Editor. The app can read its own circle's row.

create table public.circle_access (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  source text not null check (source in ('apple', 'google', 'stripe', 'pilot_code', 'manual')),
  plan text check (plan in ('monthly', 'yearly')),
  -- null means no end date (a manual grant, or a store subscription the
  -- webhook keeps current).
  active_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.circle_access enable row level security;
revoke all on public.circle_access from anon, authenticated;
grant select on public.circle_access to authenticated;

create policy "Members see their circle's access"
  on public.circle_access for select to authenticated
  using (public.is_member_or_pending(circle_id));

create function public.circle_is_active(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circle_access a
    where a.circle_id = p_circle
      and (a.active_until is null or a.active_until > now())
  );
$$;

revoke execute on function public.circle_is_active(uuid) from public, anon;
grant execute on function public.circle_is_active(uuid) to authenticated;

-- Pilot codes: each grants a number of days of access, for a limited number
-- of circles. Created in the SQL Editor; the app can't read them.
create table public.access_codes (
  code text primary key check (code = upper(code) and char_length(code) between 4 and 32),
  days integer not null check (days between 1 and 366),
  uses_left integer not null check (uses_left >= 0),
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.access_codes enable row level security;
revoke all on public.access_codes from anon, authenticated;

-- The organizer enters a pilot code. Wrong codes count toward the same
-- 10-an-hour limit as join codes and return null.
create function public.redeem_access_code(p_circle uuid, p_code text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code public.access_codes%rowtype;
  v_until timestamptz;
begin
  if not public.is_organizer(p_circle) then
    raise exception 'Only the person who set up this circle can activate it.';
  end if;

  if (
    select count(*) from public.invite_attempts
    where user_id = v_uid and attempted_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many codes tried. Wait an hour and try again.';
  end if;

  select * into v_code
  from public.access_codes
  where code = upper(btrim(p_code))
  for update;

  if not found or v_code.uses_left < 1 or v_code.expires_at < now() then
    insert into public.invite_attempts (user_id) values (v_uid);
    return null;
  end if;

  v_until := now() + make_interval(days => v_code.days);

  insert into public.circle_access (circle_id, source, active_until)
  values (p_circle, 'pilot_code', v_until)
  on conflict (circle_id) do update
    set active_until = case
          when public.circle_access.active_until is null then null
          else greatest(public.circle_access.active_until, excluded.active_until)
        end,
        updated_at = now();

  update public.access_codes set uses_left = uses_left - 1 where code = v_code.code;

  select active_until into v_until from public.circle_access where circle_id = p_circle;
  return coalesce(v_until, 'infinity'::timestamptz);
end;
$$;

revoke execute on function public.redeem_access_code(uuid, text) from public, anon;
grant execute on function public.redeem_access_code(uuid, text) to authenticated;

-- The existing functions below are unchanged except for the
-- circle_is_active checks.

create or replace function public.create_invite(p_circle uuid, p_role public.member_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
begin
  if not public.is_organizer(p_circle) then
    raise exception 'Only the person who set up this circle can invite people.';
  end if;
  if not public.circle_is_active(p_circle) then
    raise exception 'Subscribe to invite people to your circle.';
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

create or replace function public.approve_member(p_circle uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_organizer(p_circle) then
    raise exception 'Only the person who set up this circle can approve people.';
  end if;
  if not public.circle_is_active(p_circle) then
    raise exception 'Subscribe to add people to your circle.';
  end if;

  update public.circle_members
  set status = 'active', approved_at = now()
  where circle_id = p_circle and user_id = p_user and status = 'pending';

  if not found then
    raise exception 'No one is waiting for approval with that account.';
  end if;
end;
$$;

create or replace function public.redeem_invite(p_code text, p_display_name text)
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

  if (
    select count(*) from public.invite_attempts
    where user_id = v_uid and attempted_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many codes tried. Wait an hour, or ask for a new code.';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(btrim(p_code))
  for update;

  if not found or v_invite.redeemed_at is not null or v_invite.expires_at < now() then
    insert into public.invite_attempts (user_id) values (v_uid);
    return null;
  end if;

  if not public.circle_is_active(v_invite.circle_id) then
    raise exception 'This circle isn''t active yet. Ask the person who invited you to finish setting it up.';
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

create or replace function public.scheduler_tick(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Create today's and tomorrow's check-ins, in the parent's time zone.
  --    Only future times, so a new plan never starts with a miss.
  insert into public.checkins (circle_id, scheduled_for)
  select p.circle_id, slot.at
  from public.checkin_plans p
  cross join lateral unnest(p.times) as t (at_time)
  cross join lateral (
    values ((p_now at time zone p.timezone)::date),
           ((p_now at time zone p.timezone)::date + 1)
  ) as d (local_day)
  cross join lateral (
    select ((d.local_day + t.at_time) at time zone p.timezone) as at
  ) as slot
  where slot.at > p_now
    and public.circle_parent(p.circle_id) is not null
    and public.circle_is_active(p.circle_id)
  on conflict (circle_id, scheduled_for) do nothing;

  -- 2. Prompt the parent at check-in time.
  with due as (
    update public.checkins c
    set prompted_at = p_now, last_notified_at = p_now
    from public.checkin_plans p
    where p.circle_id = c.circle_id
      and c.status = 'pending'
      and c.prompted_at is null
      and c.scheduled_for <= p_now
      and public.circle_parent(c.circle_id) is not null
      and public.circle_is_active(c.circle_id)
    returning c.id, c.circle_id, p.mode, p.photo_prompt, p.personal_note
  )
  insert into public.notification_outbox (user_id, title, body, data)
  select public.circle_parent(due.circle_id),
         'Time to say hello',
         public.checkin_prompt_text(due.mode, due.photo_prompt, due.personal_note),
         jsonb_build_object('type', 'checkin', 'checkin_id', due.id, 'circle_id', due.circle_id)
  from due;

  -- 3. Remind the parent, by firmness, while not paused by Later.
  with due as (
    update public.checkins c
    set reminders_sent = c.reminders_sent + 1, last_notified_at = p_now
    from public.checkin_plans p
    where p.circle_id = c.circle_id
      and c.status = 'pending'
      and c.prompted_at is not null
      and (c.snoozed_until is null or c.snoozed_until <= p_now)
      and p_now < public.checkin_deadline(c.scheduled_for, p.wait_minutes, c.snoozed_until)
      and public.circle_parent(c.circle_id) is not null
      and (
        (p.firmness = 'normal'
          and c.reminders_sent < 2
          and p_now >= c.last_notified_at + interval '20 minutes')
        or
        (p.firmness = 'persistent'
          and p_now >= c.last_notified_at + interval '10 minutes')
      )
    returning c.id, c.circle_id, p.mode, p.photo_prompt, p.personal_note
  )
  insert into public.notification_outbox (user_id, title, body, data)
  select public.circle_parent(due.circle_id),
         'Just a reminder',
         public.checkin_prompt_text(due.mode, due.photo_prompt, due.personal_note),
         jsonb_build_object('type', 'checkin', 'checkin_id', due.id, 'circle_id', due.circle_id)
  from due;

  -- 4. Mark misses and alert the organizer. When the parent is the organizer,
  --    there's no one to alert first, so the rest of the circle hears now.
  with missed as (
    update public.checkins c
    set status = 'missed',
        organizer_alerted_at = p_now,
        circle_alerted_at = case
          when ci.organizer_id = public.circle_parent(c.circle_id) then p_now
        end
    from public.checkin_plans p, public.circles ci
    where p.circle_id = c.circle_id
      and ci.id = c.circle_id
      and c.status = 'pending'
      and c.prompted_at is not null
      and p_now >= public.checkin_deadline(c.scheduled_for, p.wait_minutes, c.snoozed_until)
    returning c.id, c.circle_id, c.scheduled_for, p.timezone, ci.organizer_id,
              ci.organizer_id = public.circle_parent(c.circle_id) as parent_organizes
  )
  insert into public.notification_outbox (user_id, title, body, data)
  select m.user_id,
         coalesce(parent.display_name, 'Your parent') || ' hasn''t checked in',
         'The ' || public.local_time_label(missed.scheduled_for, missed.timezone)
           || ' check-in is still open. A call might be good.',
         jsonb_build_object('type', 'missed', 'checkin_id', missed.id, 'circle_id', missed.circle_id)
  from missed
  join public.circle_members m
    on m.circle_id = missed.circle_id
   and m.status = 'active'
   and m.role <> 'parent'
   and (m.user_id = missed.organizer_id or missed.parent_organizes)
  left join public.profiles parent on parent.id = public.circle_parent(missed.circle_id);

  -- 5. Still missed 15 minutes later: alert everyone else active in the circle.
  with still_missed as (
    update public.checkins c
    set circle_alerted_at = p_now
    from public.checkin_plans p
    where p.circle_id = c.circle_id
      and c.status = 'missed'
      and c.circle_alerted_at is null
      and c.organizer_alerted_at <= p_now - interval '15 minutes'
    returning c.id, c.circle_id, c.scheduled_for, p.timezone
  )
  insert into public.notification_outbox (user_id, title, body, data)
  select m.user_id,
         coalesce(parent.display_name, 'Your parent') || ' hasn''t checked in',
         'The ' || public.local_time_label(s.scheduled_for, s.timezone)
           || ' check-in is still open. A call might be good.',
         jsonb_build_object('type', 'missed', 'checkin_id', s.id, 'circle_id', s.circle_id)
  from still_missed s
  join public.circles ci on ci.id = s.circle_id
  join public.circle_members m
    on m.circle_id = s.circle_id
   and m.status = 'active'
   and m.role <> 'parent'
   and m.user_id <> ci.organizer_id
  left join public.profiles parent on parent.id = public.circle_parent(s.circle_id);
end;
$$;
