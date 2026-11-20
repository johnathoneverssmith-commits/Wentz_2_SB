/**
 * Online scouting: the server-held half.
 *
 * What a report is, what it costs and who may buy one live in `ui-source/src/state/scouting.ts` and are shared with
 * the solo game. This file adds what only a server can: a secret the clients never see.
 *
 * The report noise used to be a function of `state.seed`, and the seed travels in every league pull, so a client could
 * recompute the noise and subtract it from a scouted prospect to read his hidden rating. Online, the noise is
 * HMAC-SHA256 under a random 32-byte per-league salt kept in `league_secrets`, outside the league document:
 *
 *   z(year, prospect) = Box-Muller( two 48-bit uniforms from HMAC(salt, "year|prospect|basic") )
 *
 * A pure function of (salt, year, prospect), so a retry, a restart or a second team reading the same prospect gets the
 * same report. Nothing but the salt needs to persist, and the ledger it fills is the document's own.
 *
 * Switches, all server-side:
 *   ONLINE_SCOUTING=1   the host allows it at all (default off). A league can only opt in at creation.
 *   config.scouting     the league opted in. Never changeable afterwards (`cleanConfigPatch` has no such key).
 * Either missing: no ledger opens, CPU teams buy nothing, the action refuses, the view carries no ledger.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import type pg from "pg";

import type { LeagueState } from "@/domain";
import { scoutingViewFor, setScoutingProvider, type ScoutingEnv } from "@/state/scouting.ts";

export const SALT_BYTES = 32;

/** The secret could not be had. The move is refused with this message and nothing is changed. */
export class ScoutingUnavailable extends Error {}

export const onlineScoutingAllowed = (): boolean => process.env.ONLINE_SCOUTING === "1";

/** A league is scouting online only when the host allows it and the league opted in. */
export const scoutingOn = (state: Pick<LeagueState, "config">): boolean =>
  onlineScoutingAllowed() && state.config?.scouting === true;

/** A standard normal for this (year, prospect) under this salt. */
export function saltedNormal(salt: Buffer, year: number, prospectId: string): number {
  const d = createHmac("sha256", salt).update(`${year}|${prospectId}|basic`).digest();
  const u = (at: number) => (d.readUIntBE(at, 6) + 1) / (2 ** 48 + 1); // (0, 1)
  return Math.sqrt(-2 * Math.log(u(0))) * Math.cos(2 * Math.PI * u(6));
}

export type ScoutContext =
  | { kind: "off" }
  | { kind: "on"; env: ScoutingEnv }
  | { kind: "unavailable"; reason: string };

const als = new AsyncLocalStorage<ScoutContext>();

/** Run one league transaction with its scouting context in scope. */
export const withScoutContext = <T>(ctx: ScoutContext, fn: () => Promise<T>): Promise<T> => als.run(ctx, fn);

/** The context of the transaction asking, or undefined outside one. */
export const scoutContext = (): ScoutContext | undefined => als.getStore();

// What the shared rules ask. Outside a league transaction (a unit test calling the rules directly) it is the solo default.
setScoutingProvider(() => {
  const c = als.getStore();
  if (!c) return undefined;
  if (c.kind === "off") return null;
  if (c.kind === "unavailable") throw new ScoutingUnavailable(c.reason);
  return c.env;
});

/**
 * The league's salt, created once. Called inside the league's transaction, under its row lock, so two requests cannot
 * race; ON CONFLICT DO NOTHING keeps it safe even for a second server process.
 */
export async function ensureScoutSalt(client: pg.PoolClient, leagueId: string): Promise<Buffer> {
  const read = async (): Promise<Buffer | undefined> =>
    (await client.query<{ scout_salt: Buffer }>(`SELECT scout_salt FROM league_secrets WHERE league_id = $1`, [leagueId])).rows[0]?.scout_salt;
  let salt = await read();
  if (!salt) {
    await client.query(
      `INSERT INTO league_secrets (league_id, scout_salt) VALUES ($1, $2) ON CONFLICT (league_id) DO NOTHING`,
      [leagueId, randomBytes(SALT_BYTES)],
    );
    salt = await read();
  }
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_BYTES) throw new Error("the league's scouting secret is missing or malformed");
  return salt;
}

/**
 * The context for one league transaction: what scouting does for this league right now.
 * A connection failure is rethrown as it is (the caller already answers those with a 503 "not saved"); any other
 * failure to produce the secret refuses the transaction with a message that says so, and changes nothing.
 */
export async function scoutContextFor(
  client: pg.PoolClient,
  leagueId: string,
  state: LeagueState,
  isConnectionError: (err: unknown) => boolean,
): Promise<ScoutContext> {
  if (!scoutingOn(state)) return { kind: "off" };
  try {
    const salt = await ensureScoutSalt(client, leagueId);
    return { kind: "on", env: { noise: (year, id) => saltedNormal(salt, year, id) } };
  } catch (err) {
    if (isConnectionError(err)) throw err;
    throw new ScoutingUnavailable(
      `Online scouting is unavailable: this league's secret could not be read (${err instanceof Error ? err.message : "unknown"}). Nothing was changed.`,
    );
  }
}

/**
 * What one viewer's copy of the league may carry of the ledger: their own team's reports, only while the rookie draft
 * is open, only where scouting is on. Everyone else (another GM, a commissioner without a team, a spectator) gets none.
 * The key is always written (`undefined` clears it on a client that merges), see `asViewer` in the UI's `online.ts`.
 */
export function applyScoutingView(state: LeagueState, teamCode: string | null | undefined): void {
  const open = scoutingOn(state) && state.stage === "offseasonDraft" && state.draft?.mode === "rookie" && state.scouting?.year === state.draft.year;
  if (!open || !teamCode || teamCode.startsWith("unclaimed:")) {
    delete state.scouting;
    return;
  }
  state.scouting = scoutingViewFor(state.scouting, teamCode);
}
