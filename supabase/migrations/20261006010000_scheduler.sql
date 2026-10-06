-- Daily Check-In: the scheduler.
--
-- Runs every minute inside the database:
--   1. Creates upcoming check-ins from each plan, in the parent's time zone.
--   2. Prompts the parent at check-in time.
--   3. Reminds the parent, depending on the plan's firmness.
--   4. Marks a check-in missed when the wait runs out and alerts the organizer.
--   5. Alerts the rest of the circle if it is still missed 15 minutes later.
-- When the parent checks in, the organizer hears about it, and so does anyone
-- who was alerted about a miss.
--
-- Messages go into an outbox, then out to Expo's push service in batches.
--
-- Timing for the pilot. These are first guesses, not findings:
--   gentle      the first prompt only
--   normal      two reminders, 20 minutes apart
--   persistent  a reminder every 10 minutes until the wait runs out
--   Later       pauses reminders for 30 minutes and adds 30 minutes to the wait
--   circle      hears 15 minutes after the organizer

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create schema if not exists extensions;
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tracking on each check-in
-- ---------------------------------------------------------------------------

alter table public.checkins rename column family_alerted_at to organizer_alerted_at;

alter table public.checkins
  add column prompted_at timestamptz,
  add column last_notified_at timestamptz,
  add column circle_alerted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Outbox: every notification waits here until it is sent. Not visible to the
-- app.
-- ---------------------------------------------------------------------------

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  request_id bigint
);

create index notification_outbox_unsent_idx
  on public.notification_outbox (id)
  where sent_at is null;

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The circle's active parent, or null.
create function public.circle_parent(p_circle uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.circle_members m
  where m.circle_id = p_circle and m.role = 'parent' and m.status = 'active';
$$;

-- When a check-in counts as missed.
create function public.checkin_deadline(
  p_scheduled timestamptz,
  p_wait_minutes int,
  p_snoozed_until timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_scheduled
    + make_interval(mins => p_wait_minutes)
    + case when p_snoozed_until is null then interval '0' else interval '30 minutes' end;
$$;

-- What the parent's notification says.
create function public.checkin_prompt_text(
  p_mode public.checkin_mode,
  p_photo_prompt text,
  p_personal_note text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(p_personal_note), ''),
    case p_mode
      when 'button' then 'Tap to check in.'
      when 'photo' then 'Send a photo: ' || coalesce(nullif(btrim(p_photo_prompt), ''), 'anything you like') || '.'
      else 'Send a quick selfie.'
    end
  );
$$;

-- "10:00 AM" in the parent's time zone.
create function public.local_time_label(p_at timestamptz, p_timezone text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone p_timezone, 'FMHH12:MI AM');
$$;

-- ---------------------------------------------------------------------------
-- The scheduler. p_now exists so tests can move the clock.
-- ---------------------------------------------------------------------------

create function public.scheduler_tick(p_now timestamptz default now())
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

  -- 4. Mark misses and alert the organizer.
  with missed as (
    update public.checkins c
    set status = 'missed', organizer_alerted_at = p_now
    from public.checkin_plans p
    where p.circle_id = c.circle_id
      and c.status = 'pending'
      and c.prompted_at is not null
      and p_now >= public.checkin_deadline(c.scheduled_for, p.wait_minutes, c.snoozed_until)
    returning c.id, c.circle_id, c.scheduled_for, p.timezone
  )
  insert into public.notification_outbox (user_id, title, body, data)
  select ci.organizer_id,
         coalesce(parent.display_name, 'Your parent') || ' hasn''t checked in',
         'The ' || public.local_time_label(missed.scheduled_for, missed.timezone)
           || ' check-in is still open. A call might be good.',
         jsonb_build_object('type', 'missed', 'checkin_id', missed.id, 'circle_id', missed.circle_id)
  from missed
  join public.circles ci on ci.id = missed.circle_id
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

-- ---------------------------------------------------------------------------
-- When the parent checks in: tell the organizer, and anyone alerted about a
-- miss, so they can stand down.
-- ---------------------------------------------------------------------------

create function public.notify_checked_in()
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
         coalesce(v_parent_name, 'Your parent') || ' checked in',
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

create trigger checkins_notify_checked_in
  after update of status on public.checkins
  for each row execute function public.notify_checked_in();

-- When the organizer changes the times or time zone, drop upcoming check-ins
-- that have not started. The next tick recreates them from the new plan.
create function public.reset_upcoming_checkins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.checkins
  where circle_id = new.circle_id
    and status = 'pending'
    and prompted_at is null
    and scheduled_for > now();
  return new;
end;
$$;

create trigger checkin_plans_reset_upcoming
  after update of times, timezone on public.checkin_plans
  for each row
  when (old.times is distinct from new.times or old.timezone is distinct from new.timezone)
  execute function public.reset_upcoming_checkins();

-- ---------------------------------------------------------------------------
-- Sending: posts unsent notifications to Expo's push service, up to 100
-- messages per request, one message per device token. People with no
-- registered device are skipped.
-- ---------------------------------------------------------------------------

create function public.send_outbox(p_batch int default 100)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_chunk jsonb;
  v_request bigint;
  v_sent int := 0;
begin
  loop
    select array_agg(id) into v_ids
    from (
      select id
      from public.notification_outbox
      where sent_at is null
      order by id
      limit p_batch
      for update skip locked
    ) batch;

    exit when v_ids is null;

    v_request := null;
    for v_chunk in
      select jsonb_agg(msg)
      from (
        select msg, (row_number() over () - 1) / 100 as grp
        from (
          select jsonb_build_object(
                   'to', t.token,
                   'title', o.title,
                   'body', o.body,
                   'data', o.data,
                   'sound', 'default',
                   'priority', 'high'
                 ) as msg
          from public.notification_outbox o
          join public.push_tokens t on t.user_id = o.user_id
          where o.id = any (v_ids)
          order by o.id, t.token
        ) messages
      ) numbered
      group by grp
      order by grp
    loop
      v_request := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := v_chunk,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Accept', 'application/json'
        )
      );
    end loop;

    update public.notification_outbox
    set sent_at = now(), request_id = v_request
    where id = any (v_ids);

    v_sent := v_sent + cardinality(v_ids);
  end loop;

  return v_sent;
end;
$$;

-- None of these are for the app.
revoke execute on function
  public.circle_parent(uuid),
  public.checkin_deadline(timestamptz, int, timestamptz),
  public.checkin_prompt_text(public.checkin_mode, text, text),
  public.local_time_label(timestamptz, text),
  public.scheduler_tick(timestamptz),
  public.notify_checked_in(),
  public.reset_upcoming_checkins(),
  public.send_outbox(int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Run every minute.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'dailyreminders-scheduler',
      '* * * * *',
      'select public.scheduler_tick(); select public.send_outbox();'
    );
  end if;
end;
$$;
