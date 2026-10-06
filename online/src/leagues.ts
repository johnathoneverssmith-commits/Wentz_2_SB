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

import type { DeadlineChoice, LeagueConfig, LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { cleanConfigPatch } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { syncAiGms } from "@/state/aiGms.ts";

import { ActionError, pool, withLeague } from "./db.js";
import { runPendingCpuTurns } from "./decide.js";
import { deadlineFor, readyUpLocal } from "./phases.js";

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
  if (name.length > 60) throw new ActionError("Keep the league's name to 60 characters.");
  const humanSlots = Math.min(32, Math.max(1, input.humanSlots ?? 8));
  // the clocks as the form offers them, not whatever number arrives: a zero
  // hour phase autopiloted every GM on the first sweep
  const phaseHours = Math.min(168, Math.max(1, Math.round(input.phaseTimeoutHours ?? 48)));
  const pickHours = Math.min(48, Math.max(1, Math.round(input.pickTimeoutHours ?? 12)));

  // The rules pass the same check the commissioner's later changes do; they
  // used to be spread in as sent, any key and any value.
  const { gameDayDeadlineHours, offseasonStageDeadlineHours, ...rules } = (input.config ?? {}) as Partial<LeagueConfig>;
  const clean = cleanConfigPatch({ stage: "setup", config: DEFAULT_CONFIG } as LeagueState, rules as Record<string, unknown>);
  if (!clean.ok) throw new ActionError(clean.reason);
  const deadline = (v: unknown): DeadlineChoice | undefined =>
    ([2, 6, 12, 24, 48] as const).find((c) => c === v);

  // The same generator the single-player game uses, so an online league and a
  // local one are the same object — that's what lets the rules be shared.
  const config: LeagueConfig = {
    ...DEFAULT_CONFIG,
    // an online league is played over days: three rounds of the annual draft
    // and of free agency by hand unless the commissioner says otherwise
    draftHumanRounds: 3,
    faHumanRounds: 3,
    ...clean.patch,
    ...(deadline(gameDayDeadlineHours) ? { gameDayDeadlineHours: deadline(gameDayDeadlineHours)! } : {}),
    ...(deadline(offseasonStageDeadlineHours)
      ? { offseasonStageDeadlineHours: deadline(offseasonStageDeadlineHours)! }
      : {}),
    humanGmCount: humanSlots,
  };
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
  syncAiGms(state);

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
        phaseHours,
        pickHours,
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

export async function leagueByInvite(
  code: string,
): Promise<{ id: string; name: string; season: number; stage: string } | null> {
  // season and stage too: someone joining a league years in takes a team as
  // it stands, and the join screen told them they could switch until kickoff
  const rows = await pool.query<{ id: string; name: string; season: number; stage: string }>(
    `SELECT l.id, l.name, s.season, s.stage
       FROM leagues l JOIN league_state s ON s.league_id = l.id
      WHERE l.invite_code = $1 AND l.archived_at IS NULL`,
    // pasted from a message it arrives with spaces, dashes or quotes around it
    [code.toUpperCase().replace(/[^A-Z0-9]/g, "")],
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
  // Through `withLeague`, like every other change to a league: it used to
  // write the document on its own, so the other GMs' open pages weren't told
  // (they found out on their next poll) and the server's cached copy of the
  // league was bypassed.
  try {
    const { result } = await withLeague(
      leagueId,
      async ({ state }, client) => {
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

        // a seat the commissioner reopened (`vacateSeat`) is taken as that team;
        // otherwise the next never-claimed slot
        const vacated = await client.query<{ gm_id: string; team_code: string }>(
          `SELECT gm_id, team_code FROM franchises
            WHERE league_id = $1 AND user_id IS NULL AND team_code = $2 FOR UPDATE`,
          [leagueId, teamCode],
        );
        const slot = vacated.rows[0]
          ? vacated
          : await client.query<{ gm_id: string; team_code: string }>(
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
        const gm = state.gms.find((g) => g.id === open.gm_id);
        const named = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
        const name = named.rows[0]?.name;
        if (gm) {
          gm.teamCode = teamCode;
          gm.isHuman = true;
          delete state.readiness[gm.id];
          // The slot still carries the name the single-player seed invented for
          // whichever AI GM used to hold it, so a real person showed up around the
          // league as "Priya" or "Marcus" — in the standings, in trade offers, in
          // the weekly notes. Take the account's name instead; it is what they
          // chose and what the other GMs know them by.
          if (name) gm.name = name;
          // a seat with seasons already played under someone else: the score
          // tracker counts this GM from the next unplayed one
          const played = state.history.filter((h) => h.gmId === gm.id).map((h) => h.season);
          if (played.length > 0) gm.joinedSeason = Math.max(...played) + 1;
          else delete gm.joinedSeason;
        }
        if (state.teams[teamCode]) {
          state.teams[teamCode]!.controlledBy = { kind: "human", gmId: open.gm_id };
          syncAiGms(state);
        }
        const label = TEAMS_BY_CODE[teamCode]?.label ?? teamCode;
        return {
          result: { teamCode, gmId: open.gm_id },
          state,
          // "KC was claimed." said nothing about who had arrived
          events: [{ teamCode, kind: "league.claimed", summary: name ? `${name} took over ${label}.` : `${label} was claimed.` }],
        };
      },
      { actorUserId: userId },
    );
    return result;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new ActionError("Someone just took that team.", 409);
    }
    throw err;
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
    /** Seats nobody holds — the invite code only matters while there are some. */
    openSeats: number;
  }[]
> {
  const rows = await pool.query(
    `SELECT l.id, l.name, f.team_code, s.stage, s.season,
            (l.commissioner = $1) AS is_commissioner, l.invite_code,
            (SELECT count(*) FROM franchises o WHERE o.league_id = l.id AND o.user_id IS NULL) AS open_seats
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
    openSeats: Number(r.open_seats ?? 0),
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
  const seats = await pool.query<{ team_code: string; user_id: string | null }>(
    `SELECT team_code, user_id FROM franchises WHERE league_id = $1`,
    [leagueId],
  );
  // once every seat has been claimed, only a reopened seat's team is open —
  // any other team would have no seat to go with it
  const vacated = seats.rows
    .filter((r) => r.user_id === null && !r.team_code.startsWith("unclaimed:"))
    .map((r) => r.team_code);
  if (!seats.rows.some((r) => r.user_id === null && r.team_code.startsWith("unclaimed:"))) {
    return vacated.sort();
  }
  const taken = new Set(seats.rows.filter((r) => r.user_id !== null).map((r) => r.team_code));
  // alphabetical: the league's own key order put seven teams (whichever the
  // setup touched first) ahead of an otherwise alphabetical list
  return Object.keys(state.teams)
    .filter((c) => !taken.has(c))
    .sort();
}

/**
 * The commissioner reopens a GM's seat: someone quit, or went quiet for good.
 *
 * The team is the CPU's from this moment — its GM stops counting toward
 * readiness, so the league no longer waits a full phase clock on them at
 * every stage — and it is listed as open under the league's invite code.
 * Whoever claims it takes over this team, as it stands.
 */
export async function vacateSeat(
  leagueId: string,
  commissionerId: string,
  teamCode: string,
  /** A GM giving up their own seat, rather than the commissioner opening one. */
  leaving = false,
): Promise<{ ok: true }> {
  await withLeague(leagueId, async ({ state, league }, client) => {
    const seat = await client.query<{ gm_id: string; user_id: string | null }>(
      `SELECT gm_id, user_id FROM franchises WHERE league_id = $1 AND team_code = $2 FOR UPDATE`,
      [leagueId, teamCode],
    );
    const row = seat.rows[0];
    if (!row || !row.user_id) throw new ActionError("Nobody holds that team.");
    if (!leaving && row.user_id === commissionerId) throw new ActionError("That's your own team.");
    await client.query(`UPDATE franchises SET user_id = NULL WHERE league_id = $1 AND team_code = $2`, [
      leagueId,
      teamCode,
    ]);
    const gm = state.gms.find((g) => g.id === row.gm_id);
    const was = gm?.name ?? teamCode;
    if (gm) {
      gm.isHuman = false;
      gm.name = "Open seat";
      delete state.readiness[gm.id];
    }
    if (state.teams[teamCode]) state.teams[teamCode]!.controlledBy = { kind: "ai" };
    syncAiGms(state);
    // if that team was on the clock, its turn is the CPU's now — take it
    runPendingCpuTurns(state);
    // everyone else may have checked in already, waiting only on this GM:
    // nothing would ever press "ready" again to move the league on
    const moved = readyUpLocal(state);
    return {
      result: null,
      state,
      ...(moved ? { phaseEndsAt: deadlineFor(state, league) } : {}),
      events: [
        {
          teamCode,
          kind: "league.vacated",
          summary: leaving
            ? `${was} left the league; the CPU runs ${teamCode} until someone claims it.`
            : `The commissioner opened ${teamCode}'s seat; ${was} is out and the CPU runs the team until someone claims it.`,
        },
      ],
    };
  });
  return { ok: true };
}

