-- DailyPulse pilot codes, November 16-29, 2026.
--
-- Run once in the Supabase SQL Editor, close to the start of the pilot (each
-- code can be used for 90 days after it's made). Makes one code per pilot
-- circle: one use each, room for up to 10 people, and 45 days of access from
-- the day the organizer enters it. 45 days covers setting up the week before,
-- the two pilot weeks, and time to decide about subscribing afterwards.
--
-- Give each organizer their own code. They enter it on the Subscribe screen
-- under "Have a pilot code?".

select n as circle, public.new_pilot_code(45, 1, 10, 'Pilot circle ' || n) as code
from generate_series(1, 10) as n;

-- Two spares, for a replacement or a late addition.
select public.new_pilot_code(45, 1, 10, 'Pilot spare ' || n) as code
from generate_series(1, 2) as n;

-- Later: which codes have been used, and which circles are on a pilot code.
--
-- select code, note, uses_left, expires_at from public.access_codes
-- where note like 'Pilot %' order by note;
--
-- select c.name, a.active_until, a.max_members
-- from public.circle_access a join public.circles c on c.id = a.circle_id
-- where a.source = 'pilot_code' order by a.active_until;
