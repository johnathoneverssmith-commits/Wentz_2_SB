/**
 * Accounts and sessions, on Node's own crypto.
 *
 * A league of friends needs an identity, not an identity provider. Passwords
 * are hashed with scrypt (in the standard library, memory-hard, no native
 * build step) and sessions are signed cookies rather than a table — there is
 * no server-side session state to keep, expire, or replicate, and revoking
 * someone everywhere means changing their password, which is what most small
 * sites do anyway.
 *
 * The one thing worth being careful about here is that `SESSION_SECRET` has
 * to be set and stable in production: rotating it logs everyone out, and
 * leaving it at the development default would let anyone mint a cookie.
 */
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { pool } from "./db.js";

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
    throw new Error("Pick a name between 2 and 40 characters.");
  }
  if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
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
      throw new Error("That name is taken.");
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

export function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts as [string, string, string];
  const expected = createHmac("sha256", SECRET).update(`${userId}.${expires}`).digest("hex");
  if (!sameSecret(mac, expected)) return null;
  if (Number(expires) < Date.now()) return null;
  return userId;
}

export async function userById(id: string): Promise<User | null> {
  const rows = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE id = $1`,
    [id],
  );
  return rows.rows[0] ?? null;
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
