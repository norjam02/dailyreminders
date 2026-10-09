-- DailyPulse: fixes from the October 9 review.
--
--  1. Joining and approving lock the circle first, so two people can't both
--     take the last place and push a circle past its size limit.
--  2. A pilot code that outlasts a store subscription takes over the circle's
--     access, so a later renewal or cancellation can't cut it short.
--  3. When the person checking in set up the circle, everyone in it hears
--     each check-in.
--  4. A photo check-in of "a selfie" says "Send a quick selfie." in the push.
--  5. The app can no longer ask about circles it isn't in: the size and
--     active checks are only used inside the database's own functions.
--  6. Push tokens belong to one account at a time, so after switching
--     accounts on a phone, the old account's alerts stop going there.
--  7. New pilot codes must be at least 10 characters, and
--     new_pilot_code() makes random ones.

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

  -- One join at a time per circle, so two people can't both take the last place.
  perform 1 from public.circles where id = v_invite.circle_id for update;

  if public.circle_member_count(v_invite.circle_id) >= public.circle_member_limit(v_invite.circle_id) then
    raise exception 'This circle is full. Ask the person who invited you to make room or upgrade their plan.';
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
  perform 1 from public.circles where id = p_circle for update;

  if (
    select count(*) from public.circle_members
    where circle_id = p_circle and status = 'active'
  ) >= public.circle_member_limit(p_circle) then
    raise exception 'Your circle is full. Upgrade your plan, or remove someone first.';
  end if;

  update public.circle_members
  set status = 'active', approved_at = now()
  where circle_id = p_circle and user_id = p_user and status = 'pending';

  if not found then
    raise exception 'No one is waiting for approval with that account.';
  end if;
end;
$$;

create or replace function public.redeem_access_code(p_circle uuid, p_code text)
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

  insert into public.circle_access (circle_id, source, active_until, max_members)
  values (p_circle, 'pilot_code', v_until, v_code.max_members)
  on conflict (circle_id) do update
    set active_until = case
          when public.circle_access.active_until is null then null
          else greatest(public.circle_access.active_until, excluded.active_until)
        end,
        -- When the code outlasts a store subscription, the code owns the row,
        -- so a later store renewal or cancellation can't cut it short.
        source = case
          when public.circle_access.active_until is not null
            and excluded.active_until > public.circle_access.active_until then 'pilot_code'
          else public.circle_access.source
        end,
        plan = case
          when public.circle_access.active_until is not null
            and excluded.active_until > public.circle_access.active_until then null
          else public.circle_access.plan
        end,
        max_members = greatest(public.circle_access.max_members, excluded.max_members),
        updated_at = now();

  update public.access_codes set uses_left = uses_left - 1 where code = v_code.code;

  select active_until into v_until from public.circle_access where circle_id = p_circle;
  return coalesce(v_until, 'infinity'::timestamptz);
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
      -- When the person checking in set up the circle, their circle hears
      -- every check-in; there's no separate organizer to tell.
      or ci.organizer_id = public.circle_parent(new.circle_id)
    );

  return new;
end;
$$;

create or replace function public.checkin_prompt_text(
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
      when 'photo' then case
        when lower(btrim(p_photo_prompt)) = 'a selfie' then 'Send a quick selfie.'
        else 'Send a photo: ' || coalesce(nullif(btrim(p_photo_prompt), ''), 'anything you like') || '.'
      end
      else 'Send a quick selfie.'
    end
  );
$$;

-- 5. Internal only.
revoke execute on function public.circle_is_active(uuid), public.circle_member_count(uuid),
  public.circle_member_limit(uuid) from authenticated;

-- 6. One account per push token.
delete from public.push_tokens a
using public.push_tokens b
where a.token = b.token and a.updated_at < b.updated_at;

create unique index push_tokens_token_key on public.push_tokens (token);

create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;
  delete from public.push_tokens where token = p_token and user_id <> v_uid;
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (v_uid, p_token, p_platform, now())
  on conflict (user_id, token) do update set platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- 7. Stronger pilot codes.
alter table public.access_codes
  add constraint access_codes_long_enough check (char_length(code) >= 10) not valid;

-- For the SQL Editor:
--   select public.new_pilot_code(30, 20, 10, 'November pilot');
create function public.new_pilot_code(p_days integer, p_uses integer, p_max_members integer, p_note text default null)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_code text := '';
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  for i in 1..12 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
  end loop;
  insert into public.access_codes (code, days, uses_left, expires_at, max_members, note)
  values (v_code, p_days, p_uses, now() + interval '90 days', p_max_members, p_note);
  return v_code;
end;
$$;

revoke execute on function public.new_pilot_code(integer, integer, integer, text) from public, anon, authenticated;

-- 8. Account deletion (required by the App Store for apps with sign-up).
-- Called by the delete-account server function, which then removes the
-- returned circles' photo files and the sign-in account itself.
--   - Circles the person set up are deleted for everyone, with their
--     check-ins and settings.
--   - In circles where they're the person checking in, their check-in
--     photos are removed.
--   - Their membership, push tokens, and profile go with the account.
create function public.delete_account_data(p_user uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo_circles uuid[];
begin
  select coalesce(array_agg(distinct c.id), '{}') into v_photo_circles
  from public.circles c
  where c.organizer_id = p_user
     or exists (
       select 1 from public.circle_members m
       where m.circle_id = c.id and m.user_id = p_user and m.role = 'parent'
     );

  update public.checkins set photo_path = null
  where circle_id = any (v_photo_circles) and photo_path is not null;

  delete from public.circles where organizer_id = p_user;

  update public.invites set redeemed_by = null where redeemed_by = p_user;
  update public.checkin_plans set updated_by = null where updated_by = p_user;

  return v_photo_circles;
end;
$$;

revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;
