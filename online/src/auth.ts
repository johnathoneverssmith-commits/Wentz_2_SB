/**
 * Accounts and sessions, on Node's own crypto.
 *
 * A league of friends needs an identity, not an identity provider. Passwords
 * are hashed with scrypt (in the standard library, memory-hard, no native
 * build step) and sessions are signed cookies rather than a table — there is
 * no server-side session state to keep, expire, or replicate. Revoking
 * someone everywhere means changing their password: `password_changes`
 * records when, and a cookie issued before that is refused.
 *
 * The one thing worth being careful about here is that `SESSION_SECRET` has
 * to be set and stable in production: rotating it logs everyone out, and
 * leaving it at the development default would let anyone mint a cookie.
 */
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { ActionError, pool } from "./db.js";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const DEV_SECRET = "dev-only-insecure-secret";
const SECRET = process.env.SESSION_SECRET ?? DEV_SECRET;
const SESSION_DAYS = 30;

if (SECRET === DEV_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production — refusing to start.");
}

export interface User {
  id: string;
  name: string;
}

async function hash(password: string, salt: string): Promise<string> {
  return (await scryptAsync(password, salt, 64)).toString("hex");
}

/** Constant-time compare that tolerates different lengths. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function register(name: string, password: string): Promise<User> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new ActionError("Pick a name between 2 and 40 characters.");
  }
  if (password.length < 8) throw new ActionError("Use a password of at least 8 characters.");
  const salt = randomBytes(16).toString("hex");
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, trimmed, trimmed.toLowerCase(), await hash(password, salt), salt],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new ActionError("That name is taken.");
    }
    throw err;
  }
  return { id, name: trimmed };
}

export async function login(name: string, password: string): Promise<User | null> {
  const rows = await pool.query<{
    id: string;
    name: string;
    password_hash: string;
    password_salt: string;
  }>(`SELECT id, name, password_hash, password_salt FROM users WHERE name_folded = $1`, [
    name.trim().toLowerCase(),
  ]);
  const row = rows.rows[0];
  if (!row) {
    // spend the same time as a real check so a missing user isn't detectable
    await hash(password, "decoy-salt-decoy-salt");
    return null;
  }
  const attempt = await hash(password, row.password_salt);
  if (!sameSecret(attempt, row.password_hash)) return null;
  return { id: row.id, name: row.name };
}

/** `<userId>.<expiryMs>.<hmac>` — everything the server needs, nothing it stores. */
export function signSession(userId: string): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const body = `${userId}.${expires}`;
  const mac = createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${mac}`;
}

export function readSession(token: string | undefined): { userId: string; issuedAt: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts as [string, string, string];
  const expected = createHmac("sha256", SECRET).update(`${userId}.${expires}`).digest("hex");
  if (!sameSecret(mac, expected)) return null;
  if (Number(expires) < Date.now()) return null;
  return { userId, issuedAt: Number(expires) - SESSION_DAYS * 86_400_000 };
}

/**
 * The account, or null. Given a session's `issuedAt`, also null when the
 * password changed after that session was issued.
 */
export async function userById(id: string, issuedAt?: number): Promise<User | null> {
  const rows = await pool.query<{ id: string; name: string; changed_at: Date | null }>(
    `SELECT u.id, u.name, c.changed_at
       FROM users u LEFT JOIN password_changes c ON c.user_id = u.id
      WHERE u.id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (issuedAt != null && row.changed_at && issuedAt < row.changed_at.getTime()) return null;
  return { id: row.id, name: row.name };
}

/** A new password, and every session issued before now signed out. */
async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < 8) throw new ActionError("Use a password of at least 8 characters.");
  const salt = randomBytes(16).toString("hex");
  await pool.query(`UPDATE users SET password_hash = $2, password_salt = $3 WHERE id = $1`, [
    userId,
    await hash(password, salt),
    salt,
  ]);
  // a second back, so the fresh cookie the caller gets next isn't itself
  // older than the change
  await pool.query(
    `INSERT INTO password_changes (user_id, changed_at) VALUES ($1, now() - interval '1 second')
     ON CONFLICT (user_id) DO UPDATE SET changed_at = EXCLUDED.changed_at`,
    [userId],
  );
  await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);
}

/** A signed-in GM changing their own password. */
export async function changePassword(user: User, current: string, next: string): Promise<void> {
  if (!(await login(user.name, current))) {
    throw new ActionError("Your current password isn't right.", 401);
  }
  await setPassword(user.id, next);
}

const RESET_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RESET_HOURS = 24;

/**
 * A one-time code for a GM who can't sign in, issued by their commissioner.
 * Replaces any earlier code for that account. Only its hash is stored.
 */
export async function issueResetCode(userId: string, issuedBy: string): Promise<string> {
  const code = Array.from(randomBytes(10), (b) => RESET_ALPHABET[b % RESET_ALPHABET.length]).join("");
  const salt = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO password_resets (user_id, code_hash, code_salt, issued_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
     ON CONFLICT (user_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, code_salt = EXCLUDED.code_salt,
           issued_by = EXCLUDED.issued_by, expires_at = EXCLUDED.expires_at`,
    [userId, await hash(code, salt), salt, issuedBy, RESET_HOURS],
  );
  return code;
}

/** Spend a reset code on a new password. Null when the name or code is wrong. */
export async function redeemResetCode(name: string, code: string, password: string): Promise<User | null> {
  const rows = await pool.query<{ id: string; name: string; code_hash: string; code_salt: string }>(
    `SELECT u.id, u.name, r.code_hash, r.code_salt
       FROM users u JOIN password_resets r ON r.user_id = u.id
      WHERE u.name_folded = $1 AND r.expires_at > now()`,
    [name.trim().toLowerCase()],
  );
  const row = rows.rows[0];
  const typed = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!row) {
    // the same time as a real check, so a name without a code isn't detectable
    await hash(typed, "decoy-salt-decoy-salt");
    return null;
  }
  if (!sameSecret(await hash(typed, row.code_salt), row.code_hash)) return null;
  await setPassword(row.id, password);
  return { id: row.id, name: row.name };
}

/**
 * Which team in this league the caller is allowed to act for.
 *
 * Every action endpoint runs this before doing anything. Owning a team is
 * the only authority in the game besides being commissioner, and the check
 * is against the database rather than anything the client sent.
 */
export async function franchiseOf(
  leagueId: string,
  userId: string,
): Promise<{ teamCode: string; gmId: string } | null> {
  const rows = await pool.query<{ team_code: string; gm_id: string }>(
    `SELECT team_code, gm_id FROM franchises WHERE league_id = $1 AND user_id = $2`,
    [leagueId, userId],
  );
  const row = rows.rows[0];
  return row ? { teamCode: row.team_code, gmId: row.gm_id } : null;
}

export async function isCommissioner(leagueId: string, userId: string): Promise<boolean> {
  const rows = await pool.query<{ ok: boolean }>(
    `SELECT commissioner = $2 AS ok FROM leagues WHERE id = $1`,
    [leagueId, userId],
  );
  return rows.rows[0]?.ok ?? false;
}
