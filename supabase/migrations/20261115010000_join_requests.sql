-- Joining without the wait.
--
-- 1. The person who checks in joins straight away with the code the organizer
--    made for them. That code works once, expires in a day, and was made for
--    exactly this role, so approving it again added a wait and no safety.
--    Everyone else still waits for the organizer's approval.
-- 2. The organizer gets a notification when someone asks to join, or when the
--    person who checks in has joined, so nobody waits on an app the organizer
--    hasn't opened.

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
  v_status public.member_status;
  v_organizer uuid;
  v_circle_name text;
  v_name text := btrim(p_display_name);
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
  select organizer_id, name into v_organizer, v_circle_name
  from public.circles where id = v_invite.circle_id for update;

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

  v_status := case when v_invite.role = 'parent' then 'active' else 'pending' end;

  begin
    if found then
      update public.circle_members
      set role = v_invite.role, status = v_status, joined_at = now(),
          approved_at = case when v_status = 'active' then now() end
      where circle_id = v_invite.circle_id and user_id = v_uid;
    else
      insert into public.circle_members (circle_id, user_id, role, status, approved_at)
      values (v_invite.circle_id, v_uid, v_invite.role, v_status,
              case when v_status = 'active' then now() end);
    end if;
  exception when unique_violation then
    raise exception 'Someone in this circle already checks in.';
  end;

  update public.invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code = v_invite.code;

  if v_organizer is not null and v_organizer <> v_uid then
    if v_status = 'active' then
      insert into public.notification_outbox (user_id, title, body, data)
      values (
        v_organizer,
        v_name || ' joined',
        'Check-ins start at the next time you set.',
        jsonb_build_object('type', 'member_joined', 'circle_id', v_invite.circle_id)
      );
    else
      insert into public.notification_outbox (user_id, title, body, data)
      values (
        v_organizer,
        v_name || ' wants to join ' || v_circle_name || '''s circle',
        'Open DailyPulse to approve or decline.',
        jsonb_build_object('type', 'join_request', 'circle_id', v_invite.circle_id)
      );
    end if;
  end if;

  return v_invite.circle_id;
end;
$$;
