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

  test("only the child can make join codes", async () => {
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
    await assert.rejects(
      as(users.stranger, "select public.redeem_invite($1, 'Stranger')", [parentCode]),
      /That code is not valid/,
    );
  });

  test("an expired code is refused", async () => {
    const code = await value(users.child, "select public.create_invite($1, 'family')", [circle]);
    await db.query("update public.invites set expires_at = now() - interval '1 minute' where code = $1", [code]);
    await assert.rejects(
      as(users.stranger, "select public.redeem_invite($1, 'Stranger')", [code]),
      /That code is not valid/,
    );
  });

  test("a circle cannot get a second parent", async () => {
    await assert.rejects(
      as(users.child, "select public.create_invite($1, 'parent')", [circle]),
      /already has a parent/,
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

  test("only the child can approve", async () => {
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
        as(users.stranger, "insert into public.circles (name, created_by) values ('x', $1)", [users.stranger]),
        /permission denied/,
      );
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
