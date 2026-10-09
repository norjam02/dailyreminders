-- DailyPulse: wording for everyone, not just parents and families.
--
-- The person who checks in may be a parent, a client, or anyone with
-- support around them, and their circle may be caregivers or support
-- workers. Only user-facing text changes here: the error for a second
-- person who checks in, and the fallback name in notifications.

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
    raise exception 'Someone in this circle already checks in.';
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
    raise exception 'Someone in this circle already checks in.';
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
         coalesce(parent.display_name, 'Someone in your circle') || ' hasn''t checked in',
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
         coalesce(parent.display_name, 'Someone in your circle') || ' hasn''t checked in',
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

create or replace function public.notify_checked_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_name text;
  v_body text;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  select display_name into v_parent_name
  from public.profiles where id = public.circle_parent(new.circle_id);

  v_body := coalesce(
    new.quick_reply,
    case when new.response_mode = 'button' then 'Checked in.' else 'Sent a photo.' end
  );

  insert into public.notification_outbox (user_id, title, body, data)
  select m.user_id,
         coalesce(v_parent_name, 'Someone in your circle') || ' checked in',
         v_body,
         jsonb_build_object('type', 'checked_in', 'checkin_id', new.id, 'circle_id', new.circle_id)
  from public.circle_members m
  join public.circles ci on ci.id = m.circle_id
  where m.circle_id = new.circle_id
    and m.status = 'active'
    and m.role <> 'parent'
    and (
      m.user_id = ci.organizer_id
      or new.circle_alerted_at is not null
    );

  return new;
end;
$$;