/**
 * The commissioner hands the role to another GM in the league.
 *
 * There was no way to: a commissioner who stopped playing left a league that
 * nobody could force past a stuck check-in or reopen a seat in, and — since
 * the commissioner can't leave — nobody could ever replace them either.
 */
/**
 * The commissioner changes the per-turn clock.
 *
 * It was fixed at creation, so a league whose GMs kept timing out on a 12-hour
 * clock — or one that wanted to move faster — had no way to adjust but to
 * start over. It applies from the next turn; the one running keeps its clock.
 */
export async function setTurnHours(leagueId: string, commissionerId: string, hours: number): Promise<{ ok: true }> {
  if (![1, 4, 12, 24, 48].includes(hours)) throw new ActionError("Pick 1, 4, 12, 24 or 48 hours.");
  await withLeague(leagueId, async ({ state }, client) => {
    const current = await client.query<{ commissioner: string }>(
      `SELECT commissioner FROM leagues WHERE id = $1 FOR UPDATE`,
      [leagueId],
    );
    if (current.rows[0]?.commissioner !== commissionerId) {
      throw new ActionError("Only the commissioner can do that.", 403);
    }
    await client.query(`UPDATE leagues SET pick_timeout_hours = $2 WHERE id = $1`, [leagueId, hours]);
    return {
      result: null,
      state,
      events: [{ kind: "league.settings", summary: `Turns now run on a ${hours}-hour clock, from the next one.` }],
    };
  });
  return { ok: true };
}

