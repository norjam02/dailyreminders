// The app calls this right after a purchase or restore, so the circle turns
// on at once instead of waiting for RevenueCat's webhook. Checks who's
// calling from their Supabase session; only signed-in organizers (not
// anonymous accounts) can subscribe.
//
// Deploy:  npx supabase functions deploy sync-subscription --no-verify-jwt
// (the function checks the session itself)

import { admin, syncUser } from "../_shared/revenuecat.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data, error } = token ? await admin.auth.getUser(token) : { data: null, error: true };
  const user = data?.user;
  if (error || !user || user.is_anonymous) {
    return Response.json({ error: "Sign in first." }, { status: 401, headers: cors });
  }

  try {
    const active = await syncUser(user.id);
    return Response.json({ active }, { headers: cors });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Couldn't check the subscription." }, { status: 502, headers: cors });
  }
});
