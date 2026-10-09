// Tests the database schema and access rules in an in-memory Postgres.
// Run with: npm run test:db

import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const users = {
  child: "00000000-0000-4000-8000-000000000001",
  parent: "00000000-0000-4000-8000-000000000002",
  caregiver: "00000000-0000-4000-8000-000000000003",
  stranger: "00000000-0000-4000-8000-000000000004",
  secondParent: "00000000-0000-4000-8000-000000000005",
  organizingCaregiver: "00000000-0000-4000-8000-000000000006",
  secondChild: "00000000-0000-4000-8000-000000000007",
  guesser: "00000000-0000-4000-8000-000000000008",
  selfParent: "00000000-0000-4000-8000-000000000009",
  niece: "00000000-0000-4000-8000-000000000010",
  payer: "00000000-0000-4000-8000-000000000011",
  joiner: "00000000-0000-4000-8000-000000000012",
  storeBuyer: "00000000-0000-4000-8000-000000000013",
};

let db;

// Runs SQL as a signed-in user, the way the app's requests reach the database.
async function as(uid, sql, params = [], { anonymous = false } = {}) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid, JSON.stringify({ sub: uid, role: "authenticated", is_anonymous: anonymous })],
    );
    await tx.exec("set local role authenticated");
    return tx.query(sql, params);
  });
}

async function value(uid, sql, params, options) {
  const result = await as(uid, sql, params, options);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

// Marks a circle as paid, the way a store webhook or an admin would.
async function activate(circleId, until = null) {
  await db.query(
    "insert into public.circle_access (circle_id, source, active_until) values ($1, 'manual', $2) on conflict (circle_id) do update set active_until = excluded.active_until",
    [circleId, until],
  );
}

async function count(uid, sql, params, options) {
  const result = await as(uid, sql, params, options);
  return result.rows.length;
}

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(path.join(here, "supabase-stubs.sql"), "utf8"));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  for (const id of Object.values(users)) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
  }
});

after(async () => {
  await db?.close();
});

