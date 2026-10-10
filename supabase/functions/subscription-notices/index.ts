// Sends the subscription emails the Terms promise organizers:
//   - once a year: what they pay, how often, and how to cancel
//   - 7 to 30 days before a price change
//
// Runs once a day from pg_cron for the yearly reminders (see the
// 20261010010000_subscription_notices migration). Price-change notices are
// sent by hand, once the new price is set in App Store Connect and Google Play:
//
//   curl -X POST https://<project-ref>.supabase.co/functions/v1/subscription-notices \
//     -H "x-notices-secret: $NOTICES_SECRET" -H "Content-Type: application/json" \
//     -d '{"kind":"price_change","size":"standard","billing":"yearly",
//          "oldPrice":"$49","newPrice":"$59","effective":"2027-03-01","dryRun":true}'
//
// Every call is a dry run unless it says "dryRun": false (the daily job sends
// for real). A dry run lists who would get an email and what it would say.
//
// Deploy:  npx supabase functions deploy subscription-notices --no-verify-jwt
// Secrets: NOTICES_SECRET, REVENUECAT_SECRET_KEY, SMTP_USER, SMTP_PASS,
//          MAIL_FROM (optional; defaults to SMTP_USER)

import nodemailer from "npm:nodemailer@6";

import { admin } from "../_shared/admin.ts";
import {
  annualNotice,
  annualNoticeDue,
  type Email,
  formatDate,
  planFrom,
  priceChangeNotice,
  type Store,
  storeStateFrom,
} from "../_shared/notices.ts";
import { ENTITLEMENT } from "../_shared/revenuecat.ts";

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

type Circle = {
  circle_id: string;
  organizer_id: string;
  source: Store;
  plan: string | null;
  max_members: number;
};

async function subscriber(userId: string): Promise<unknown> {
  const key = Deno.env.get("REVENUECAT_SECRET_KEY");
  if (!key) throw new Error("REVENUECAT_SECRET_KEY is not set.");
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`RevenueCat answered ${res.status}`);
  return (await res.json()).subscriber;
}

function mailer() {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) throw new Error("SMTP_USER and SMTP_PASS must be set.");
  // Port 465 (TLS from the start); Supabase blocks 25 and 587.
  return nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
    port: Number(Deno.env.get("SMTP_PORT") ?? 465),
    secure: true,
    auth: { user, pass },
  });
}

