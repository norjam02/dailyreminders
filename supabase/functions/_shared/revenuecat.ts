// Shared by the store webhook and the in-app sync: asks RevenueCat whether a
// person's "circle" subscription is active, and turns their circles on or off
// to match. Always reads the current state from RevenueCat rather than
// trusting a single event, so repeated or out-of-order events are harmless.

import { admin } from "./admin.ts";

export const ENTITLEMENT = "circle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only our own user ids (Supabase UUIDs); skips RevenueCat's anonymous ids.
export function isOurUserId(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

type Entitlement = {
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  product_identifier: string;
};

type Subscription = { store?: string };

export async function syncUser(userId: string): Promise<boolean> {
  const secret = Deno.env.get("REVENUECAT_SECRET_KEY");
  if (!secret) throw new Error("REVENUECAT_SECRET_KEY is not set.");

  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`RevenueCat answered ${res.status}`);
  const { subscriber } = await res.json();

  const ent: Entitlement | undefined = subscriber?.entitlements?.[ENTITLEMENT];
  const ends = [ent?.expires_date, ent?.grace_period_expires_date]
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d));
  // A null expiry would mean a lifetime purchase; we don't sell those.
  const until = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
  const active = !!ent && (until === null || Date.parse(until) > Date.now());

  const product = ent?.product_identifier ?? "";
  const sub: Subscription | undefined = subscriber?.subscriptions?.[product];
  const source = sub?.store === "play_store" ? "google" : "apple";
  const plan = /year|annual/i.test(product) ? "yearly" : "monthly";
  // Plus products (dailypulse_plus_monthly, dailypulse_plus_yearly) allow up
  // to 10 people; standard ones up to 4.
  const maxMembers = /plus/i.test(product) ? 10 : 4;

  const { error } = await admin.rpc("apply_store_access", {
    p_user: userId,
    p_active: active,
    p_source: active ? source : null,
    p_plan: active ? plan : null,
    p_until: active ? until : null,
    p_max_members: maxMembers,
  });
  if (error) throw error;
  return active;
}