export async function transferCommissioner(
  leagueId: string,
  commissionerId: string,
  teamCode: string,
): Promise<{ ok: true }> {
  await withLeague(leagueId, async ({ state }, client) => {
    const current = await client.query<{ commissioner: string }>(
      `SELECT commissioner FROM leagues WHERE id = $1 FOR UPDATE`,
      [leagueId],
    );
    if (current.rows[0]?.commissioner !== commissionerId) {
      throw new ActionError("Only the commissioner can do that.", 403);
    }
    const seat = await client.query<{ user_id: string | null }>(
      `SELECT user_id FROM franchises WHERE league_id = $1 AND team_code = $2`,
      [leagueId, teamCode],
    );
    const next = seat.rows[0]?.user_id;
    if (!next) throw new ActionError("Nobody holds that team.");
    if (next === commissionerId) throw new ActionError("You're already the commissioner.");
    await client.query(`UPDATE leagues SET commissioner = $2 WHERE id = $1`, [leagueId, next]);
    const name = state.gms.find((g) => g.isHuman && g.teamCode === teamCode)?.name ?? teamCode;
    return {
      result: null,
      state,
      events: [{ teamCode, kind: "league.commissioner", summary: `${name} is now the commissioner.` }],
    };
  });
  return { ok: true };
}

/**
 * A GM leaving: their seat opens exactly as if the commissioner had opened
 * it. There was no way out of a league short of never opening it again, and
 * the league then waited a full phase clock on them at every stage.
 */
export async function leaveLeague(leagueId: string, userId: string): Promise<{ ok: true }> {
  const rows = await pool.query<{ team_code: string; commissioner: string }>(
    `SELECT f.team_code, l.commissioner FROM franchises f JOIN leagues l ON l.id = f.league_id
      WHERE f.league_id = $1 AND f.user_id = $2`,
    [leagueId, userId],
  );
  const row = rows.rows[0];
  if (!row || row.team_code.startsWith("unclaimed:")) throw new ActionError("You don't have a team in this league.");
  // the league would be left with nobody able to run it
  if (row.commissioner === userId) {
    throw new ActionError(
      "You're the commissioner — hand the role to another GM first (manage → make commissioner, beside their name at any check-in), or archive the league.",
    );
  }
  return vacateSeat(leagueId, userId, row.team_code, true);
}

