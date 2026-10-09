-- DailyPulse: App Store and Google Play subscriptions.
--
-- The organizer subscribes in the app through their Apple or Google
-- account. RevenueCat tracks the subscription. Our server functions
-- (supabase/functions) ask RevenueCat for the organizer's current state and
-- call apply_store_access, which turns on, extends, or ends every circle that
-- organizer set up.
--
-- A store result never cuts short a pilot code or manual grant that's still
-- running; it only takes over when it lasts longer, or when the circle's
-- access already came from a store.

create function public.apply_store_access(
  p_user uuid,
  p_active boolean,
  p_source text,
  p_plan text,
  p_until timestamptz
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
        insert into public.circle_access (circle_id, source, plan, active_until)
        values (v_circle, p_source, p_plan, p_until)
        on conflict (circle_id) do update
          set source = excluded.source, plan = excluded.plan,
              active_until = excluded.active_until, updated_at = now();
      end if;
    elsif found and v_existing.source in ('apple', 'google') then
      -- The subscription ended (expired, refunded, or never renewed).
      update public.circle_access
      set active_until = least(coalesce(active_until, now()), now()), updated_at = now()
      where circle_id = v_circle;
    end if;
  end loop;
end;
$$;

-- Only the server functions (service role) may call this.
revoke execute on function public.apply_store_access(uuid, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_store_access(uuid, boolean, text, text, timestamptz) to service_role;
