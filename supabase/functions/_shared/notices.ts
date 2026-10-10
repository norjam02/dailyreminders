// What goes in a subscription notice email, and when one is due. No network
// or database access here, so it can be tested on its own.

export type Store = "apple" | "google";
export type Billing = "monthly" | "yearly";

export type Plan = { size: "standard" | "plus"; billing: Billing };

// US list prices, as in the Terms. The store charges the local equivalent.
export const LIST_PRICES: Record<string, string> = {
  "standard:monthly": "$4.99 a month",
  "standard:yearly": "$49 a year",
  "plus:monthly": "$9.99 a month",
  "plus:yearly": "$99 a year",
};

export function planFrom(maxMembers: number, billing: string | null): Plan {
  return { size: maxMembers > 4 ? "plus" : "standard", billing: billing === "yearly" ? "yearly" : "monthly" };
}

export function planName(plan: Plan): string {
  return plan.size === "plus" ? "DailyPulse Plus (up to 10 people)" : "DailyPulse Standard (up to 4 people)";
}

export const MANAGE_URLS: Record<Store, string> = {
  apple: "https://apps.apple.com/account/subscriptions",
  google: "https://play.google.com/store/account/subscriptions",
};

const CANCEL_STEPS: Record<Store, string> = {
  apple: "On your iPhone, open Settings, tap your name, then Subscriptions, then DailyPulse.",
  google: "On your Android phone, open Google Play, tap your profile picture, then Payments and subscriptions, then Subscriptions, then DailyPulse.",
};

const STORE_NAMES: Record<Store, string> = { apple: "the App Store", google: "Google Play" };

// The subscription as RevenueCat reports it, reduced to what we need.
export type StoreState = {
  willRenew: boolean;
  expiresAt: number | null; // ms
  firstPurchasedAt: number | null; // ms
  price: string | null; // e.g. "$49.00", when RevenueCat reports it
};

const DAY = 24 * 60 * 60 * 1000;

// Is the once-a-year notice due today? Yearly plans hear 7 to 30 days before
// they renew. Monthly plans hear once they've been paying about a year; the
// database then holds the next one back for 330 days.
export function annualNoticeDue(billing: Billing, state: StoreState, now: number): boolean {
  if (!state.willRenew || state.expiresAt === null || state.expiresAt <= now) return false;
  if (billing === "yearly") {
    const daysLeft = (state.expiresAt - now) / DAY;
    return daysLeft >= 7 && daysLeft <= 30;
  }
  return state.firstPurchasedAt !== null && now - state.firstPurchasedAt >= 335 * DAY;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export type Email = { subject: string; text: string; html: string };

function priceLine(plan: Plan, price: string | null): string {
  const list = LIST_PRICES[`${plan.size}:${plan.billing}`];
  if (!price) return `${list} (US price; your store charges the equivalent in your currency, plus any tax)`;
  return `${price} a ${plan.billing === "yearly" ? "year" : "month"}, plus any tax your store adds`;
}

function render(paragraphs: string[]): Email["html"] {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = (s: string) => esc(s).replace(/(https:\/\/[^\s)]+?)([.,]?(?:\s|$))/g, '<a href="$1">$1</a>$2');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1A1A2E;max-width:560px">${paragraphs
    .map((p) => `<p>${linked(p).replace(/\n/g, "<br>")}</p>`)
    .join("")}</body></html>`;
}

const SIGNOFF = "Questions? Reply to this email or write to support@condorllc.org.\n\nDailyPulse, from Condor LLC\n202 N Cedar Ave, Suite 1, Owatonna, MN 55060";

export function annualNotice(args: {
  circleName: string;
  plan: Plan;
  store: Store;
  state: StoreState;
}): Email {
  const { circleName, plan, store, state } = args;
  const renews = state.expiresAt ? formatDate(state.expiresAt) : null;
  const paragraphs = [
    "Hi,",
    `This is your yearly reminder about the DailyPulse subscription for ${circleName}'s circle.`,
    [
      `Plan: ${planName(plan)}`,
      `You pay: ${priceLine(plan, state.price)}`,
      `How often: every ${plan.billing === "yearly" ? "year" : "month"}, through ${STORE_NAMES[store]}`,
      renews ? `Next renewal: ${renews}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "Nothing changes unless you want it to. Your subscription keeps renewing until you cancel.",
    `To cancel, do it at least 24 hours before it renews. ${CANCEL_STEPS[store]} Or go to ${MANAGE_URLS[store]}. Deleting the app doesn't cancel it.`,
    SIGNOFF,
  ];
  return {
    subject: "Your DailyPulse subscription: yearly reminder",
    text: paragraphs.join("\n\n"),
    html: render(paragraphs),
  };
}

export function priceChangeNotice(args: {
  circleName: string;
  plan: Plan;
  store: Store;
  oldPrice: string;
  newPrice: string;
  effective: string; // a date people can read, e.g. "March 1, 2027"
}): Email {
  const { circleName, plan, store, oldPrice, newPrice, effective } = args;
  const period = plan.billing === "yearly" ? "year" : "month";
  const paragraphs = [
    "Hi,",
    `The price of ${planName(plan)} is changing, and it's the plan you have for ${circleName}'s circle.`,
    [`Now: ${oldPrice} a ${period}`, `From your first renewal on or after ${effective}: ${newPrice} a ${period}`].join("\n"),
    `${STORE_NAMES[store] === "the App Store" ? "Apple" : "Google"} may also ask you to agree to the new price. If you don't, your subscription will end at the end of the period you've paid for.`,
    `If you'd rather cancel, do it at least 24 hours before your next renewal. ${CANCEL_STEPS[store]} Or go to ${MANAGE_URLS[store]}.`,
    SIGNOFF,
  ];
  return {
    subject: `DailyPulse price change from ${effective}`,
    text: paragraphs.join("\n\n"),
    html: render(paragraphs),
  };
}

// RevenueCat's v1 subscriber record, reduced to the circle subscription.
export function storeStateFrom(subscriber: unknown, entitlement: string): { product: string; state: StoreState } | null {
  // deno-lint-ignore no-explicit-any
  const s = subscriber as any;
  const ent = s?.entitlements?.[entitlement];
  if (!ent?.product_identifier) return null;
  const product: string = ent.product_identifier;
  const sub = s?.subscriptions?.[product] ?? {};
  const parse = (d: unknown) => (typeof d === "string" ? Date.parse(d) : null);
  const amount = sub?.price?.amount;
  const currency = sub?.price?.currency;
  let price: string | null = null;
  if (typeof amount === "number" && typeof currency === "string") {
    try {
      price = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      price = null;
    }
  }
  return {
    product,
    state: {
      willRenew: !sub.unsubscribe_detected_at && !sub.billing_issues_detected_at && !sub.refunded_at,
      expiresAt: parse(sub.expires_date ?? ent.expires_date),
      firstPurchasedAt: parse(sub.original_purchase_date ?? ent.purchase_date),
      price,
    },
  };
}