/** The commissioner retires a league: it leaves every lobby and can't be joined. */
export async function archiveLeague(leagueId: string, userId: string): Promise<{ ok: true }> {
  const done = await pool.query(
    `UPDATE leagues SET archived_at = now() WHERE id = $1 AND commissioner = $2 AND archived_at IS NULL`,
    [leagueId, userId],
  );
  if (done.rowCount === 0) throw new ActionError("Only the commissioner can archive this league.", 403);
  return { ok: true };
}

/** How long a commissioner can be gone before another GM may take over. */
export const COMMISSIONER_AWAY_DAYS = 7;

/**
 * A GM looked at their league. Kept to once an hour per GM, because this
 * runs on every read and poll.
 */
export async function touchSeen(leagueId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE franchises SET last_seen_at = now()
      WHERE league_id = $1 AND user_id = $2
        AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')`,
    [leagueId, userId],
  );
  // a commissioner with no team has no franchise row to record it on
  await pool.query(
    `UPDATE leagues SET commissioner_seen_at = now()
      WHERE id = $1 AND commissioner = $2
        AND (commissioner_seen_at IS NULL OR commissioner_seen_at < now() - interval '1 hour')`,
    [leagueId, userId],
  );
}

const AWAY_SQL = `
  SELECT (l.created_at < now() - make_interval(days => $2))
     AND NOT (COALESCE(l.commissioner_seen_at > now() - make_interval(days => $2), FALSE))
     AND NOT EXISTS (SELECT 1 FROM franchises f
                      WHERE f.league_id = l.id AND f.user_id = l.commissioner
                        AND f.last_seen_at > now() - make_interval(days => $2))
     AND NOT EXISTS (SELECT 1 FROM events e
                      WHERE e.league_id = l.id AND e.actor_user = l.commissioner
                        AND e.at > now() - make_interval(days => $2)) AS away,
         l.commissioner
    FROM leagues l WHERE l.id = $1`;

/**
 * Whether the commissioner has been gone long enough for someone else to
 * take the role: no visit and no action for a week. Visits are only
 * recorded from this release on, so their actions count too, and a new
 * league is never "abandoned".
 */
export async function commissionerAway(leagueId: string): Promise<boolean> {
  const r = await pool.query<{ away: boolean }>(AWAY_SQL, [leagueId, COMMISSIONER_AWAY_DAYS]);
  return Boolean(r.rows[0]?.away);
}

/**
 * A GM takes the commissioner's role from one who has gone quiet.
 *
 * The one thing nobody could fix: a commissioner who stopped playing left a
 * league that no one could move past a stuck check-in, reopen a seat in, or
 * hand the role on from — only the commissioner could do any of those.
 */
export async function claimCommissioner(leagueId: string, userId: string): Promise<{ ok: true }> {
  await withLeague(leagueId, async ({ state }, client) => {
    const lock = await client.query(`SELECT commissioner FROM leagues WHERE id = $1 FOR UPDATE`, [leagueId]);
    if (!lock.rows[0]) throw new ActionError("No such league.", 404);
    const seat = await client.query<{ team_code: string }>(
      `SELECT team_code FROM franchises WHERE league_id = $1 AND user_id = $2`,
      [leagueId, userId],
    );
    const team = seat.rows[0]?.team_code;
    if (!team || team.startsWith("unclaimed:")) throw new ActionError("You don't have a team in this league.", 403);
    const r = await client.query<{ away: boolean; commissioner: string }>(AWAY_SQL, [leagueId, COMMISSIONER_AWAY_DAYS]);
    if (r.rows[0]?.commissioner === userId) throw new ActionError("You're already the commissioner.");
    if (!r.rows[0]?.away) {
      throw new ActionError(
        `The commissioner has been around in the last ${COMMISSIONER_AWAY_DAYS} days — ask them to hand the role over.`,
      );
    }
    await client.query(`UPDATE leagues SET commissioner = $2 WHERE id = $1`, [leagueId, userId]);
    const name = state.gms.find((g) => g.isHuman && g.teamCode === team)?.name ?? team;
    return {
      result: null,
      state,
      events: [
        {
          teamCode: team,
          kind: "league.commissioner",
          summary: `${name} took over as commissioner — the last one hadn't been around for ${COMMISSIONER_AWAY_DAYS} days.`,
        },
      ],
    };
  }, { actorUserId: userId });
  return { ok: true };
}
