-- DailyPulse: explicit grants for the server functions.
--
-- From October 30, 2026, Supabase stops granting Data API access to new
-- tables in "public" by default. Existing tables keep their grants, but a
-- rebuilt database (a new project, a preview branch, or a local reset) would
-- not. The app's tables already have explicit grants; this covers the one
-- table a server function reads directly through the Data API.

grant select on public.circles to service_role;
