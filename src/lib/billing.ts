// Subscriptions through the App Store and Google Play, via RevenueCat.
//
// One subscription, paid by the organizer, turns on every circle they set
// up. The store charges the person's Apple or Google account; RevenueCat
// tracks the subscription; our server (supabase/functions) asks RevenueCat
// who has paid and writes circle_access. The app never marks a circle as
// paid itself.
//
// RevenueCat setup this code expects:
//   - Entitlement "circle", with all four products attached
//   - Standard (up to 4 people): dailypulse_monthly ($4.99), dailypulse_yearly ($49)
//   - Plus (up to 10 people): dailypulse_plus_monthly ($9.99), dailypulse_plus_yearly ($99)
//   - All four in one subscription group (Apple) so moving between them is an
//     upgrade or downgrade, not a second subscription
//   - The current offering holds the standard Monthly and Annual packages; an
//     offering named "plus" holds the Plus ones
//
// In Expo Go, RevenueCat runs in a preview mode with no real purchases. Real
// purchases need a development or store build.

import { Linking, Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";

import { supabase } from "./supabase";

export type Size = "standard" | "plus";
export type Billing = "yearly" | "monthly";

export const SIZES: { id: Size; label: string; people: number }[] = [
  { id: "standard", label: "Up to 4 people", people: 4 },
  { id: "plus", label: "Up to 10 people", people: 10 },
];

export type Price = { size: Size; billing: Billing; price: string; description: string };

// Shown until the store's own prices load (they're localized and may differ).
export const DEFAULT_PRICES: Price[] = [
  { size: "standard", billing: "yearly", price: "$49 a year", description: "About $4.08 a month. Save 18%." },
  { size: "standard", billing: "monthly", price: "$4.99 a month", description: "Cancel anytime." },
  { size: "plus", billing: "yearly", price: "$99 a year", description: "About $8.25 a month. Save 17%." },
  { size: "plus", billing: "monthly", price: "$9.99 a month", description: "Cancel anytime." },
];

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY,
});

export const STORE_NAME = Platform.OS === "ios" ? "App Store" : "Google Play";

let configuredFor: string | null = null;

// Ties purchases to the signed-in organizer, so a subscription follows their
// account to a new phone.
function ensureConfigured(userId: string): boolean {
  if (!API_KEY) return false;
  if (configuredFor === userId) return true;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: API_KEY, appUserID: userId });
  } else {
    Purchases.logIn(userId).catch(() => {});
  }
  configuredFor = userId;
  return true;
}

async function findPackage(size: Size, billing: Billing): Promise<PurchasesPackage | undefined> {
  const offerings = await Purchases.getOfferings();
  const offering = size === "plus" ? offerings.all.plus : offerings.current;
  return (billing === "yearly" ? offering?.annual : offering?.monthly) ?? undefined;
}

// The prices from the store, when it's reachable.
export async function loadPrices(userId: string): Promise<Price[]> {
  if (!ensureConfigured(userId)) return DEFAULT_PRICES;
  try {
    return await Promise.all(
      DEFAULT_PRICES.map(async (p) => {
        const product = (await findPackage(p.size, p.billing))?.product;
        if (!product) return p;
        return { ...p, price: `${product.priceString} a ${p.billing === "yearly" ? "year" : "month"}` };
      }),
    );
  } catch {
    return DEFAULT_PRICES;
  }
}

// The product the organizer pays for now, if any (for upgrades on Android).
async function currentProduct(): Promise<string | null> {
  const info = await Purchases.getCustomerInfo().catch(() => null);
  return info?.entitlements.active.circle?.productIdentifier ?? null;
}

export type PurchaseResult = { ok: true } | { ok: false; cancelled?: boolean; message: string };

// Asks our server to check RevenueCat and turn the circle on. The store's
// webhook does the same, but this makes it immediate.
async function syncWithServer(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("sync-subscription", { body: {} });
  if (error) return false;
  return !!(data as { active?: boolean } | null)?.active;
}

export async function startPurchase(size: Size, billing: Billing, userId: string): Promise<PurchaseResult> {
  if (!ensureConfigured(userId)) {
    return { ok: false, message: "Subscriptions open soon. If you're in the pilot, enter your pilot code below." };
  }
  try {
    const pkg = await findPackage(size, billing);
    if (!pkg) return { ok: false, message: `Couldn't load plans from the ${STORE_NAME}. Try again in a moment.` };
    // Apple moves an existing subscription within its group on its own;
    // Google needs to be told which subscription is being replaced.
    const old = Platform.OS === "android" ? await currentProduct() : null;
    const change = old && old !== pkg.product.identifier ? { oldProductIdentifier: old.split(":")[0] } : null;
    await Purchases.purchasePackage(pkg, null, change);
  } catch (e) {
    const err = e as { code?: string; userCancelled?: boolean; message?: string };
    if (err.userCancelled || err.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { ok: false, cancelled: true, message: "" };
    }
    if (err.code === Purchases.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      return { ok: false, message: "Your payment is pending. Your circle turns on as soon as it goes through." };
    }
    return { ok: false, message: `The ${STORE_NAME} couldn't finish the purchase. You weren't charged. Try again.` };
  }
  if (await syncWithServer()) return { ok: true };
  return {
    ok: false,
    message: "Thanks! Your purchase went through. Your circle will turn on within a minute. Pull down to refresh.",
  };
}

// For a new phone, or a reinstall.
export async function restorePurchases(userId: string): Promise<PurchaseResult> {
  if (!ensureConfigured(userId)) return { ok: false, message: "Subscriptions aren't available yet." };
  try {
    await Purchases.restorePurchases();
  } catch {
    return { ok: false, message: `Couldn't reach the ${STORE_NAME}. Try again in a moment.` };
  }
  if (await syncWithServer()) return { ok: true };
  return { ok: false, message: `No DailyPulse subscription found for this ${STORE_NAME} account.` };
}

// Cancelling or changing plans happens in the store's own settings.
export async function openManageSubscription(userId: string): Promise<void> {
  let url: string | null = null;
  if (ensureConfigured(userId)) {
    url = await Purchases.getCustomerInfo()
      .then((info) => info.managementURL)
      .catch(() => null);
  }
  url ??=
    Platform.OS === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";
  await Linking.openURL(url);
}
