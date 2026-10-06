# Daily Check-In (working name)

A gentle daily check-in between an aging parent and their family. At times the organizer sets, the parent gets a notification and answers with one tap, a photo, or a selfie, plus an optional friendly reply. If a check-in is missed, the parent is reminded first, then the family is told.

"Daily Check-In" is a placeholder. The real name is still to be chosen.

## Status

Pilot build: Expo SDK 57, TypeScript, and Expo Router. The database schema, access rules, and scheduler are in place and tested, and the app's first full set of screens is built. The screens typecheck and bundle for iOS and Android but have not yet been tried on a phone.

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

### The scheduler

A job runs every minute inside the database (pg_cron), with nothing else to deploy. Each run:

1. Creates today's and tomorrow's check-ins from each plan, in the parent's time zone. Only future times are created, so a new plan never starts with a miss.
2. Prompts the parent at check-in time.
3. Reminds the parent, depending on firmness, unless they tapped Later.
4. Marks the check-in missed when the wait runs out, and alerts the organizer.
5. If it is still missed 15 minutes later, alerts everyone else active in the circle.

When the parent checks in, the organizer hears about it, and so does anyone who was alerted about a miss, so they can stand down.

| Setting | What happens |
| --- | --- |
| Gentle | The first prompt only |
| Normal | Two reminders, 20 minutes apart |
| Persistent | A reminder every 10 minutes until the wait runs out |
| Later | Pauses reminders for 30 minutes and adds 30 minutes to the wait |
| Rest of the circle | Alerted 15 minutes after the organizer |

These timings are first guesses for the pilot.

Notifications wait in an outbox table and go to Expo's push service in batches of up to 100 (pg_net), one message per registered device. Changing the plan's times or time zone replaces upcoming check-ins that have not started.

### Setting up a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the project's Auth settings, turn on anonymous sign-ins. The setting in `supabase/config.toml` only applies to a local Supabase.
3. Link this repo and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   Or run each file in `supabase/migrations/` in order in the dashboard's SQL Editor.

4. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key. `.env.local` is ignored by git.

### Still to build

- Checking Expo's delivery receipts and removing tokens for uninstalled apps.
- The "Something's not right" button, after its wording is tested.

## The app

| Screen | Who | What it does |
| --- | --- | --- |
| Welcome | Everyone | Set up check-ins, or join with a code |
| Sign in | Organizer | Email address, then the six-digit code from the email |
| Set up a circle | Organizer | Who the check-ins are for, your name, and whether you're their child or caregiver |
| Check-in settings | Organizer | Mode, photo prompt, up to three times, time zone, reminders, wait, quick replies, a personal note |
| Invite someone | Organizer | Makes a join code and shares it |
| Join with a code | Anyone | Name and code; signs in anonymously if needed |
| Almost there | New members | Waits for approval and updates on its own |
| Check-in | Parent | One big button, photo, or selfie; quick replies; Later; "In an emergency, call 911" |
| Home | Organizer and family | Recent check-ins with photos and replies, what's next, people waiting to join |
| People | Everyone | The circle's members; the organizer approves and removes, others can leave |

Design: Atkinson Hyperlegible (made for readers with low vision), large type, 56-point touch targets, calm blue for actions, green for checked in, and amber rather than red for a missed check-in. Light mode only for the pilot.

### Supabase email setup

Organizers sign in with a code sent by email. Supabase's default emails send a link instead, so in the dashboard under **Authentication → Emails**, edit the **Magic Link** and **Confirm signup** templates to include the code, for example `Your Daily Check-In code is {{ .Token }}`.

Supabase's built-in email sender only allows a few emails an hour. Set up your own email provider (SMTP) under the same settings before the pilot.

### Trying it on a phone

1. Clone the repo, run `npm install`, and copy `.env.example` to `.env.local` with the Supabase URL and publishable key.
2. Run `npx expo start` and open it in the Expo Go app. Everything works there except push notifications.
3. For push notifications, the app needs its own build:

   ```bash
   npx eas-cli@latest init                                   # links an Expo project; sets the push project ID
   npx eas-cli@latest build --profile development --platform ios
   ```

   An iPhone build needs an Apple Developer account. Pick the app's bundle identifier carefully the first time; it can't change after release.

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

`AGENTS.md` holds working notes for coding agents, including Expo-specific rules. `.claude/agents/` holds five reviewer agents (code, security, accessibility, mobile, and pilot readiness), and `docs/` holds their reviews.
