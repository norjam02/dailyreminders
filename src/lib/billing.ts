// Subscriptions through the App Store and Google Play, via RevenueCat.
//
// One subscription, paid by the organizer, turns on every circle they set
// up. The store charges the person's Apple or Google account; RevenueCat
// tracks the subscription; our server (supabase/functions) asks RevenueCat
// who has paid and writes circle_access. The app never marks a circle as
// paid itself.
//
// RevenueCat setup this code expects:
//   - Entitlement "circle"
//   - Products dailypulse_monthly ($4.99) and dailypulse_yearly ($49),
//     both attached to "circle"
//   - A current offering with the Monthly and Annual packages
//
// In Expo Go, RevenueCat runs in a preview mode with no real purchases. Real
// purchases need a development or store build.

import { Linking, Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";

import { supabase } from "./supabase";

export type PlanId = "yearly" | "monthly";

export type Plan = { id: PlanId; label: string; price: string; description: string };

// Shown until the store's own prices load (they're localized and may differ).
export const DEFAULT_PLANS: Plan[] = [
  { id: "yearly", label: "Yearly", price: "$49 a year", description: "About $4.08 a month. Save 18%." },
  { id: "monthly", label: "Monthly", price: "$4.99 a month", description: "Cancel anytime." },
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

async function packages(): Promise<Partial<Record<PlanId, PurchasesPackage>>> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  return { yearly: current?.annual ?? undefined, monthly: current?.monthly ?? undefined };
}

// The plans with the store's own prices, when the store is reachable.
export async function loadPlans(userId: string): Promise<Plan[]> {
  if (!ensureConfigured(userId)) return DEFAULT_PLANS;
  try {
    const pkgs = await packages();
    return DEFAULT_PLANS.map((p) => {
      const product = pkgs[p.id]?.product;
      if (!product) return p;
      return { ...p, price: p.id === "yearly" ? `${product.priceString} a year` : `${product.priceString} a month` };
    });
  } catch {
    return DEFAULT_PLANS;
  }
}

export type PurchaseResult = { ok: true } | { ok: false; cancelled?: boolean; message: string };

// Asks our server to check RevenueCat and turn the circle on. The store's
// webhook does the same, but this makes it immediate.
async function syncWithServer(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("sync-subscription", { body: {} });
  if (error) return false;
  return !!(data as { active?: boolean } | null)?.active;
}

export async function startPurchase(plan: PlanId, userId: string): Promise<PurchaseResult> {
  if (!ensureConfigured(userId)) {
    return { ok: false, message: "Subscriptions open soon. If you're in the pilot, enter your pilot code below." };
  }
  try {
    const pkg = (await packages())[plan];
    if (!pkg) return { ok: false, message: `Couldn't load plans from the ${STORE_NAME}. Try again in a moment.` };
    await Purchases.purchasePackage(pkg);
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