async function organizerEmail(userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

async function circleName(circleId: string): Promise<string> {
  // The circle is named after the person who checks in.
  const { data } = await admin.from("circles").select("name").eq("id", circleId).single();
  return data?.name ?? "your";
}

type Planned = { circleId: string; organizerId: string; to: string; noticeKey: string; email: Email };

async function planAnnual(circles: Circle[], now: number): Promise<{ planned: Planned[]; skipped: string[] }> {
  const planned: Planned[] = [];
  const skipped: string[] = [];
  for (const c of circles) {
    try {
      const found = storeStateFrom(await subscriber(c.organizer_id), ENTITLEMENT);
      if (!found) {
        skipped.push(`${c.circle_id}: no subscription in RevenueCat`);
        continue;
      }
      const plan = planFrom(c.max_members, c.plan);
      if (!annualNoticeDue(plan.billing, found.state, now)) continue;
      const to = await organizerEmail(c.organizer_id);
      if (!to) {
        skipped.push(`${c.circle_id}: organizer has no email`);
        continue;
      }
      const email = annualNotice({ circleName: await circleName(c.circle_id), plan, store: c.source, state: found.state });
      planned.push({ circleId: c.circle_id, organizerId: c.organizer_id, to, noticeKey: "", email });
    } catch (e) {
      skipped.push(`${c.circle_id}: ${(e as Error).message}`);
    }
  }
  return { planned, skipped };
}

type PriceChange = {
  size: "standard" | "plus";
  billing: "monthly" | "yearly";
  oldPrice: string;
  newPrice: string;
  effective: string; // YYYY-MM-DD
};

function readPriceChange(body: Record<string, unknown>): PriceChange | string {
  const { size, billing, oldPrice, newPrice, effective } = body;
  if (size !== "standard" && size !== "plus") return 'size must be "standard" or "plus"';
  if (billing !== "monthly" && billing !== "yearly") return 'billing must be "monthly" or "yearly"';
  if (typeof oldPrice !== "string" || typeof newPrice !== "string") return "oldPrice and newPrice are required";
  if (typeof effective !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) return "effective must be YYYY-MM-DD";
  const days = (Date.parse(`${effective}T00:00:00Z`) - Date.now()) / 86_400_000;
  if (days < 7 || days > 30) return "effective must be 7 to 30 days from today, as the Terms promise";
  return { size, billing, oldPrice, newPrice, effective };
}

async function planPriceChange(circles: Circle[], change: PriceChange): Promise<{ planned: Planned[]; skipped: string[] }> {
  const planned: Planned[] = [];
  const skipped: string[] = [];
  const noticeKey = `${change.size}:${change.billing}:${change.effective}`;
  const { data: already } = await admin
    .from("subscription_notices")
    .select("circle_id")
    .eq("kind", "price_change")
    .eq("notice_key", noticeKey);
  const sent = new Set((already ?? []).map((r: { circle_id: string }) => r.circle_id));
  for (const c of circles) {
    const plan = planFrom(c.max_members, c.plan);
    if (plan.size !== change.size || plan.billing !== change.billing || sent.has(c.circle_id)) continue;
    const to = await organizerEmail(c.organizer_id);
    if (!to) {
      skipped.push(`${c.circle_id}: organizer has no email`);
      continue;
    }
    const email = priceChangeNotice({
      circleName: await circleName(c.circle_id),
      plan,
      store: c.source,
      oldPrice: change.oldPrice,
      newPrice: change.newPrice,
      effective: formatDate(Date.parse(`${change.effective}T00:00:00Z`)),
    });
    planned.push({ circleId: c.circle_id, organizerId: c.organizer_id, to, noticeKey, email });
  }
  return { planned, skipped };
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("NOTICES_SECRET");
  if (!expected || !sameSecret(req.headers.get("x-notices-secret") ?? "", expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind === "price_change" ? "price_change" : "annual";
  // Only an explicit "dryRun": false sends (the daily job passes it).
  const dryRun = body.dryRun !== false;

  const { data: circles, error } = await admin.rpc("store_subscribed_circles", { p_kind: kind });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let result: { planned: Planned[]; skipped: string[] };
  if (kind === "annual") {
    result = await planAnnual(circles as Circle[], Date.now());
  } else {
    const change = readPriceChange(body);
    if (typeof change === "string") return Response.json({ error: change }, { status: 400 });
    result = await planPriceChange(circles as Circle[], change);
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      wouldSend: result.planned.map((p) => ({ to: p.to, subject: p.email.subject, text: p.email.text })),
      skipped: result.skipped,
    });
  }

  const transport = mailer();
  const from = Deno.env.get("MAIL_FROM") ?? `DailyPulse <${Deno.env.get("SMTP_USER")}>`;
  let sent = 0;
  const failed: string[] = [];
  for (const p of result.planned) {
    // Record first, so a crash mid-send can't lead to a second copy later.
    const { error: insertError } = await admin.from("subscription_notices").insert({
      circle_id: p.circleId,
      user_id: p.organizerId,
      kind,
      notice_key: p.noticeKey,
    });
    if (insertError) {
      failed.push(`${p.circleId}: ${insertError.message}`);
      continue;
    }
    try {
      await transport.sendMail({
        from,
        replyTo: "support@condorllc.org",
        to: p.to,
        subject: p.email.subject,
        text: p.email.text,
        html: p.email.html,
      });
      sent += 1;
    } catch (e) {
      failed.push(`${p.circleId}: ${(e as Error).message}`);
      // Let the next run try again.
      await admin
        .from("subscription_notices")
        .delete()
        .eq("circle_id", p.circleId)
        .eq("kind", kind)
        .eq("notice_key", p.noticeKey);
    }
  }
  console.log(JSON.stringify({ kind, sent, failed, skipped: result.skipped }));
  return Response.json({ sent, failed, skipped: result.skipped });
});
