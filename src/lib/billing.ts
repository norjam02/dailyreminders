// Subscriptions. One subscription, paid by the organizer, turns on the whole
// circle. The database decides what a paid circle can do (circle_access).
//
// The store purchase isn't connected yet. When it is, startPurchase opens the
// App Store or Google Play sheet (through RevenueCat) or a Stripe checkout,
// and the store's webhook writes circle_access on the server. Until then,
// pilot circles are turned on with a pilot code.

export type PlanId = "yearly" | "monthly";

export const PLANS: { id: PlanId; label: string; price: string; description: string }[] = [
  { id: "yearly", label: "Yearly", price: "$49 a year", description: "About $4.08 a month. Save 18%." },
  { id: "monthly", label: "Monthly", price: "$4.99 a month", description: "Cancel anytime." },
];

export type PurchaseResult = { ok: true } | { ok: false; message: string };

export async function startPurchase(_plan: PlanId, _circleId: string): Promise<PurchaseResult> {
  return {
    ok: false,
    message: "Subscriptions open soon. If you're in the pilot, enter your pilot code below.",
  };
}
