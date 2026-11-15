// How many days in a row someone has checked in, counted in their time zone.
// Today counts once it's done; until then the streak runs to yesterday, so a
// streak doesn't look broken first thing in the morning.

import type { Checkin } from "./types";

const DAY = 86_400_000;

export function streakDays(checkins: Pick<Checkin, "status" | "scheduled_for">[], zone: string, now = Date.now()): number {
  const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone });
  const done = new Set(checkins.filter((c) => c.status === "done").map((c) => key.format(new Date(c.scheduled_for))));
  const start = done.has(key.format(new Date(now))) ? 0 : 1;
  let days = 0;
  while (done.has(key.format(new Date(now - (start + days) * DAY)))) days += 1;
  return days;
}

export function sameDay(iso: string, zone: string, now = Date.now()): boolean {
  const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone });
  return key.format(new Date(iso)) === key.format(new Date(now));
}
