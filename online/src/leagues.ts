/**
 * Creating a league, inviting people to it, and claiming a team.
 *
 * The shape is deliberately the smallest thing that works for a group of
 * friends: one person makes a league and gets a code, everyone else uses the
 * code once to take a team, and whatever nobody takes stays on the AI. There
 * is no lobby, no matchmaking and no public directory, because none of those
 * are what this is for.
 */
import { randomUUID } from "node:crypto";

import type { LeagueConfig, LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

import { ActionError, pool } from "./db.js";

/** Short, unambiguous, sayable down a phone. No O/0 or I/1. */
function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export interface CreateLeagueInput {
  name: string;
  /** How many teams humans may claim; the rest run themselves. */
  humanSlots?: number | undefined;
  config?: Partial<LeagueConfig> | undefined;
  phaseTimeoutHours?: number | undefined;
  pickTimeoutHours?: number | undefined;
}

export async function createOnlineLeague(
  commissionerId: string,
  input: CreateLeagueInput,
): Promise<{ leagueId: string; inviteCode: string }> {
  const name = input.name.trim();
  if (name.length < 2) throw new ActionError("Give the league a name.");
  const humanSlots = Math.min(32, Math.max(1, input.humanSlots ?? 8));

  // The same generator the single-player game uses, so an online league and a
  // local one are the same object — that's what lets the rules be shared.
  const config: LeagueConfig = { ...DEFAULT_CONFIG, ...input.config, humanGmCount: humanSlots };
  const state: LeagueState = createLeague(Date.now() % 100_000, config);

  // Nobody has claimed anything yet, so every GM slot starts unowned. The
  // single-player seed hands GM 1 to "You" and pre-assigns the rest; online,
  // teams are taken by people, so clear them all.
  //
  // `isHuman` has to go too, and it is the more important half. A slot nobody
  // has claimed is not a person — and `humanGate` waits for every human GM to
  // mark themselves ready before a stage can advance. Leaving these true
  // meant a league sat at setup forever, blocked on GMs who did not exist,
  // showing "2 of 4 ready" with no way to ever reach 4. `claimTeam` sets it
  // back to true when a real person takes the slot.
  for (const gm of state.gms) {
    gm.teamCode = "";
    gm.isHuman = false;
  }
  for (const code of Object.keys(state.teams)) state.teams[code]!.controlledBy = { kind: "ai" };

  const id = randomUUID();
  const code = inviteCode();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO leagues (id, name, commissioner, invite_code, phase_timeout_hours, pick_timeout_hours)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        name,
        commissionerId,
        code,
        input.phaseTimeoutHours ?? 48,
        input.pickTimeoutHours ?? 12,
      ],
    );
    await client.query(
      `INSERT INTO league_state (league_id, state, season, stage, week)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, state, state.season, state.stage, state.week],
    );
    // One franchise row per GM slot. `team_code` is empty until someone picks,
    // so the primary key can't be (league, team) yet — use the gm id.
    for (const gm of state.gms) {
      await client.query(
        `INSERT INTO franchises (league_id, team_code, user_id, gm_id) VALUES ($1, $2, NULL, $3)`,
        [id, `unclaimed:${gm.id}`, gm.id],
      );
    }
    await client.query(
      `INSERT INTO events (league_id, actor_user, kind, summary)
       VALUES ($1, $2, 'league.created', $3)`,
      [id, commissionerId, `${name} was created.`],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { leagueId: id, inviteCode: code };
}

/**
 * Retire the phantom GMs in leagues that were created before the fix above.
 *
 * Those leagues have unclaimed slots marked `isHuman`, which `humanGate`
 * reads as people who have not marked ready yet — so they are stuck at their
 * current stage with no way forward, and no amount of claiming fixes it,
 * because the empty slots outlive every claim. A GM with no team in an online
 * league has never been claimed (claiming assigns the team in the same
 * transaction), so the empty-team test is exactly the unclaimed set.
 *
 * It also puts the owner's real name back on any slot claimed before the
 * name was recorded, for the same reason and from the same authority — the
 * franchise row already says who holds it.
 *
 * Runs at boot, writes only the leagues that actually change, and is safe to
 * run repeatedly.
 */
export async function repairUnclaimedGms(): Promise<number> {
  const rows = await pool.query<{ league_id: string; state: LeagueState }>(
    `SELECT league_id, state FROM league_state`,
  );
  // who actually owns each slot, for leagues claimed before the name of the
  // person claiming it was recorded on the GM
  const owners = await pool.query<{ league_id: string; gm_id: string; name: string }>(
    `SELECT f.league_id, f.gm_id, u.name
       FROM franchises f JOIN users u ON u.id = f.user_id
      WHERE f.user_id IS NOT NULL`,
  );
  const nameOf = new Map(owners.rows.map((r) => [`${r.league_id}:${r.gm_id}`, r.name]));

  let fixed = 0;
  for (const row of rows.rows) {
    const state = row.state;
    if (!Array.isArray(state?.gms)) continue;
    let changed = false;
    for (const gm of state.gms) {
      if (!gm.teamCode && gm.isHuman) {
        gm.isHuman = false;
        changed = true;
      }
      // a real person still wearing the seed's invented AI name
      const owner = nameOf.get(`${row.league_id}:${gm.id}`);
      if (owner && gm.name !== owner) {
        gm.name = owner;
        changed = true;
      }
    }
    if (!changed) continue;
    await pool.query(
      `UPDATE league_state SET state = $2, version = version + 1, updated_at = now()
        WHERE league_id = $1`,
      [row.league_id, state],
    );
    fixed++;
  }
  return fixed;
}

export async function leagueByInvite(code: string): Promise<{ id: string; name: string } | null> {
  const rows = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM leagues WHERE invite_code = $1 AND archived_at IS NULL`,
    [code.trim().toUpperCase()],
  );
  return rows.rows[0] ?? null;
}

