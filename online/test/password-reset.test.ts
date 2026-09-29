import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  changePassword,
  issueResetCode,
  login,
  readSession,
  redeemResetCode,
  register,
  signSession,
  userById,
} from "../src/auth.js";
import { migrate, pool } from "../src/db.js";

/**
 * Accounts have no email, so a GM who forgot their password lost their team
 * for good. Now they can change it (signing out their other devices), and a
 * commissioner can issue a one-time reset code.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const name = `reset_${Date.now()}`;
let userId = "";

beforeAll(async () => {
  if (!url) return;
  try {
    await pool.query("SELECT 1");
    await migrate();
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable) return;
  userId = (await register(name, "first-password")).id;
});

afterAll(async () => {
  if (reachable && userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
  await pool.end().catch(() => {});
});

const maybe = (title: string, fn: () => Promise<void>) =>
  it(url ? title : `${title} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

/** A session cookie issued `agoMs` ago, as the server would read it. */
const sessionFrom = (agoMs: number) => {
  const real = Date.now;
  Date.now = () => real() - agoMs;
  try {
    return readSession(signSession(userId))!;
  } finally {
    Date.now = real;
  }
};

describe("changing a password", () => {
  maybe("needs the current one", async () => {
    await expect(changePassword({ id: userId, name }, "wrong-password", "second-password")).rejects.toThrow(
      /current password/,
    );
  });

  maybe("signs out the sessions issued before it, and keeps new ones", async () => {
    const before = sessionFrom(60_000);
    expect(await userById(before.userId, before.issuedAt)).not.toBeNull();
    await changePassword({ id: userId, name }, "first-password", "second-password");
    expect(await userById(before.userId, before.issuedAt), "an old device").toBeNull();
    const after = readSession(signSession(userId))!;
    expect(await userById(after.userId, after.issuedAt), "the cookie issued with the change").not.toBeNull();
    expect(await login(name, "second-password")).not.toBeNull();
    expect(await login(name, "first-password")).toBeNull();
  });
});

describe("a commissioner's reset code", () => {
  maybe("sets a new password once, and only with the right code", async () => {
    const code = await issueResetCode(userId, "commissioner");
    expect(await redeemResetCode(name, "WRONGCODE1", "third-password")).toBeNull();
    // typed loosely: lower case, with a space
    const typed = `${code.slice(0, 5).toLowerCase()} ${code.slice(5)}`;
    expect(await redeemResetCode(name, typed, "third-password")).not.toBeNull();
    expect(await login(name, "third-password")).not.toBeNull();
    expect(await redeemResetCode(name, code, "fourth-password"), "a spent code").toBeNull();
  });

  maybe("refuses a short password without spending the code", async () => {
    const code = await issueResetCode(userId, "commissioner");
    await expect(redeemResetCode(name, code, "short")).rejects.toThrow(/at least 8/);
    expect(await redeemResetCode(name, code, "fifth-password")).not.toBeNull();
  });
});
