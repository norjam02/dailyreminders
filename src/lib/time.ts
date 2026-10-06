// Times are stored in the parent's time zone. These helpers format them for
// display and list the choices the organizer picks from.

import { getCalendars } from "expo-localization";

export const US_TIME_ZONES = [
  { label: "Eastern", zone: "America/New_York" },
  { label: "Central", zone: "America/Chicago" },
  { label: "Mountain", zone: "America/Denver" },
  { label: "Arizona", zone: "America/Phoenix" },
  { label: "Pacific", zone: "America/Los_Angeles" },
  { label: "Alaska", zone: "America/Anchorage" },
  { label: "Hawaii", zone: "Pacific/Honolulu" },
];

export function deviceTimeZone(): string {
  return getCalendars()[0]?.timeZone ?? "America/Chicago";
}

export function timeZoneLabel(zone: string): string {
  return US_TIME_ZONES.find((z) => z.zone === zone)?.label ?? zone.replace(/_/g, " ");
}

// Check-in times offered: every hour from 7 AM to 9 PM, as "HH:00".
export const HOUR_CHOICES = Array.from({ length: 15 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`);

// "10:00" or "10:00:00" -> "10 AM"
export function hourLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}:${String(m).padStart(2, "0")} ${suffix}` : `${hour12} ${suffix}`;
}

// A timestamp shown in the parent's time zone, e.g. "10:04 AM".
export function clockTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso));
}

// "Today", "Yesterday", or "Mon, Nov 16", in the parent's time zone.
export function dayLabel(iso: string, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone });
  const day = fmt.format(new Date(iso));
  const today = fmt.format(new Date());
  const yesterday = fmt.format(new Date(Date.now() - 86_400_000));
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(
    new Date(iso),
  );
}
