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
// In Expo Go, RevenueCat only simulates purchases, so buying is turned off
// there. Real purchases need a development or store build.

import Constants, { ExecutionEnvironment } from "expo-constants";
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

// Shown until the store's own prices load. The store's prices are in the
// person's own currency, so the descriptions are recomputed from them.
export const DEFAULT_PRICES: Price[] = [
  { size: "standard", billing: "yearly", price: "$49 a year", description: "About $4.08 a month, less than paying monthly." },
  { size: "standard", billing: "monthly", price: "$4.99 a month", description: "Cancel anytime." },
  { size: "plus", billing: "yearly", price: "$99 a year", description: "About $8.25 a month, less than paying monthly." },
  { size: "plus", billing: "monthly", price: "$9.99 a month", description: "Cancel anytime." },
];

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY,
});

const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const STORE_NAME = Platform.OS === "ios" ? "App Store" : "Google Play";

// True when real purchases can happen on this phone.
export const PURCHASES_AVAILABLE = !!API_KEY && !IN_EXPO_GO;

// The DailyPulse account RevenueCat is set up for, once that has succeeded.
let configuredFor: string | null = null;

// Ties purchases to the signed-in organizer, so a subscription follows their
// account to a new phone. Waits for RevenueCat to switch accounts, so a
// purchase can never land on the previous person who used this phone.
async function ensureConfigured(userId: string): Promise<boolean> {
  if (!PURCHASES_AVAILABLE || !API_KEY) return false;
  if (configuredFor === userId) return true;
  try {
    if (!(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey: API_KEY, appUserID: userId });
    } else {
      await Purchases.logIn(userId);
    }
    configuredFor = userId;
    return true;
  } catch {
    configuredFor = null;
    return false;
  }
}

// Called on sign-out, so the next person on this phone starts clean.
export async function signOutOfStore(): Promise<void> {
  if (configuredFor === null) return;
  configuredFor = null;
  await Purchases.logOut().catch(() => {});
}

async function findPackage(size: Size, billing: Billing): Promise<PurchasesPackage | undefined> {
  const offerings = await Purchases.getOfferings();
  const offering = size === "plus" ? offerings.all.plus : offerings.current;
  return (billing === "yearly" ? offering?.annual : offering?.monthly) ?? undefined;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

// The prices from the store, in the person's currency, when it's reachable.
export async function loadPrices(userId: string): Promise<Price[]> {
  try {
    if (!(await ensureConfigured(userId))) return DEFAULT_PRICES;
    return await Promise.all(
      DEFAULT_PRICES.map(async (p) => {
        const product = (await findPackage(p.size, p.billing))?.product;
        if (!product) return p;
        const period = p.billing === "yearly" ? "year" : "month";
        const description =
          p.billing === "yearly"
            ? `About ${formatMoney(product.price / 12, product.currencyCode)} a month, less than paying monthly.`
            : "Cancel anytime.";
        return { ...p, price: `${product.priceString} a ${period}`, description };
      }),
    );
  } catch {
    return DEFAULT_PRICES;
  }
}

export type PurchaseResult =
  | { ok: true }
  | { ok: false; pending?: boolean; cancelled?: boolean; message: string };

// Asks our server to check RevenueCat and turn the circle on. The store's
// webhook does the same, but this makes it immediate.
export async function syncWithServer(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("sync-subscription", { body: {} });
  if (error) return false;
  return !!(data as { active?: boolean } | null)?.active;
}

const NOT_AVAILABLE = IN_EXPO_GO
  ? "Purchases don't work in this test version of the app. Use a pilot code instead."
  : "Subscriptions open soon. If you're in the pilot, use your pilot code.";

export async function startPurchase(size: Size, billing: Billing, userId: string): Promise<PurchaseResult> {
  if (!(await ensureConfigured(userId))) return { ok: false, message: NOT_AVAILABLE };
  try {
    const pkg = await findPackage(size, billing);
    if (!pkg) return { ok: false, message: `Couldn't load plans from the ${STORE_NAME}. Try again in a moment.` };

    // A subscription bought in the other store can't be changed from here.
    const info = await Purchases.getCustomerInfo();
    const active = info.entitlements.active.circle;
    const thisStore = Platform.OS === "ios" ? "APP_STORE" : "PLAY_STORE";
    if (active && active.store !== thisStore) {
      return {
        ok: false,
        message: `Your subscription was bought on ${active.store === "APP_STORE" ? "an iPhone" : "an Android phone"}. Change it there, in the store's subscription settings.`,
      };
    }

    // Apple moves an existing subscription within its group on its own.
    // Google needs to be told which one is being replaced, and how to charge.
    const change =
      Platform.OS === "android" && active && active.productIdentifier !== pkg.product.identifier
        ? {
            oldProductIdentifier: active.productIdentifier.split(":")[0],
            replacementMode: Purchases.STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
          }
        : null;
    await Purchases.purchasePackage(pkg, null, change);
  } catch (e) {
    const code = (e as { code?: string; userCancelled?: boolean }).code;
    const codes = Purchases.PURCHASES_ERROR_CODE;
    if ((e as { userCancelled?: boolean }).userCancelled || code === codes.PURCHASE_CANCELLED_ERROR) {
      return { ok: false, cancelled: true, message: "" };
    }
    switch (code) {
      case codes.PAYMENT_PENDING_ERROR:
        return { ok: false, pending: true, message: "Your payment is waiting for approval. Your circle starts as soon as it goes through." };
      case codes.PRODUCT_ALREADY_PURCHASED_ERROR:
        return { ok: false, message: "You already have this plan. Tap \"Already subscribed?\" below to restore it." };
      case codes.RECEIPT_ALREADY_IN_USE_ERROR:
        return { ok: false, message: `This ${STORE_NAME} account already pays for a different DailyPulse account. Sign in with that account, or use a different ${STORE_NAME} account.` };
      case codes.PURCHASE_NOT_ALLOWED_ERROR:
        return { ok: false, message: `This phone isn't allowed to make purchases. Check Screen Time or family purchase settings.` };
      case codes.NETWORK_ERROR:
        return { ok: false, message: "Couldn't connect. Check your internet connection and try again." };
      default:
        return { ok: false, message: `The ${STORE_NAME} couldn't finish the purchase. Check your ${STORE_NAME} purchase history before trying again.` };
    }
  }
  if (await syncWithServer()) return { ok: true };
  // Paid, but the server hasn't caught up yet; the screen keeps checking.
  return { ok: false, pending: true, message: "Payment received. Your circle will be ready in about a minute." };
}

// For a new phone, or a reinstall.
export async function restorePurchases(userId: string): Promise<PurchaseResult> {
  if (!(await ensureConfigured(userId))) return { ok: false, message: NOT_AVAILABLE };
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
  if (await ensureConfigured(userId)) {
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
