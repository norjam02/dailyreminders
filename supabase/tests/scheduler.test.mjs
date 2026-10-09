// Tests the scheduler by moving a simulated clock through a check-in day.
// Run with: npm run test:db

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createDatabase, signedIn } from "./helpers.mjs";

const users = {
  organizer: "00000000-0000-4000-8000-000000000101",
  parent: "00000000-0000-4000-8000-000000000102",
  caregiver: "00000000-0000-4000-8000-000000000103",
  selfParent: "00000000-0000-4000-8000-000000000104",
  son: "00000000-0000-4000-8000-000000000105",
};

let db;
let as;
let circle;
let lastSeen = 0;

// Runs the scheduler as if the clock read `at` (UTC).
async function tick(at) {
  await db.query("select public.scheduler_tick($1::timestamptz)", [at]);
}

// Notifications queued since the last call, as [who, title, body].
async function newMessages() {
  const result = await db.query(
    "select id, user_id, title, body from public.notification_outbox where id > $1 order by id",
    [lastSeen],
  );
  if (result.rows.length) lastSeen = Number(result.rows.at(-1).id);
  const names = Object.fromEntries(Object.entries(users).map(([k, v]) => [v, k]));
  return result.rows.map((r) => [names[r.user_id], r.title, r.body]);
}

async function checkin(at) {
  const result = await db.query(
    "select * from public.checkins where circle_id = $1 and scheduled_for = $2::timestamptz",
    [circle, at],
  );
  return result.rows[0];
}

