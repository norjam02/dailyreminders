-- Two additions for the app's polish pass.
--
-- 1. A welcome the subscriber makes their own. The organizer can set a photo
--    and a short message for the circle; the app shows it full screen for a
--    moment each time it opens, before the check-in or Home screen. Photos
--    live in a private bucket, in a folder named for the circle, like
--    check-in photos.
--
-- 2. A phone number to call. When a check-in is missed, Home offers a
--    "Call" button. The organizer adds the number of the person who checks
--    in to the check-in plan, so everyone active in the circle can see it,
--    and no one else.

-- ---------------------------------------------------------------------------
-- 1. Welcome photo and message
-- ---------------------------------------------------------------------------

alter table public.circles
  add column welcome_message text
    check (welcome_message is null or char_length(welcome_message) between 1 and 120),
  add column welcome_photo_path text
    check (welcome_photo_path is null or public.photo_circle(welcome_photo_path) is not distinct from id);

grant update (welcome_message, welcome_photo_path) on public.circles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'welcome-photos',
  'welcome-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do nothing;

create policy "Organizer adds welcome photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'welcome-photos'
    and public.is_organizer(public.photo_circle(name))
  );

create policy "Organizer removes welcome photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'welcome-photos'
    and public.is_organizer(public.photo_circle(name))
  );

create policy "Circle members see welcome photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'welcome-photos'
    and public.is_active_member(public.photo_circle(name))
  );

-- ---------------------------------------------------------------------------
-- 2. Number to call when a check-in is missed
-- ---------------------------------------------------------------------------

-- Digits with the usual separators, optionally starting with +. The app
-- passes it to the phone's dialer as is.
alter table public.checkin_plans
  add column call_phone text
    check (call_phone is null or call_phone ~ '^\+?[0-9][0-9 ().-]{6,22}$');

grant insert (call_phone) on public.checkin_plans to authenticated;
grant update (call_phone) on public.checkin_plans to authenticated;