describe("circles and joining", () => {
  let circle;
  let parentCode;

  test("an anonymous user cannot start a circle", async () => {
    await assert.rejects(
      as(users.stranger, "select public.create_circle('Mom', 'Someone')", [], { anonymous: true }),
      /Create an account to start a circle/,
    );
  });

  test("the child starts a circle and is its active child", async () => {
    circle = await value(users.child, "select public.create_circle('Mom', 'Jane')");
    assert.ok(circle);
    const member = await as(users.child, "select role, status from public.circle_members where circle_id = $1", [circle]);
    assert.deepEqual(member.rows, [{ role: "child", status: "active" }]);
  });

  test("an unpaid circle can't invite anyone", async () => {
    await assert.rejects(
      as(users.child, "select public.create_invite($1, 'parent')", [circle]),
      /Subscribe to invite people/,
    );
  });

  test("the app can't mark a circle as paid", async () => {
    await assert.rejects(
      as(users.child, "insert into public.circle_access (circle_id, source) values ($1, 'manual')", [circle]),
      /permission denied/,
    );
    await assert.rejects(as(users.child, "select * from public.access_codes"), /permission denied/);
  });

  test("a pilot code activates the circle", async () => {
    await db.query("insert into public.access_codes (code, days, uses_left, expires_at) values ('PILOT2026', 30, 1, now() + interval '30 days')");
    assert.equal(await value(users.child, "select public.redeem_access_code($1, 'nope')", [circle]), null);
    const until = await value(users.child, "select public.redeem_access_code($1, ' pilot2026 ')", [circle]);
    assert.ok(until > new Date(Date.now() + 29 * 86_400_000));
    assert.equal(await value(users.child, "select public.circle_is_active($1)", [circle]), true);
    assert.equal(await value(users.child, "select source from public.circle_access where circle_id = $1", [circle]), "pilot_code");
  });

  test("only the organizer can make join codes", async () => {
    await assert.rejects(
      as(users.stranger, "select public.create_invite($1, 'parent')", [circle]),
      /Only the person who set up this circle can invite people/,
    );
    parentCode = await value(users.child, "select public.create_invite($1, 'parent')", [circle]);
    assert.match(parentCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  test("an anonymous parent joins with the code and waits for approval", async () => {
    const joined = await value(
      users.parent,
      "select public.redeem_invite($1, 'Mom')",
      [parentCode.toLowerCase()],
      { anonymous: true },
    );
    assert.equal(joined, circle);
    const status = await value(users.parent, "select status from public.circle_members where user_id = $1", [users.parent]);
    assert.equal(status, "pending");
  });

  test("a code works only once", async () => {
    const joined = await value(users.stranger, "select public.redeem_invite($1, 'Stranger')", [parentCode]);
    assert.equal(joined, null);
  });

  test("an expired code is refused", async () => {
    const code = await value(users.child, "select public.create_invite($1, 'family')", [circle]);
    await db.query("update public.invites set expires_at = now() - interval '1 minute' where code = $1", [code]);
    const joined = await value(users.stranger, "select public.redeem_invite($1, 'Stranger')", [code]);
    assert.equal(joined, null);
  });

  test("guessing codes is limited to 10 wrong tries an hour", async () => {
    for (let i = 0; i < 10; i++) {
      const joined = await value(users.guesser, "select public.redeem_invite($1, 'Guesser')", [`ZZZZ${i}A`]);
      assert.equal(joined, null);
    }
    const real = await value(users.child, "select public.create_invite($1, 'family')", [circle]);
    await assert.rejects(
      as(users.guesser, "select public.redeem_invite($1, 'Guesser')", [real]),
      /Too many codes tried/,
    );
    const attempts = await db.query("select count(*)::int as n from public.invite_attempts where user_id = $1", [users.guesser]);
    assert.equal(attempts.rows[0].n, 10);
  });

  test("the app cannot read the guess log", async () => {
    await assert.rejects(as(users.child, "select * from public.invite_attempts"), /permission denied/);
  });

  test("a circle cannot get a second parent", async () => {
    await assert.rejects(
      as(users.child, "select public.create_invite($1, 'parent')", [circle]),
      /already checks in/,
    );
  });

  test("a pending parent sees the circle but not its check-ins", async () => {
    assert.equal(await count(users.parent, "select id from public.circles where id = $1", [circle]), 1);
    assert.equal(await count(users.parent, "select * from public.checkin_plans"), 0);
  });

  test("the child sees who is waiting, including their name", async () => {
    const pending = await as(
      users.child,
      "select p.display_name from public.circle_members m join public.profiles p on p.id = m.user_id where m.status = 'pending'",
    );
    assert.deepEqual(pending.rows, [{ display_name: "Mom" }]);
  });

  test("only the organizer can approve", async () => {
    await assert.rejects(
      as(users.parent, "select public.approve_member($1, $2)", [circle, users.parent]),
      /Only the person who set up this circle can approve people/,
    );
    await as(users.child, "select public.approve_member($1, $2)", [circle, users.parent]);
    const status = await value(users.parent, "select status from public.circle_members where user_id = $1", [users.parent]);
    assert.equal(status, "active");
  });

  test("a caregiver joins and is approved", async () => {
    const code = await value(users.child, "select public.create_invite($1, 'caregiver')", [circle]);
    await as(users.caregiver, "select public.redeem_invite($1, 'Pat')", [code]);
    await as(users.child, "select public.approve_member($1, $2)", [circle, users.caregiver]);
    const roles = await as(users.caregiver, "select role from public.circle_members order by role");
    assert.deepEqual(roles.rows.map((r) => r.role), ["child", "parent", "caregiver"]);
  });

  test("a caregiver who did not set up the circle cannot make codes", async () => {
    await assert.rejects(
      as(users.caregiver, "select public.create_invite($1, 'family')", [circle]),
      /Only the person who set up this circle can invite people/,
    );
  });

  describe("check-in plan", () => {
    test("the child sets the plan and the defaults fill in", async () => {
      await as(users.child, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/Chicago')", [circle]);
      const plan = await as(users.parent, "select mode, firmness, wait_minutes, cardinality(quick_replies) replies, updated_by from public.checkin_plans");
      assert.deepEqual(plan.rows, [
        { mode: "button", firmness: "normal", wait_minutes: 60, replies: 4, updated_by: users.child },
      ]);
    });

    test("the parent cannot change the plan", async () => {
      await as(users.parent, "update public.checkin_plans set mode = 'selfie' where circle_id = $1", [circle]);
      assert.equal(await value(users.child, "select mode from public.checkin_plans"), "button");
    });

    test("bad settings are refused", async () => {
      await assert.rejects(
        as(users.child, "update public.checkin_plans set timezone = 'Mars/Olympus' where circle_id = $1", [circle]),
        /check constraint/,
      );
      await assert.rejects(
        as(users.child, "update public.checkin_plans set times = array['08:00','12:00','16:00','20:00']::time[] where circle_id = $1", [circle]),
        /check constraint/,
      );
      await assert.rejects(
        as(users.child, "update public.checkin_plans set wait_minutes = 45 where circle_id = $1", [circle]),
        /check constraint/,
      );
    });

    test("the child switches the plan to photo", async () => {
      await as(users.child, "update public.checkin_plans set mode = 'photo', photo_prompt = 'Your breakfast' where circle_id = $1", [circle]);
      assert.equal(await value(users.parent, "select mode from public.checkin_plans"), "photo");
    });
  });

  describe("check-ins", () => {
    let first;
    let second;

    before(async () => {
      const rows = await db.query(
        "insert into public.checkins (circle_id, scheduled_for) values ($1, now() - interval '5 minutes'), ($1, now() + interval '4 hours') returning id",
        [circle],
      );
      [first, second] = rows.rows.map((r) => r.id);
    });

    test("everyone active in the circle sees check-ins", async () => {
      assert.equal(await count(users.child, "select id from public.checkins"), 2);
      assert.equal(await count(users.caregiver, "select id from public.checkins"), 2);
    });

    test("only the parent can answer", async () => {
      await assert.rejects(
        as(users.caregiver, "select public.respond_checkin($1, 'button')", [first]),
        /Check-in not found/,
      );
    });

    test("a photo answer needs a photo in the circle's folder", async () => {
      await assert.rejects(
        as(users.parent, "select public.respond_checkin($1, 'photo')", [first]),
        /Add the photo/,
      );
      await assert.rejects(
        as(users.parent, "select public.respond_checkin($1, 'photo', null, $2)", [first, "00000000-0000-4000-8000-0000000000aa/x.jpg"]),
        /Add the photo/,
      );
    });

    test("a quick reply must be one of the choices", async () => {
      await assert.rejects(
        as(users.parent, "select public.respond_checkin($1, 'button', 'Go away')", [first]),
        /not one of the choices/,
      );
    });

    test("the parent answers with the button and a quick reply", async () => {
      await as(users.parent, "select public.respond_checkin($1, 'button', 'Love you!')", [first]);
      const row = await as(users.child, "select status, response_mode, quick_reply from public.checkins where id = $1", [first]);
      assert.deepEqual(row.rows, [{ status: "done", response_mode: "button", quick_reply: "Love you!" }]);
      await assert.rejects(
        as(users.parent, "select public.respond_checkin($1, 'button')", [first]),
        /already done/,
      );
    });

    test("Later works once per check-in", async () => {
      await as(users.parent, "select public.snooze_checkin($1)", [second]);
      await assert.rejects(
        as(users.parent, "select public.snooze_checkin($1)", [second]),
        /once per check-in/,
      );
    });

    test("the parent answers with a photo", async () => {
      await as(users.parent, "select public.respond_checkin($1, 'photo', null, $2)", [second, `${circle}/breakfast.jpg`]);
      assert.equal(await value(users.child, "select response_mode from public.checkins where id = $1", [second]), "photo");
    });

    test("the app cannot write check-ins directly", async () => {
      await assert.rejects(
        as(users.parent, "update public.checkins set status = 'done' where circle_id = $1", [circle]),
        /permission denied/,
      );
      await assert.rejects(
        as(users.child, "insert into public.checkins (circle_id, scheduled_for) values ($1, now())", [circle]),
        /permission denied/,
      );
    });
  });

  describe("photos", () => {
    test("the parent uploads into the circle's folder", async () => {
      await as(users.parent, "insert into storage.objects (bucket_id, name) values ('checkin-photos', $1)", [`${circle}/breakfast.jpg`]);
    });

    test("no one else can upload", async () => {
      await assert.rejects(
        as(users.caregiver, "insert into storage.objects (bucket_id, name) values ('checkin-photos', $1)", [`${circle}/x.jpg`]),
        /row-level security/,
      );
      await assert.rejects(
        as(users.parent, "insert into storage.objects (bucket_id, name) values ('checkin-photos', 'not-a-circle/x.jpg')"),
        /row-level security/,
      );
    });

    test("circle members see photos and strangers do not", async () => {
      assert.equal(await count(users.caregiver, "select name from storage.objects"), 1);
      assert.equal(await count(users.stranger, "select name from storage.objects"), 0);
    });
  });

  describe("strangers and direct writes", () => {
    test("a stranger sees nothing", async () => {
      for (const table of ["circles", "circle_members", "checkin_plans", "checkins", "invites"]) {
        assert.equal(await count(users.stranger, `select * from public.${table}`), 0, table);
      }
      assert.equal(await count(users.stranger, "select * from public.profiles where id <> $1", [users.stranger]), 0);
    });

    test("membership cannot be edited directly", async () => {
      await assert.rejects(
        as(users.caregiver, "update public.circle_members set role = 'child' where user_id = $1", [users.caregiver]),
        /permission denied/,
      );
      await assert.rejects(
        as(users.stranger, "insert into public.circles (name, organizer_id) values ('x', $1)", [users.stranger]),
        /permission denied/,
      );
    });
  });

  describe("a caregiver as organizer", () => {
    let caregiverCircle;

    test("a caregiver sets up a circle and manages it", async () => {
      caregiverCircle = await value(users.organizingCaregiver, "select public.create_circle('Dad', 'Sam', 'caregiver')");
      await activate(caregiverCircle);
      const me = await as(users.organizingCaregiver, "select role, status from public.circle_members where circle_id = $1", [caregiverCircle]);
      assert.deepEqual(me.rows, [{ role: "caregiver", status: "active" }]);

      const parentCode = await value(users.organizingCaregiver, "select public.create_invite($1, 'parent')", [caregiverCircle]);
      await as(users.secondParent, "select public.redeem_invite($1, 'Dad')", [parentCode], { anonymous: true });
      await as(users.organizingCaregiver, "select public.approve_member($1, $2)", [caregiverCircle, users.secondParent]);

      const childCode = await value(users.organizingCaregiver, "select public.create_invite($1, 'child')", [caregiverCircle]);
      await as(users.secondChild, "select public.redeem_invite($1, 'Alex')", [childCode]);
      await as(users.organizingCaregiver, "select public.approve_member($1, $2)", [caregiverCircle, users.secondChild]);

      await as(users.organizingCaregiver, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/New_York')", [caregiverCircle]);
      assert.equal(await value(users.secondParent, "select timezone from public.checkin_plans where circle_id = $1", [caregiverCircle]), "America/New_York");
    });

    test("a child who joined someone else's circle does not manage it", async () => {
      await assert.rejects(
        as(users.secondChild, "select public.create_invite($1, 'family')", [caregiverCircle]),
        /Only the person who set up this circle can invite people/,
      );
      await as(users.secondChild, "update public.checkin_plans set mode = 'selfie' where circle_id = $1", [caregiverCircle]);
      assert.equal(await value(users.organizingCaregiver, "select mode from public.checkin_plans where circle_id = $1", [caregiverCircle]), "button");
    });

    test("the organizing caregiver cannot leave their own circle", async () => {
      await assert.rejects(
        as(users.organizingCaregiver, "select public.remove_member($1, $2)", [caregiverCircle, users.organizingCaregiver]),
        /cannot leave/,
      );
    });
  });

  describe("a parent as organizer", () => {
    let ownCircle;

    test("a parent sets up their own circle and is its active parent", async () => {
      ownCircle = await value(users.selfParent, "select public.create_circle('Ruth', 'Ruth', 'parent')");
      await activate(ownCircle);
      const me = await as(users.selfParent, "select role, status from public.circle_members where circle_id = $1", [ownCircle]);
      assert.deepEqual(me.rows, [{ role: "parent", status: "active" }]);
    });

    test("they invite family, set the plan, and answer their own check-ins", async () => {
      const code = await value(users.selfParent, "select public.create_invite($1, 'family')", [ownCircle]);
      await as(users.niece, "select public.redeem_invite($1, 'Kim')", [code]);
      await as(users.selfParent, "select public.approve_member($1, $2)", [ownCircle, users.niece]);
      await as(users.selfParent, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/Denver')", [ownCircle]);
      assert.equal(await value(users.niece, "select timezone from public.checkin_plans where circle_id = $1", [ownCircle]), "America/Denver");
    });

    test("their circle cannot get a second parent", async () => {
      await assert.rejects(
        as(users.selfParent, "select public.create_invite($1, 'parent')", [ownCircle]),
        /already checks in/,
      );
    });

    test("other family members can also set up a circle", async () => {
      const familyCircle = await value(users.niece, "select public.create_circle('Aunt Bea', 'Kim', 'family')");
      assert.equal(await value(users.niece, "select role from public.circle_members where circle_id = $1", [familyCircle]), "family");
    });
  });

  describe("when a subscription lapses", () => {
    let lapsed;
    let code;

    before(async () => {
      lapsed = await value(users.payer, "select public.create_circle('Gran', 'Lee')");
      await activate(lapsed);
      code = await value(users.payer, "select public.create_invite($1, 'family')", [lapsed]);
      await activate(lapsed, new Date(Date.now() - 60_000).toISOString());
    });

    test("no one can join", async () => {
      await assert.rejects(as(users.joiner, "select public.redeem_invite($1, 'Max')", [code]), /isn't active yet/);
    });

    test("the organizer can still change settings", async () => {
      await as(users.payer, "insert into public.checkin_plans (circle_id, timezone) values ($1, 'America/Chicago')", [lapsed]);
      assert.equal(await value(users.payer, "select timezone from public.checkin_plans where circle_id = $1", [lapsed]), "America/Chicago");
    });

    test("members can see whether their circle is paid", async () => {
      assert.equal(await count(users.payer, "select circle_id from public.circle_access where circle_id = $1", [lapsed]), 1);
      assert.equal(await count(users.stranger, "select circle_id from public.circle_access"), 0);
    });
  });

  describe("store subscriptions", () => {
    let storeCircle;
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const apply = (active, source, plan, until) =>
      db.query("select public.apply_store_access($1, $2, $3, $4, $5)", [users.storeBuyer, active, source, plan, until]);
    const access = async () =>
      (await db.query("select source, plan, active_until > now() as on from public.circle_access where circle_id = $1", [storeCircle])).rows[0];

    before(async () => {
      storeCircle = await value(users.storeBuyer, "select public.create_circle('Pat', 'Robin', 'family')");
    });

    test("the app can't apply a store result itself", async () => {
      await assert.rejects(
        as(users.storeBuyer, "select public.apply_store_access($1, true, 'apple', 'yearly', now() + interval '1 year')", [users.storeBuyer]),
        /permission denied/,
      );
    });

    test("a purchase turns on the organizer's circle", async () => {
      await apply(true, "apple", "yearly", later);
      assert.deepEqual(await access(), { source: "apple", plan: "yearly", on: true });
      assert.equal(await value(users.storeBuyer, "select public.circle_is_active($1)", [storeCircle]), true);
    });

    test("when the subscription ends, the circle turns off", async () => {
      await apply(false, null, null, null);
      assert.equal((await access()).on, false);
    });

    test("a store result doesn't cut short a longer pilot code", async () => {
      await db.query("update public.circle_access set source = 'pilot_code', plan = null, active_until = now() + interval '60 days' where circle_id = $1", [storeCircle]);
      await apply(true, "google", "monthly", later);
      assert.equal((await access()).source, "pilot_code");
      await apply(false, null, null, null);
      assert.equal((await access()).on, true);
      await db.query("update public.circle_access set active_until = $2 where circle_id = $1", [storeCircle, past]);
      await apply(true, "google", "monthly", later);
      assert.deepEqual(await access(), { source: "google", plan: "monthly", on: true });
    });
  });

  describe("leaving", () => {
    test("the child cannot leave their own circle", async () => {
      await assert.rejects(
        as(users.child, "select public.remove_member($1, $2)", [circle, users.child]),
        /cannot leave/,
      );
    });

    test("a removed caregiver loses access", async () => {
      await as(users.child, "select public.remove_member($1, $2)", [circle, users.caregiver]);
      assert.equal(await count(users.caregiver, "select id from public.checkins"), 0);
      assert.equal(await count(users.caregiver, "select name from storage.objects"), 0);
    });

    test("a removed person can rejoin with a new code", async () => {
      const code = await value(users.child, "select public.create_invite($1, 'family')", [circle]);
      await as(users.caregiver, "select public.redeem_invite($1, 'Pat')", [code]);
      const row = await as(users.caregiver, "select role, status from public.circle_members where user_id = $1", [users.caregiver]);
      assert.deepEqual(row.rows, [{ role: "family", status: "pending" }]);
    });
  });
});
