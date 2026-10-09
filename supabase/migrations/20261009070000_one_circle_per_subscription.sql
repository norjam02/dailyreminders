-- DailyPulse: one circle per subscription.
--
-- Each account can set up one circle, and a store subscription turns on
-- only that circle. Someone who looks after two people sets up the second
-- circle from a second account, with its own subscription. Circles made
-- before this rule stay; a subscription covers the first one.

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
  if exists (select 1 from public.circles where organizer_id = v_uid) then
    raise exception 'You already manage a circle. Each circle is set up from its own account, with its own subscription.';
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

create or replace function public.apply_store_access(
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

  -- One subscription covers one circle: the first one the person set up.
  for v_circle in
    select id from public.circles where organizer_id = p_user
    order by created_at, id
    limit 1
  loop
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