/**
 * Takes a team, if it's still going.
 *
 * Two people clicking the same team at the same moment is the obvious race,
 * and the unique index on (league_id, team_code) is what actually settles it —
 * the second insert fails rather than both succeeding. The check before it is
 * there to give the loser a sentence rather than a constraint violation.
 */
export async function claimTeam(
  leagueId: string,
  userId: string,
  teamCode: string,
): Promise<{ teamCode: string; gmId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const already = await client.query(
      `SELECT team_code FROM franchises WHERE league_id = $1 AND user_id = $2`,
      [leagueId, userId],
    );
    if (already.rows[0]) throw new ActionError("You already have a team in this league.");

    const taken = await client.query(
      `SELECT 1 FROM franchises WHERE league_id = $1 AND team_code = $2 AND user_id IS NOT NULL`,
      [leagueId, teamCode],
    );
    if (taken.rows[0]) throw new ActionError("Someone just took that team.", 409);

    const slot = await client.query<{ gm_id: string; team_code: string }>(
      `SELECT gm_id, team_code FROM franchises
        WHERE league_id = $1 AND user_id IS NULL AND team_code LIKE 'unclaimed:%'
        ORDER BY gm_id LIMIT 1 FOR UPDATE`,
      [leagueId],
    );
    const open = slot.rows[0];
    if (!open) throw new ActionError("This league is full.", 409);

    await client.query(
      `UPDATE franchises SET team_code = $3, user_id = $4
        WHERE league_id = $1 AND team_code = $2`,
      [leagueId, open.team_code, teamCode, userId],
    );

    // and the same thing inside the league document the rules read
    const stateRows = await client.query<{ state: LeagueState; version: string }>(
      `SELECT state, version FROM league_state WHERE league_id = $1 FOR UPDATE`,
      [leagueId],
    );
    const row = stateRows.rows[0];
    if (!row) throw new ActionError("No such league.", 404);
    const state = row.state;
    const gm = state.gms.find((g) => g.id === open.gm_id);
    if (gm) {
      gm.teamCode = teamCode;
      gm.isHuman = true;
      // The slot still carries the name the single-player seed invented for
      // whichever AI GM used to hold it, so a real person showed up around the
      // league as "Priya" or "Marcus" — in the standings, in trade offers, in
      // the weekly notes. Take the account's name instead; it is what they
      // chose and what the other GMs know them by.
      const named = await client.query<{ name: string }>(
        `SELECT name FROM users WHERE id = $1`,
        [userId],
      );
      const name = named.rows[0]?.name;
      if (name) gm.name = name;
    }
    if (state.teams[teamCode]) {
      state.teams[teamCode]!.controlledBy = { kind: "human", gmId: open.gm_id };
    }
    await client.query(
      `UPDATE league_state SET state = $2, version = version + 1, updated_at = now()
        WHERE league_id = $1`,
      [leagueId, state],
    );
    await client.query(
      `INSERT INTO events (league_id, actor_user, team_code, kind, summary)
       VALUES ($1, $2, $3, 'league.claimed', $4)`,
      [leagueId, userId, teamCode, `${teamCode} was claimed.`],
    );
    await client.query("COMMIT");
    return { teamCode, gmId: open.gm_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if ((err as { code?: string }).code === "23505") {
      throw new ActionError("Someone just took that team.", 409);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The leagues a user is in, for the front page.
 *
 * "In" has to include the commissioner who just created one and hasn't taken
 * a team yet. Joining against their own franchise row excluded precisely that
 * person: the league they had just made did not come back in this list, so
 * there was nothing to click to claim a team, and a newly created league was
 * unplayable by the one person guaranteed to be looking for it. The
 * `unclaimed:` branch below was written for that case and could never fire.
 *
 * The invite code rides along for the commissioner because it is otherwise
 * shown once, at creation, and never again — reload before sending it and
 * nobody can ever join the league.
 */
export async function leaguesFor(userId: string): Promise<
  {
    id: string;
    name: string;
    teamCode: string | null;
    stage: string;
    season: number;
    isCommissioner: boolean;
    inviteCode: string | null;
  }[]
> {
  const rows = await pool.query(
    `SELECT l.id, l.name, f.team_code, s.stage, s.season,
            (l.commissioner = $1) AS is_commissioner, l.invite_code
       FROM leagues l
       LEFT JOIN franchises f ON f.league_id = l.id AND f.user_id = $1
       JOIN league_state s ON s.league_id = l.id
      WHERE l.archived_at IS NULL
        AND (f.user_id = $1 OR l.commissioner = $1)
      ORDER BY l.created_at DESC`,
    [userId],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    teamCode:
      r.team_code == null || String(r.team_code).startsWith("unclaimed:") ? null : r.team_code,
    stage: r.stage,
    season: r.season,
    isCommissioner: Boolean(r.is_commissioner),
    // the code is the league's only door; it belongs to whoever runs it
    inviteCode: r.is_commissioner ? r.invite_code : null,
  }));
}

/** Teams nobody has taken yet, for the claim screen. */
export async function openTeams(leagueId: string): Promise<string[]> {
  const rows = await pool.query<{ state: LeagueState }>(
    `SELECT state FROM league_state WHERE league_id = $1`,
    [leagueId],
  );
  const state = rows.rows[0]?.state;
  if (!state) throw new ActionError("No such league.", 404);
  const claimed = await pool.query<{ team_code: string }>(
    `SELECT team_code FROM franchises WHERE league_id = $1 AND user_id IS NOT NULL`,
    [leagueId],
  );
  const taken = new Set(claimed.rows.map((r) => r.team_code));
  return Object.keys(state.teams).filter((c) => !taken.has(c));
}
