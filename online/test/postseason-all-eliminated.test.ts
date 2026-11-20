import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal } from "@/state/reveal.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { FIRST_BLOCK_LAST_WEEK, PRESEASON_WEEKS, REGULAR_SEASON_WEEKS } from "@/state/stageMachine.ts";

import { deferBlockJobs, setPostseasonSettler } from "../src/blockJobs.js";
import { decideReveal } from "../src/decide.js";
import { pool, readLeague, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { playNextPlayoffRound, postseasonIdle, readyUp, waitingOn } from "../src/phases.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * Issue #132: in an online postseason, a GM whose team is out is checked in for every round after their exit. When *every*
 * human is out, nothing was left to press the readiness gate, so the league sat on "Waiting for other players" with no button
 * until a phase deadline. These tests play real leagues through the real `readyUp` against PostgreSQL, with the server's
 * deferred block jobs switched on, as production runs.
 *
 * Everything is synthetic. Needs a database; when the run requires one (CI) it fails without one, otherwise it skips loudly.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const created: string[] = [];
const users: string[] = [];

/** A 2-human league carried, in memory, to the end of the regular season with both humans having watched every week. */
function endOfRegularSeason(): LeagueState {
  deferBlockJobs(false); // played on the spot here; the server's deferral is for the database half below
  try {
    return walkToEndOfRegularSeason();
  } finally {
    deferBlockJobs(true);
  }
}
function walkToEndOfRegularSeason(): LeagueState {
  const s = createLeague(90210, { ...DEFAULT_CONFIG, humanGmCount: 2, draftHumanRounds: 1 });
  fillRosterGaps(s);
  const humans = s.gms.slice(0, 2);
  humans.forEach((g, i) => {
    g.teamCode = ["KC", "BUF"][i]!;
    g.isHuman = true;
  });
  for (const g of s.gms.slice(2)) g.isHuman = false;
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  s.reveal = emptyReveal();
  const actor = (i: number) => ({ leagueId: "x", gmId: humans[i]!.id, teamCode: humans[i]!.teamCode, userId: `u${i}` });
  const ready = () => {
    for (const g of humans) s.readiness[g.id] = true;
    return advance(s);
  };
  for (let i = 0; i < 2; i++) decideReveal(s, actor(i), PRESEASON_WEEKS);
  ready();
  for (let i = 0; i < 2; i++) decideReveal(s, actor(i), FIRST_BLOCK_LAST_WEEK);
  ready();
  s.tradeDeadline!.done = true;
  ready();
  ready();
  s.freeAgencyEvent!.complete = true;
  ready();
  ready();
  ready();
  for (let i = 0; i < 2; i++) decideReveal(s, actor(i), REGULAR_SEASON_WEEKS);
  return s;
}

// the in-memory walk uses the same transition the server does
import { advanceIfReadyLocal } from "../src/phases.js";
const advance = (s: LeagueState) => advanceIfReadyLocal(s).stageMoved;

/** The teams in the seeded bracket if the season ended now. */
const bracketTeams = (s: LeagueState): Set<string> => {
  const b = new MockSimulationService().seedBracket(JSON.parse(JSON.stringify(s)) as LeagueState);
  return new Set(b.matchups.flatMap((m) => [m.highSeed?.code, m.lowSeed?.code]).filter((c): c is string => !!c));
};

async function makeLeague(label: string, humanTeams: [string, string], state: LeagueState) {
  const owner = `pe_${label}_a_${stamp}`;
  const guest = `pe_${label}_b_${stamp}`;
  for (const u of [owner, guest]) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
    users.push(u);
  }
  const { leagueId } = await createOnlineLeague(owner, { name: `Postseason ${label}`, humanSlots: 2 });
  created.push(leagueId);
  const a = await claimTeam(leagueId, owner, humanTeams[0]);
  const b = await claimTeam(leagueId, guest, humanTeams[1]);
  // carry the in-memory season over, keeping the seats the database made
  await withLeague(leagueId, async ({ state: db }) => {
    state.gms = db.gms.map((g, i) => ({ ...state.gms[i]!, ...g }));
    for (const code of Object.keys(state.teams)) state.teams[code]!.controlledBy = { kind: "ai" };
    state.gms.forEach((g) => {
      if (g.teamCode) state.teams[g.teamCode]!.controlledBy = { kind: "human", gmId: g.id };
    });
    state.readiness = {};
    for (const g of state.gms) state.readiness[g.id] = g.isHuman ? false : true;
    return { result: null, state, events: [] };
  });
  return { leagueId, gmA: a.gmId, gmB: b.gmId };
}

