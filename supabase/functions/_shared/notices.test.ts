// deno test --node-modules-dir=none supabase/functions/_shared/notices.test.ts
import assertNode from "node:assert/strict";

const assert: (v: unknown) => asserts v = (v) => assertNode.ok(v);
const assertEquals = (a: unknown, b: unknown) => assertNode.deepEqual(a, b);
const assertStringIncludes = (s: string, part: string) => assertNode.ok(s.includes(part), `missing: ${part}\n${s}`);

import { annualNotice, annualNoticeDue, planFrom, priceChangeNotice, storeStateFrom } from "./notices.ts";

const DAY = 86_400_000;
const now = Date.parse("2027-06-01T15:00:00Z");
const renewing = (expiresInDays: number, boughtDaysAgo = 400) => ({
  willRenew: true,
  expiresAt: now + expiresInDays * DAY,
  firstPurchasedAt: now - boughtDaysAgo * DAY,
  price: null,
});

Deno.test("yearly plans hear 7 to 30 days before renewal", () => {
  assertEquals(annualNoticeDue("yearly", renewing(31), now), false);
  assertEquals(annualNoticeDue("yearly", renewing(30), now), true);
  assertEquals(annualNoticeDue("yearly", renewing(7), now), true);
  assertEquals(annualNoticeDue("yearly", renewing(6), now), false);
});

Deno.test("monthly plans hear after about a year of paying", () => {
  assertEquals(annualNoticeDue("monthly", renewing(20, 300), now), false);
  assertEquals(annualNoticeDue("monthly", renewing(20, 340), now), true);
});

Deno.test("nobody hears if their subscription won't renew", () => {
  assertEquals(annualNoticeDue("yearly", { ...renewing(14), willRenew: false }, now), false);
  assertEquals(annualNoticeDue("monthly", { ...renewing(-1), willRenew: true }, now), false);
});

Deno.test("plan comes from the circle size and billing", () => {
  assertEquals(planFrom(10, "yearly"), { size: "plus", billing: "yearly" });
  assertEquals(planFrom(4, null), { size: "standard", billing: "monthly" });
});

Deno.test("the yearly email says what they pay, how often, and how to cancel", () => {
  const email = annualNotice({ circleName: "Mom", plan: planFrom(4, "yearly"), store: "apple", state: renewing(14) });
  assertStringIncludes(email.text, "$49 a year");
  assertStringIncludes(email.text, "every year, through the App Store");
  assertStringIncludes(email.text, "https://apps.apple.com/account/subscriptions");
  assertStringIncludes(email.text, "at least 24 hours");
  assertStringIncludes(email.text, "June 15, 2027");
  assert(email.html.includes('<a href="https://apps.apple.com/account/subscriptions">'));
});

Deno.test("the store's own price is used when RevenueCat reports it", () => {
  const found = storeStateFrom(
    {
      entitlements: { circle: { product_identifier: "dailypulse_plus_monthly", expires_date: "2027-06-20T00:00:00Z" } },
      subscriptions: {
        dailypulse_plus_monthly: {
          expires_date: "2027-06-20T00:00:00Z",
          original_purchase_date: "2026-06-20T00:00:00Z",
          price: { amount: 9.99, currency: "USD" },
          unsubscribe_detected_at: null,
        },
      },
    },
    "circle",
  );
  assert(found);
  assertEquals(found.state.price, "$9.99");
  assertEquals(found.state.willRenew, true);
  const email = annualNotice({ circleName: "Dad", plan: planFrom(10, "monthly"), store: "google", state: found.state });
  assertStringIncludes(email.text, "$9.99 a month");
  assertStringIncludes(email.text, "Google Play");
});

Deno.test("a cancelled subscription doesn't renew", () => {
  const found = storeStateFrom(
    {
      entitlements: { circle: { product_identifier: "dailypulse_yearly" } },
      subscriptions: { dailypulse_yearly: { unsubscribe_detected_at: "2027-05-01T00:00:00Z" } },
    },
    "circle",
  );
  assertEquals(found?.state.willRenew, false);
});

Deno.test("the price change email gives both prices and the date", () => {
  const email = priceChangeNotice({
    circleName: "Mom",
    plan: planFrom(4, "yearly"),
    store: "google",
    oldPrice: "$49",
    newPrice: "$59",
    effective: "March 1, 2027",
  });
  assertStringIncludes(email.text, "Now: $49 a year");
  assertStringIncludes(email.text, "March 1, 2027: $59 a year");
  assertStringIncludes(email.text, "Google may also ask you");
});
