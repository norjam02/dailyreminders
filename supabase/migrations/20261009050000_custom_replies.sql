-- DailyPulse: organizers can write their own quick replies, up to 50
-- characters each (still at most 4 per circle).

create function public.quick_replies_ok(p_replies text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(btrim(r)) between 1 and 50), true)
  from unnest(p_replies) as r;
$$;

alter table public.checkin_plans
  add constraint quick_replies_length check (public.quick_replies_ok(quick_replies));
