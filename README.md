# Daily Check-In (working name)

A gentle daily check-in between an aging parent and their family. At times the adult child sets, the parent gets a notification and answers with one tap, a photo, or a selfie, plus an optional friendly reply. If a check-in is missed, the parent is reminded first, then the family is told.

"Daily Check-In" is a placeholder. The real name is still to be chosen.

## Status

Pilot build, just scaffolded: Expo SDK 57, TypeScript, and Expo Router, with a single placeholder screen. Nothing below is built yet.

The full concept test plan lives in a private doc: [Daily Check-In: Concept Test Plan](https://claude.ai/code/artifact/e9e11eff-a810-4d72-86e7-1294340414ac).

## The pilot

Ten parent and child pairs use this app for 14 days, starting Monday, November 16, 2026. It ships as a test build (TestFlight on iPhone, internal testing on Android), not through the app stores. The pilot is app only: every person installs the app, and all check-ins and alerts are app notifications.

### In scope

- **Roles.** Child, Parent, Caregiver, and Other family, chosen on first launch.
- **Circles and join codes.** The child creates a circle and gets a short code for each person. Each code works once and expires after a day, and the child approves every new member.
- **Check-in modes.** Button, photo, or selfie. The child picks the mode for each parent and can change it at any time. A parent who cannot manage a photo that day can tap a plain button instead, marked "button only."
- **Photo prompts.** For photo mode: breakfast, the view from a window, the coffee cup, or anything.
- **Schedule.** One to three check-ins a day, at times the child picks.
- **Reminder firmness.** Gentle (one reminder), normal (a reminder, then two more over the next hour), or persistent (keeps reminding until answered, up to the wait time).
- **Quick replies.** The child picks up to four for the parent to see, from a starter set: "Love you!", "I'm on it", "Thanks for checking", "Doing fine." Optional on any check-in.
- **Later.** A one-time button that pushes a reminder back without counting as a miss.
- **Missed check-ins.** After the wait the child chose (30 minutes, 1 hour, or 2 hours), the child is alerted, then caregivers and other family.
- **Family feed.** The circle sees check-ins, quick replies, and photos as they arrive.
- **Safety notice.** Every check-in screen shows "In an emergency, call 911."

### Defaults

| Setting | Default |
| --- | --- |
| Check-ins per day | One, mid-morning |
| Reminder firmness | Normal |
| Wait before alerting family | 1 hour |
| Personal note from the child | Off |

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

## Open decisions

- **Backend** for accounts, circles, push notifications, and photo storage. Not yet chosen.
- **Final name**, with a trademark, domain, and App Store check.

## Running it

```bash
npm install
npx expo start      # dev server
npm run typecheck   # TypeScript check
```

Remote push notifications need a development build (`npx eas-cli@latest build --profile development`), not Expo Go.

`AGENTS.md` holds working notes for coding agents, including Expo-specific rules.
