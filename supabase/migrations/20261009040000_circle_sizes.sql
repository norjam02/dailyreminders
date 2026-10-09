-- DailyPulse: circle sizes.
--
-- A circle holds at most 10 people, counting everyone in it: the person who
-- checks in, the organizer, and everyone else, including people waiting for
-- approval. The plan sets the limit:
--   Standard: up to 4 people, $4.99 a month or $49 a year
--   Plus:     up to 10 people, $9.99 a month or $99 a year
-- Inviting, joining, and approving stop once a circle is full. Nobody is
-- removed if a circle shrinks its plan; it just can't add anyone until it
-- has room.

alter table public.circle_access
  add column max_members integer not null default 4 check (max_members between 1 and 10);

alter table public.access_codes
  add column max_members integer not null default 4 check (max_members between 1 and 10);

-- How many people a circle may hold right now (0 when it isn't on).
create function public.circle_member_limit(p_circle uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.max_members from public.circle_access a
    where a.circle_id = p_circle
      and (a.active_until is null or a.active_until > now())
  ), 0);
$$;

-- Everyone in the circle or waiting to be approved.
create function public.circle_member_count(p_circle uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.circle_members m
  where m.circle_id = p_circle and m.status in ('active', 'pending');
$$;

revoke execute on function public.circle_member_limit(uuid), public.circle_member_count(uuid) from public, anon;
grant execute on function public.circle_member_limit(uuid), public.circle_member_count(uuid) to authenticated;

-- Store results now carry the plan's size.
drop function public.apply_store_access(uuid, boolean, text, text, timestamptz);

create function public.apply_store_access(
  p_user uuid,
  p_active boolean,
  p_source text,
  p_plan text,
  p_until timestamptz,
  p_max_members integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_circle uuid;
  v_existing public.circle_access%rowtype;
begin
  if p_source is not null and p_source not in ('apple', 'google') then
    raise exception 'Unknown store %', p_source;
  end if;

  for v_circle in select id from public.circles where organizer_id = p_user loop
    select * into v_existing from public.circle_access where circle_id = v_circle;

    if p_active then
      if not found
        or v_existing.source in ('apple', 'google')
        or (v_existing.active_until is not null and v_existing.active_until < coalesce(p_until, 'infinity'))
      then
        insert into public.circle_access (circle_id, source, plan, active_until, max_members)
        values (v_circle, p_source, p_plan, p_until, p_max_members)
        on conflict (circle_id) do update
          set source = excluded.source, plan = excluded.plan,
              active_until = excluded.active_until, max_members = excluded.max_members,
              updated_at = now();
      elsif p_max_members > v_existing.max_members then
        -- A bigger plan bought during a pilot raises the limit right away.
        update public.circle_access set max_members = p_max_members, updated_at = now()
        where circle_id = v_circle;
      end if;
    elsif found and v_existing.source in ('apple', 'google') then
      update public.circle_access
      set active_until = least(coalesce(active_until, now()), now()), updated_at = now()
      where circle_id = v_circle;
    end if;
  end loop;
end;
$$;

revoke execute on function public.apply_store_access(uuid, boolean, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.apply_store_access(uuid, boolean, text, text, timestamptz, integer) to service_role;

-- The functions below are unchanged except for the size checks.

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
  if public.circle_member_count(p_circle) >= public.circle_member_limit(p_circle) then
    raise exception 'Your circle is full. Upgrade your plan to add more people.';
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
        max_members = greatest(public.circle_access.max_members, excluded.max_members),
        updated_at = now();

  update public.access_codes set uses_left = uses_left - 1 where code = v_code.code;

  select active_until into v_until from public.circle_access where circle_id = p_circle;
  return coalesce(v_until, 'infinity'::timestamptz);
end;
$$;
