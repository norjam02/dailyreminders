-- Anyone can set up a circle and be its organizer (the subscriber): the
-- parent themselves, a child, a caregiver, or other family.
--
-- When the parent is the organizer, a missed check-in alerts the rest of the
-- circle right away, since there's no separate organizer to tell first.

create or replace function public.create_circle(
  p_name text,
  p_display_name text,
  p_role public.member_role default 'child'
)
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
  if p_role is null then
    raise exception 'Choose how you''re related to the person checking in.';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.circles (name, organizer_id)
  values (p_name, v_uid)
  returning id into v_circle;

  insert into public.circle_members (circle_id, user_id, role, status, approved_at)
  values (v_circle, v_uid, p_role, 'active', now());

  return v_circle;
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
