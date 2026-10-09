// Deletes the signed-in person's account and their data (App Store
// guideline 5.1.1(v)). Store subscriptions can't be cancelled from here; the
// app tells organizers to cancel in the App Store or Google Play.
//
// Deploy:  npx supabase functions deploy delete-account --no-verify-jwt
// (the function checks the session itself)

import { admin } from "../_shared/admin.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "checkin-photos";

async function removeFolder(circleId: string) {
  // Photos live at <circle_id>/<file>.
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(circleId, { limit: 100 });
    if (error) throw error;
    if (!data?.length) return;
    const { error: removeError } = await admin.storage.from(BUCKET).remove(data.map((f) => `${circleId}/${f.name}`));
    if (removeError) throw removeError;
    if (data.length < 100) return;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data, error } = token ? await admin.auth.getUser(token) : { data: null, error: true };
  const user = data?.user;
  if (error || !user) return Response.json({ error: "Sign in first." }, { status: 401, headers: cors });

  try {
    const { data: circles, error: dataError } = await admin.rpc("delete_account_data", { p_user: user.id });
    if (dataError) throw dataError;
    for (const circleId of (circles as string[] | null) ?? []) await removeFolder(circleId);
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    return Response.json({ deleted: true }, { headers: cors });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Couldn't delete the account. Try again." }, { status: 500, headers: cors });
  }
});
