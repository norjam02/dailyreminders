# Daily Check-In (working name)

A gentle daily check-in between an aging parent and their family. At times the organizer sets, the parent gets a notification and answers with one tap, a photo, or a selfie, plus an optional friendly reply. If a check-in is missed, the parent is reminded first, then the family is told.

"Daily Check-In" is a placeholder. The real name is still to be chosen.

## Status

Pilot build: Expo SDK 57, TypeScript, and Expo Router, with a single placeholder screen. The database schema and access rules are in place and tested. The scheduler and the app screens are not built yet.

The full concept test plan lives in a private doc: [Daily Check-In: Concept Test Plan](https://claude.ai/code/artifact/e9e11eff-a810-4d72-86e7-1294340414ac).

## The pilot

Ten parent and child pairs use this app for 14 days, starting Monday, November 16, 2026. It ships as a test build (TestFlight on iPhone, internal testing on Android), not through the app stores. The pilot is app only: every person installs the app, and all check-ins and alerts are app notifications.

### In scope

- **Roles.** Child, Parent, Caregiver, and Other family, chosen on first launch.
- **Organizer.** The subscriber who sets up the circle and manages it. The organizer joins as the parent's child or as a caregiver, for example a paid caregiver or a friend looking after someone who is not their own parent.
- **Circles and join codes.** The organizer creates a circle and gets a short code for each person. Each code works once and expires after a day, and the organizer approves every new member.
- **Check-in modes.** Button, photo, or selfie. The organizer picks the mode for each parent and can change it at any time. A parent who cannot manage a photo that day can tap a plain button instead, marked "button only."
- **Photo prompts.** For photo mode: breakfast, the view from a window, the coffee cup, or anything.
- **Schedule.** One to three check-ins a day, at times the organizer picks.
- **Reminder firmness.** Gentle (one reminder), normal (a reminder, then two more over the next hour), or persistent (keeps reminding until answered, up to the wait time).
- **Quick replies.** The organizer picks up to four for the parent to see, from a starter set: "Love you!", "I'm on it", "Thanks for checking", "Doing fine." Optional on any check-in.
- **Later.** A one-time button that pushes a reminder back without counting as a miss.
- **Missed check-ins.** After the wait the organizer chose (30 minutes, 1 hour, or 2 hours), the organizer is alerted, then the rest of the circle.
- **Family feed.** The circle sees check-ins, quick replies, and photos as they arrive.
- **Safety notice.** Every check-in screen shows "In an emergency, call 911."

### Defaults

| Setting | Default |
| --- | --- |
| Check-ins per day | One, at 10:00 in the parent's time zone |
| Later | Pushes reminders back 30 minutes, once per check-in |
| Reminder firmness | Normal |
| Wait before alerting family | 1 hour |
| Personal note from the organizer | Off |

These are starting guesses to test, not findings.

### Out of scope for the pilot

- Texting, SMS, and RCS. App notifications only.
- The "Something's not right" button. Its wording is tested on a clickable prototype, not in the pilot, because no one can watch for it around the clock.
- In-app payments. The day-14 payment link is sent separately.
- Medications or any health data.
- Chat, calling, or location tracking.

### Ground rules

- The app is not an emergency or medical service, and says so plainly.
- Photos and selfies are used only for the pilot and deleted at the end.
- Either person can stop at any time.

## Backend

The backend is [Supabase](https://supabase.com): Postgres, sign-in, and photo storage. Push notifications will go through Expo's push service.

### Data model

- **profiles**: a display name for each signed-in person.
- **circles**: one parent and the family and caregivers around them, with the organizer who set it up.
- **circle_members**: each person's role (child, parent, caregiver, family) and status (pending, active, removed). One parent per circle.
- **invites**: one-time join codes, six characters without look-alikes, expiring after a day.
- **checkin_plans**: the organizer's settings for the circle: mode, photo prompt, times, time zone, firmness, wait, quick replies, and a personal note.
- **checkins**: one row per scheduled check-in, with the parent's answer.
- **push_tokens**: each device's notification token.
- **checkin-photos**: a private storage bucket, with files at `<circle_id>/<file>`.

### Who can do what

Access rules live in the database, so the app cannot get around them.

- The organizer, a child or a caregiver, creates the circle, makes join codes, approves or removes people, and edits the plan. Other members, including other children and caregivers, cannot.
- Anyone signs in and joins with a code, then waits as pending until the organizer approves them. Parents can sign in anonymously, with no email or password; organizers need a real account, since they own the subscription.
- Active members see the circle, its members, the plan, check-ins, and photos. Pending members see only the circle's name.
- Only the parent answers check-ins and uploads photos, and only into their own circle.
- Check-ins are created and escalated by the scheduler, which runs with the service role. The app cannot write them directly.

The schema is in `supabase/migrations/`. The functions the app calls are `create_circle`, `create_invite`, `redeem_invite`, `approve_member`, `remove_member`, `respond_checkin`, and `snooze_checkin`.

### Setting up a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the project's Auth settings, turn on anonymous sign-ins. The setting in `supabase/config.toml` only applies to a local Supabase.
3. Link this repo and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

4. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key. `.env.local` is ignored by git.

### Still to build

- The scheduler: creates each day's check-ins, sends reminders, marks misses, and alerts the family through Expo push.
- The app screens: role choice, joining, the parent's check-in screen, the organizer's setup, and the family feed.

## Open decisions

- **Final name**, with a trademark, domain, and App Store check.

## Running it

```bash
npm install
npx expo start      # dev server
npm run typecheck   # TypeScript check
npm run test:db     # schema and access-rule tests, in an in-memory Postgres
```

The database tests need no Docker and no Supabase project. They run the migrations against small stand-ins for Supabase's auth and storage, in `supabase/tests/`.

Remote push notifications need a development build (`npx eas-cli@latest build --profile development`), not Expo Go.

`AGENTS.md` holds working notes for coding agents, including Expo-specific rules.
