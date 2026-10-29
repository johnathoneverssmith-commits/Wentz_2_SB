/**
 * Whether the person who made a request still holds the seat it was made for.
 *
 * `actorFor` resolves a caller's seat from `franchises` BEFORE the league's
 * transaction takes its lock, and a request can then wait behind another
 * writer for as long as that writer holds the lock — a block of games being
 * played, say. If the commissioner vacates the seat in that time, or someone
 * else claims it (taking the same `gmId`), the request used to run anyway,
 * for a team that was no longer the caller's (audit D5).
 *
 * So the seat is read again, inside the transaction, once the lock is held.
 * Vacating, claiming and a fired GM's move to a new job all happen inside the
 * same lock, so what is read here cannot change before this request commits.
 */
import type pg from "pg";

import type { LeagueState } from "@/domain";

import { ActionError } from "./db.js";

export interface Seat {
  leagueId: string;
  userId: string;
  teamCode: string;
  gmId: string;
}

export async function assertSeatHeld(client: pg.PoolClient, seat: Seat, state: LeagueState): Promise<void> {
  const row = await client.query<{ user_id: string | null; gm_id: string }>(
    `SELECT user_id, gm_id FROM franchises WHERE league_id = $1 AND team_code = $2`,
    [seat.leagueId, seat.teamCode],
  );
  const held = row.rows[0];
  const gm = state.gms.find((g) => g.id === seat.gmId);
  if (
    !held ||
    held.user_id !== seat.userId ||
    held.gm_id !== seat.gmId ||
    !gm ||
    !gm.isHuman ||
    gm.teamCode !== seat.teamCode
  ) {
    throw new ActionError(
      "Your seat in this league changed while that request was waiting, so it was not applied. Reload to see where things stand.",
      403,
    );
  }
}
