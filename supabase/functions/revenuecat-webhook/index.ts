// RevenueCat calls this whenever a subscription changes: a purchase, renewal,
// cancellation, refund, billing problem, or expiry. We check the shared
// secret, then re-read each affected person's subscription from RevenueCat.
//
// Deploy with JWT checks off (RevenueCat doesn't send a Supabase token):
//   npx supabase functions deploy revenuecat-webhook --no-verify-jwt
// Secrets: REVENUECAT_SECRET_KEY, REVENUECAT_WEBHOOK_AUTH

import { isOurUserId, syncUser } from "../_shared/revenuecat.ts";

Deno.serve(async (req) => {
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH");
  if (!expected || req.headers.get("Authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { event } = await req.json().catch(() => ({ event: null }));
  if (!event || event.type === "TEST") return new Response("ok");

  const ids = new Set(
    [
      event.app_user_id,
      event.original_app_user_id,
      ...(event.aliases ?? []),
      ...(event.transferred_from ?? []),
      ...(event.transferred_to ?? []),
    ].filter(isOurUserId),
  );

  try {
    for (const id of ids) await syncUser(id);
  } catch (e) {
    // A non-200 makes RevenueCat retry later (5, 10, 20, 40, 80 minutes).
    console.error(e);
    return new Response("Sync failed", { status: 500 });
  }
  return new Response("ok");
});