const press = (id: string, gm: string, stage: string) => readyUp(id, gm, true, stage);
const load = async (id: string) => (await readLeague(id))!.state;

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  deferBlockJobs(true); // as the server runs: stage entry queues the block, withLeague plays it
});

afterAll(async () => {
  deferBlockJobs(false);
  if (reachable) {
    for (const id of created) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    for (const u of users) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  }, 600_000);

/** Pick two CPU teams that miss the bracket (or make it) for the humans, from the season as played. */
function teamsFor(s: LeagueState, want: ("in" | "out")[]): [string, string] {
  const inB = bracketTeams(s);
  const pool = Object.keys(s.teams);
  const pick = (kind: "in" | "out", taken: string[]) =>
    pool.find((c) => (kind === "in") === inB.has(c) && !taken.includes(c))!;
  const first = pick(want[0]!, []);
  return [first, pick(want[1]!, [first])];
}

describe("the postseason with no human left to check in", () => {
  maybe("plays every round and waits for both GMs at the championship, then moves on to the offseason", async () => {
    const s = endOfRegularSeason();
    const [x, y] = teamsFor(s, ["out", "out"]);
    const { leagueId, gmA, gmB } = await makeLeague("allout", [x, y], s);

    await press(leagueId, gmA, "regularSeason");
    const entered = await press(leagueId, gmB, "regularSeason");
    expect(entered.stage).toBe("playoffs");

    // the same transaction played the rounds nobody could hold up
    const after = await load(leagueId);
    expect(after.stage).toBe("playoffs");
    expect(after.bracket?.champion, "a champion without any human pressing anything").toBeTruthy();
    for (const round of ["WC", "DIV", "CONF", "SB"]) expect(after.games.some((g) => g.phase === round), round).toBe(true);
    // the humans were never in it
    const po = after.games.filter((g) => g.phase !== "REG");
    expect(po.some((g) => [g.homeTeam, g.awayTeam].some((c) => c === x || c === y))).toBe(false);
    // and the final checkpoint waits for everybody again: nobody is stuck, somebody is asked
    expect(waitingOn(after).sort()).toEqual([x, y].sort());

    // each GM checks in; the league leaves the postseason and keeps moving
    await press(leagueId, gmA, "playoffs");
    expect((await load(leagueId)).stage).toBe("playoffs");
    const out = await press(leagueId, gmB, "playoffs");
    expect(out.stage).not.toBe("playoffs");
    const season = await load(leagueId);
    expect(season.history.some((h) => h.season === season.season)).toBe(true);
    let stage = out.stage;
    for (let i = 0; i < 4; i++) {
      await press(leagueId, gmA, stage).catch(() => {});
      const r = await press(leagueId, gmB, stage).catch(() => ({ stage }));
      if (r.stage === stage) break;
      stage = r.stage;
    }
    expect(stage, "the league kept moving through the offseason stages").not.toBe(out.stage);
  });

  maybe("with one human still competing, waits for them until they are out, then finishes the bracket", async () => {
    const s = endOfRegularSeason();
    const [x, y] = teamsFor(s, ["in", "out"]);
    const { leagueId, gmA, gmB } = await makeLeague("oneleft", [x, y], s);

    await press(leagueId, gmA, "regularSeason");
    await press(leagueId, gmB, "regularSeason");
    let now = await load(leagueId);
    expect(now.stage).toBe("playoffs");
    // the alive GM is asked; the eliminated one is not; nothing was played for them
    expect(waitingOn(now)).toEqual([x]);
    expect(now.games.some((g) => g.phase === "WC")).toBe(false);

    // each press by the competing GM plays one round, until they are out or it is over
    for (let i = 0; i < 4 && !now.bracket?.champion; i++) {
      const aliveBefore = waitingOn(now).includes(x);
      if (!aliveBefore) break;
      await press(leagueId, gmA, "playoffs");
      now = await load(leagueId);
    }
    expect(now.bracket?.champion, "the bracket is finished once the last human is out").toBeTruthy();
    expect(waitingOn(now).sort()).toEqual([x, y].sort());
  });

  maybe("a league already stuck this way is healed by the next press, and a stale refresh changes nothing", async () => {
    const s = endOfRegularSeason();
    const [x, y] = teamsFor(s, ["out", "out"]);
    const { leagueId, gmA, gmB } = await makeLeague("stuck", [x, y], s);
    // build the stuck state the old code left behind: stage playoffs, bracket seeded, nothing played, both humans ready
    setPostseasonSettler(() => false); // as the code before the fix behaved
    await withLeague(leagueId, async ({ state }) => {
      state.bracket = new MockSimulationService().seedBracket(state);
      state.stage = "playoffs";
      for (const g of state.gms) state.readiness[g.id] = true;
      return { result: null, state, events: [] };
    });
    setPostseasonSettler((st) => postseasonIdle(st) && playNextPlayoffRound(st));
    const before = await load(leagueId);
    expect(before.bracket?.champion).toBeFalsy();
    expect(waitingOn(before)).toEqual([]);

    // a GM reconnects and presses again (a refresh or a stale tab)
    await press(leagueId, gmA, "playoffs");
    const healed = await load(leagueId);
    expect(healed.bracket?.champion).toBeTruthy();

    // a second, stale press for the same stage neither replays a round nor loses the champion
    const gamesBefore = healed.games.length;
    await press(leagueId, gmB, "playoffs").catch(() => {});
    const again = await load(leagueId);
    expect(again.games.length === gamesBefore || again.stage !== "playoffs").toBe(true);
    expect(again.history.length >= healed.history.length).toBe(true);
  });

  maybe("never plays the bracket while the league is paused, and commits a settled round even when the action changed nothing", async () => {
    const s = endOfRegularSeason();
    const [x, y] = teamsFor(s, ["out", "out"]);
    const { leagueId } = await makeLeague("pause", [x, y], s);
    setPostseasonSettler(() => false); // build the old stuck state
    await withLeague(leagueId, async ({ state }) => {
      state.bracket = new MockSimulationService().seedBracket(state);
      state.stage = "playoffs";
      for (const g of state.gms) state.readiness[g.id] = true;
      state.pause = { at: new Date().toISOString(), by: "commissioner", remainingMs: null };
      return { result: null, state, events: [] };
    });
    setPostseasonSettler((st) => postseasonIdle(st) && playNextPlayoffRound(st));

    // a recovery action under the pause: the bracket must stay unplayed
    await withLeague(leagueId, async ({ state }) => ({ result: null, state, events: [] }), { allowWhilePaused: true });
    const paused = await load(leagueId);
    expect(paused.bracket?.champion, "nothing was played under the pause").toBeFalsy();
    expect(paused.games.some((g) => g.phase === "WC")).toBe(false);

    // resumed, then an action that itself changes nothing: the settled rounds are still saved
    setPostseasonSettler(() => false); // resume without settling, so the next action is the one that does
    await withLeague(leagueId, async ({ state }) => {
      state.pause = null;
      return { result: null, state, events: [] };
    }, { allowWhilePaused: true });
    setPostseasonSettler((st) => postseasonIdle(st) && playNextPlayoffRound(st));
    expect((await load(leagueId)).bracket?.champion).toBeFalsy();
    await withLeague(leagueId, async ({ state }) => ({ result: null, state, unchanged: true }));
    const after = await load(leagueId);
    expect(after.bracket?.champion, "an 'unchanged' action did not throw the settlement away").toBeTruthy();
  });
});