before(async () => {
  db = await createDatabase(Object.values(users));
  as = signedIn(db);

  circle = (await as(users.organizer, "select public.create_circle('Mom', 'Jane') as id")).rows[0].id;
  await db.query("insert into public.circle_access (circle_id, source) values ($1, 'manual')", [circle]);
  const parentCode = (await as(users.organizer, "select public.create_invite($1, 'parent') as code", [circle])).rows[0].code;
  await as(users.parent, "select public.redeem_invite($1, 'Mom')", [parentCode], { anonymous: true });
  await as(users.organizer, "select public.approve_member($1, $2)", [circle, users.parent]);
  const caregiverCode = (await as(users.organizer, "select public.create_invite($1, 'caregiver') as code", [circle])).rows[0].code;
  await as(users.caregiver, "select public.redeem_invite($1, 'Pat')", [caregiverCode]);
  await as(users.organizer, "select public.approve_member($1, $2)", [circle, users.caregiver]);

  // One check-in a day at 10:00 in Chicago, normal firmness, one-hour wait.
  await as(users.organizer, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/Chicago')", [circle]);
});

after(async () => {
  await db?.close();
});

// Monday, November 16, 2026. Chicago is on CST (UTC-6), so 10:00 local is 16:00 UTC.
describe("a normal day that ends in a late check-in", () => {
  const slot = "2026-11-16T16:00:00Z";

  test("upcoming check-ins are created for today and tomorrow, in local time", async () => {
    await tick("2026-11-16T14:00:00Z");
    const rows = await db.query("select scheduled_for from public.checkins where circle_id = $1 order by scheduled_for", [circle]);
    assert.deepEqual(
      rows.rows.map((r) => new Date(r.scheduled_for).toISOString()),
      ["2026-11-16T16:00:00.000Z", "2026-11-17T16:00:00.000Z"],
    );
    assert.deepEqual(await newMessages(), []);
  });

  test("ticking again does not duplicate check-ins", async () => {
    await tick("2026-11-16T14:01:00Z");
    const rows = await db.query("select count(*)::int as n from public.checkins where circle_id = $1", [circle]);
    assert.equal(rows.rows[0].n, 2);
  });

  test("nothing is sent before check-in time", async () => {
    await tick("2026-11-16T15:59:00Z");
    assert.deepEqual(await newMessages(), []);
  });

  test("the parent is prompted at check-in time", async () => {
    await tick(slot);
    assert.deepEqual(await newMessages(), [["parent", "Time to say hello", "Tap to check in."]]);
    await tick("2026-11-16T16:01:00Z");
    assert.deepEqual(await newMessages(), []);
  });

  test("normal firmness reminds twice, 20 minutes apart", async () => {
    await tick("2026-11-16T16:19:00Z");
    assert.deepEqual(await newMessages(), []);
    await tick("2026-11-16T16:20:00Z");
    assert.deepEqual(await newMessages(), [["parent", "Just a reminder", "Tap to check in."]]);
    await tick("2026-11-16T16:40:00Z");
    assert.deepEqual(await newMessages(), [["parent", "Just a reminder", "Tap to check in."]]);
    await tick("2026-11-16T16:59:00Z");
    assert.deepEqual(await newMessages(), []);
  });

  test("when the wait runs out, the check-in is missed and the organizer is alerted", async () => {
    await tick("2026-11-16T17:00:00Z");
    assert.deepEqual(await newMessages(), [
      ["organizer", "Mom hasn't checked in", "The 10:00 AM check-in is still open. A call might be good."],
    ]);
    assert.equal((await checkin(slot)).status, "missed");
  });

  test("15 minutes later the rest of the circle is alerted, not the parent", async () => {
    await tick("2026-11-16T17:14:00Z");
    assert.deepEqual(await newMessages(), []);
    await tick("2026-11-16T17:15:00Z");
    assert.deepEqual(await newMessages(), [
      ["caregiver", "Mom hasn't checked in", "The 10:00 AM check-in is still open. A call might be good."],
    ]);
    await tick("2026-11-16T17:30:00Z");
    assert.deepEqual(await newMessages(), []);
  });

  test("a late check-in tells everyone who was alerted", async () => {
    const { id } = await checkin(slot);
    await as(users.parent, "select public.respond_checkin($1, 'button', 'Love you!')", [id]);
    assert.deepEqual(await newMessages(), [
      ["organizer", "Mom checked in", "Love you!"],
      ["caregiver", "Mom checked in", "Love you!"],
    ]);
  });
});

describe("a persistent day with Later", () => {
  const slot = "2026-11-17T16:00:00Z";

  before(async () => {
    await as(
      users.organizer,
      "update public.checkin_plans set firmness = 'persistent', mode = 'photo', photo_prompt = 'your breakfast' where circle_id = $1",
      [circle],
    );
  });

  test("the photo prompt names what to photograph", async () => {
    await tick(slot);
    assert.deepEqual(await newMessages(), [["parent", "Time to say hello", "Send a photo: your breakfast."]]);
  });

  test("Later pauses reminders for 30 minutes", async () => {
    // The parent tapped Later at 10:05; snooze_checkin uses the real clock, so set it directly.
    await db.query("update public.checkins set snoozed_until = $2::timestamptz where circle_id = $1 and scheduled_for = $3::timestamptz", [
      circle,
      "2026-11-17T16:35:00Z",
      slot,
    ]);
    for (const at of ["2026-11-17T16:10:00Z", "2026-11-17T16:20:00Z", "2026-11-17T16:30:00Z"]) {
      await tick(at);
    }
    assert.deepEqual(await newMessages(), []);
  });

  test("persistent firmness then reminds every 10 minutes", async () => {
    await tick("2026-11-17T16:35:00Z");
    assert.equal((await newMessages()).length, 1);
    await tick("2026-11-17T16:40:00Z");
    assert.equal((await newMessages()).length, 0);
    await tick("2026-11-17T16:45:00Z");
    assert.equal((await newMessages()).length, 1);
  });

  test("Later adds 30 minutes to the wait", async () => {
    await tick("2026-11-17T17:00:00Z");
    assert.equal((await checkin(slot)).status, "pending");
    await newMessages();
    await tick("2026-11-17T17:30:00Z");
    assert.equal((await checkin(slot)).status, "missed");
    const messages = await newMessages();
    assert.deepEqual(messages.at(-1), [
      "organizer",
      "Mom hasn't checked in",
      "The 10:00 AM check-in is still open. A call might be good.",
    ]);
  });

  test("an on-time check-in tells only the organizer", async () => {
    await tick("2026-11-18T15:00:00Z");
    await newMessages();
    await tick("2026-11-18T16:00:00Z");
    await newMessages();
    const { id } = await checkin("2026-11-18T16:00:00Z");
    await as(users.parent, "select public.respond_checkin($1, 'photo', null, $2)", [id, `${circle}/breakfast.jpg`]);
    assert.deepEqual(await newMessages(), [["organizer", "Mom checked in", "Sent a photo."]]);
  });
});

describe("changing the plan", () => {
  test("new times replace upcoming check-ins that have not started", async () => {
    await as(
      users.organizer,
      "update public.checkin_plans set times = array['08:00','20:00']::time[] where circle_id = $1",
      [circle],
    );
    const before = await db.query(
      "select count(*)::int as n from public.checkins where circle_id = $1 and status = 'pending' and prompted_at is null",
      [circle],
    );
    assert.equal(before.rows[0].n, 0);

    await tick("2026-11-19T12:00:00Z");
    const rows = await db.query(
      "select scheduled_for from public.checkins where circle_id = $1 and scheduled_for > '2026-11-19T12:00:00Z' order by scheduled_for",
      [circle],
    );
    assert.deepEqual(
      rows.rows.map((r) => new Date(r.scheduled_for).toISOString()),
      [
        "2026-11-19T14:00:00.000Z",
        "2026-11-20T02:00:00.000Z",
        "2026-11-20T14:00:00.000Z",
        "2026-11-21T02:00:00.000Z",
      ],
    );
  });

  test("no check-ins are made for a circle that isn't paid", async () => {
    await db.query("delete from public.circle_access where circle_id = $1", [circle]);
    await db.query("delete from public.checkins where circle_id = $1 and status = 'pending'", [circle]);
    await tick("2026-11-19T12:00:00Z");
    const rows = await db.query("select count(*)::int as n from public.checkins where circle_id = $1 and status = 'pending'", [circle]);
    assert.equal(rows.rows[0].n, 0);
    await db.query("insert into public.circle_access (circle_id, source) values ($1, 'manual')", [circle]);
  });

  test("no check-ins are made for a circle without an active parent", async () => {
    const lonely = (await as(users.caregiver, "select public.create_circle('Dad', 'Pat', 'caregiver') as id")).rows[0].id;
    await as(users.caregiver, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/Chicago')", [lonely]);
    await tick("2026-11-19T12:00:00Z");
    const rows = await db.query("select count(*)::int as n from public.checkins where circle_id = $1", [lonely]);
    assert.equal(rows.rows[0].n, 0);
  });
});

describe("a parent who is the organizer", () => {
  let own;
  const slot = "2026-11-20T17:00:00Z"; // 10:00 in Denver (UTC-7)

  test("a miss alerts the rest of the circle right away, not the parent", async () => {
    own = (await as(users.selfParent, "select public.create_circle('Ruth', 'Ruth', 'parent') as id")).rows[0].id;
    await db.query("insert into public.circle_access (circle_id, source) values ($1, 'manual')", [own]);
    const code = (await as(users.selfParent, "select public.create_invite($1, 'child') as code", [own])).rows[0].code;
    await as(users.son, "select public.redeem_invite($1, 'Ben')", [code]);
    await as(users.selfParent, "select public.approve_member($1, $2)", [own, users.son]);
    await as(users.selfParent, "insert into public.checkin_plans (circle_id, timezone, firmness) values ($1, 'America/Denver', 'gentle')", [own]);

    await tick("2026-11-20T16:00:00Z");
    await tick(slot);
    await newMessages();
    await tick("2026-11-20T18:00:00Z");
    assert.deepEqual(await newMessages(), [
      ["son", "Ruth hasn't checked in", "The 10:00 AM check-in is still open. A call might be good."],
    ]);
  });

  test("no second alert 15 minutes later", async () => {
    await tick("2026-11-20T18:15:00Z");
    assert.deepEqual(await newMessages(), []);
  });
});

describe("sending", () => {
  test("queued notifications go to Expo, one message per device", async () => {
    await db.query("delete from net.requests");
    await db.query("update public.notification_outbox set sent_at = now()");
    await as(users.organizer, "insert into public.push_tokens (user_id, token, platform) values ($1, 'ExponentPushToken[org]', 'ios')", [users.organizer]);
    await as(users.caregiver, "insert into public.push_tokens (user_id, token, platform) values ($1, 'ExponentPushToken[cg-1]', 'ios'), ($1, 'ExponentPushToken[cg-2]', 'android')", [users.caregiver]);

    await db.query(
      "insert into public.notification_outbox (user_id, title, body) values ($1, 'Mom checked in', 'Love you!'), ($2, 'Mom checked in', 'Love you!'), ($3, 'Time to say hello', 'Tap to check in.')",
      [users.organizer, users.caregiver, users.parent],
    );

    const sent = await db.query("select public.send_outbox() as n");
    assert.equal(sent.rows[0].n, 3);

    const requests = await db.query("select url, body from net.requests");
    assert.equal(requests.rows.length, 1);
    assert.equal(requests.rows[0].url, "https://exp.host/--/api/v2/push/send");
    assert.deepEqual(
      requests.rows[0].body.map((m) => m.to).sort(),
      ["ExponentPushToken[cg-1]", "ExponentPushToken[cg-2]", "ExponentPushToken[org]"],
    );

    const unsent = await db.query("select count(*)::int as n from public.notification_outbox where sent_at is null");
    assert.equal(unsent.rows[0].n, 0);
    assert.equal((await db.query("select public.send_outbox() as n")).rows[0].n, 0);
  });

  test("more than 100 messages are split across requests", async () => {
    await db.query("delete from net.requests");
    await db.query(
      "insert into public.notification_outbox (user_id, title, body) select $1, 'Hello', 'Test' from generate_series(1, 150)",
      [users.organizer],
    );
    await db.query("select public.send_outbox()");
    const requests = await db.query("select jsonb_array_length(body) as n from net.requests order by id");
    assert.deepEqual(requests.rows.map((r) => r.n), [100, 50]);
  });

  test("the scheduler is set to run every minute", async () => {
    const job = await db.query("select schedule, command from cron.jobs where name = 'dailyreminders-scheduler'");
    assert.deepEqual(job.rows, [
      { schedule: "* * * * *", command: "select public.scheduler_tick(); select public.send_outbox();" },
    ]);
  });

  test("the app cannot run the scheduler or read the outbox", async () => {
    await assert.rejects(as(users.organizer, "select public.scheduler_tick()"), /permission denied/);
    await assert.rejects(as(users.organizer, "select public.send_outbox()"), /permission denied/);
    await assert.rejects(as(users.organizer, "select * from public.notification_outbox"), /permission denied/);
  });
});
