// Shared setup for database tests: an in-memory Postgres with stand-ins for
// Supabase's auth, storage, pg_cron and pg_net, plus every migration applied.

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

export async function createDatabase(userIds = []) {
  const db = new PGlite();
  await db.exec(await readFile(path.join(here, "supabase-stubs.sql"), "utf8"));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  for (const id of userIds) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
  }
  return db;
}

// Runs SQL as a signed-in user, the way the app's requests reach the database.
export function signedIn(db) {
  return async function as(uid, sql, params = [], { anonymous = false } = {}) {
    return db.transaction(async (tx) => {
      await tx.query(
        "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
        [uid, JSON.stringify({ sub: uid, role: "authenticated", is_anonymous: anonymous })],
      );
      await tx.exec("set local role authenticated");
      return tx.query(sql, params);
    });
  };
}
