// Subscription notice bookkeeping: which circles get the yearly email.
// Run with: npm run test:db

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createDatabase, signedIn } from "./helpers.mjs";

const store = "00000000-0000-4000-8000-000000000101";
const pilot = "00000000-0000-4000-8000-000000000102";
const lapsed = "00000000-0000-4000-8000-000000000103";

let db;
let as;
const circles = {};

async function asService(sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query(sql, params);
  });
}

before(async () => {
  db = await createDatabase([store, pilot, lapsed]);
  as = signedIn(db);
  for (const [name, uid] of Object.entries({ store, pilot, lapsed })) {
    circles[name] = (await as(uid, "select public.create_circle('Mom', 'Sam', 'family') as id")).rows[0].id;
  }
  await db.query(
    "insert into public.circle_access (circle_id, source, plan, active_until, max_members) values ($1, 'apple', 'yearly', now() + interval '20 days', 4)",
    [circles.store],
  );
  await db.query(
    "insert into public.circle_access (circle_id, source, active_until, max_members) values ($1, 'pilot_code', now() + interval '20 days', 10)",
    [circles.pilot],
  );
  await db.query(
    "insert into public.circle_access (circle_id, source, plan, active_until) values ($1, 'google', 'monthly', now() - interval '1 day')",
    [circles.lapsed],
  );
});

after(async () => {
  await db?.close();
});

test("only active store subscriptions are candidates", async () => {
  const rows = (await asService("select * from public.store_subscribed_circles('annual')")).rows;
  assert.deepEqual(rows.map((r) => r.circle_id), [circles.store]);
  assert.equal(rows[0].organizer_id, store);
  assert.equal(rows[0].plan, "yearly");
});

test("a circle that got its yearly email isn't picked again for 330 days", async () => {
  await asService("insert into public.subscription_notices (circle_id, user_id, kind) values ($1, $2, 'annual')", [
    circles.store,
    store,
  ]);
  assert.equal((await asService("select * from public.store_subscribed_circles('annual')")).rows.length, 0);
  // A price change still reaches it.
  assert.equal((await asService("select * from public.store_subscribed_circles('price_change')")).rows.length, 1);
  await db.query("update public.subscription_notices set sent_at = now() - interval '331 days' where circle_id = $1", [
    circles.store,
  ]);
  assert.equal((await asService("select * from public.store_subscribed_circles('annual')")).rows.length, 1);
});

test("the same notice can't be recorded twice", async () => {
  await asService(
    "insert into public.subscription_notices (circle_id, user_id, kind, notice_key) values ($1, $2, 'price_change', 'standard:yearly:2027-03-01')",
    [circles.store, store],
  );
  await assert.rejects(
    asService(
      "insert into public.subscription_notices (circle_id, user_id, kind, notice_key) values ($1, $2, 'price_change', 'standard:yearly:2027-03-01')",
      [circles.store, store],
    ),
    /duplicate key/,
  );
});

test("the app can't see or call any of it", async () => {
  await assert.rejects(as(store, "select * from public.store_subscribed_circles('annual')"), /permission denied/);
  await assert.rejects(as(store, "select * from public.subscription_notices"), /permission denied/);
});

test("the daily job is scheduled", async () => {
  const job = (await db.query("select schedule, command from cron.jobs where name = 'dailypulse-subscription-notices'")).rows[0];
  assert.equal(job.schedule, "0 15 * * *");
  assert.match(job.command, /subscription-notices/);
  assert.match(job.command, /'dryRun', false/);
});
