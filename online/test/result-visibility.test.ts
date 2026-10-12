import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal, markRevealed, markRoundRevealed } from "@/state/reveal.ts";
import { fillRosterGaps } from "@/state/seed.ts";

import { signSession } from "../src/auth.js";
import { simulateBlock, simulatePlayoffBlock } from "../src/blocks.js";
import { pool, readLeague, withLeague } from "../src/db.js";
import { server } from "../src/index.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * A block of games is simulated once, for everyone, at the checkpoint — so the
 * saved league already holds next week's scores and the whole postseason while
 * each GM is still on an earlier screen. The only thing keeping those results
 * from a GM who has not watched them is what the server does to the league on
 * the way out. The reveal functions have their own unit tests; these call the
 * real routes, as a signed-in member and as a stranger would.
 *
 * Everything here is synthetic: made-up accounts and a league generated from
 * the seed. Needs a database; when the run requires one (CI) it fails without
 * one, otherwise it skips loudly.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = { watcher: `vis_watcher_${stamp}`, sleeper: `vis_sleeper_${stamp}`, stranger: `vis_stranger_${stamp}` };
let leagueId = "";
let baseUrl = "";
let watcherGm = "";
let sleeperGm = "";
let week1Game = "";
let week2Game = "";

const setup = (change: (state: LeagueState) => void) =>
  withLeague(leagueId, async ({ state }) => {
    change(state);
    return { result: null, state, events: [] };
  });

/**
 * Every test starts from the same league, whatever ran before it.
 *
 * Tests here change the saved league (a GM reveals a week, the postseason is
 * seeded), and used to lean on each other's leftovers: the second postseason
 * test read the bracket the first one built, and the "watched week 1" tests
 * assumed the "reveal week 2" test had not yet run. So the league as
 * `beforeAll` leaves it is kept as text, and `beforeEach` writes it back.
 * Any test can be run alone, or the file in any order.
 */
let baseline = "";
/** The baseline plus a seeded, fully decided bracket: built by the first test that wants it, then restored. */
let postseasonBaseline = "";
const restore = (text: string) =>
  withLeague(leagueId, async () => ({ result: null, state: JSON.parse(text) as LeagueState, events: [] }));
const enterPostseason = async () => {
  if (postseasonBaseline) return restore(postseasonBaseline);
  await setup((s) => {
    const sim = new MockSimulationService();
    s.bracket = sim.seedBracket(s);
    s.stage = "playoffs";
    simulatePlayoffBlock(s); // all four rounds, decided up front
  });
  postseasonBaseline = JSON.stringify((await readLeague(leagueId))!.state);
};

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  // connects and checks the schema is there; the schema itself is applied once,
  // before any test file starts (test/globalSetup.ts), never by a suite
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);

  for (const u of Object.values(users)) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
  leagueId = (await createOnlineLeague(users.watcher, { name: "Visibility Test", humanSlots: 2 })).leagueId;
  watcherGm = (await claimTeam(leagueId, users.watcher, "GB")).gmId;
  sleeperGm = (await claimTeam(leagueId, users.sleeper, "KC")).gmId;

  // two regular-season weeks, simulated whole; only the watcher has seen week 1
  await setup((s) => {
    // a league that has not drafted yet has no players on its teams; the
    // stats below need real ones to record against
    fillRosterGaps(s);
    const sim = new MockSimulationService();
    if (!s.schedule?.length) s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
    s.stage = "regularSeason";
    s.reveal = emptyReveal();
    simulateBlock(s, "REG", 1, 2);
    markRevealed(s, watcherGm, "REG", 1);
    week1Game = s.games.find((g) => g.phase === "REG" && g.week === 1)!.id;
    week2Game = s.games.find((g) => g.phase === "REG" && g.week === 2)!.id;
  });

  baseline = JSON.stringify((await readLeague(leagueId))!.state);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  if (reachable) await restore(baseline);
});

afterAll(async () => {
  if (reachable) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    for (const u of Object.values(users)) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

const call = (user: string | null, path: string) =>
  fetch(`${baseUrl}${path}`, user ? { headers: { cookie: `sid=${signSession(user)}` } } : {});
const league = async (user: string) => {
  const res = await call(user, `/leagues/${leagueId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { state: LeagueState }).state;
};
const played = (s: LeagueState, week: number) => s.games.filter((g) => g.phase === "REG" && g.week === week);
const decided = (s: LeagueState) => s.games.filter((g) => g.played);
const recordsPlayed = (s: LeagueState) =>
  Object.values(s.teams).reduce((n, t) => n + t.wins + t.losses + t.ties, 0);
const passingYards = (s: LeagueState) =>
  Object.values(s.players).reduce((n, p) => n + (p.season_stats?.passYds ?? 0), 0);

describe("the fixture", () => {
  // Without this, "nothing leaked" could just mean "nothing was there". The
  // saved league is read directly (no redaction) and must hold every result.
  maybe("really does hold the results the other tests expect to be hidden", async () => {
    const raw = (await readLeague(leagueId))!.state;
    expect(played(raw, 1).length).toBeGreaterThan(10);
    expect(played(raw, 1).every((g) => g.played && g.totals != null)).toBe(true);
    expect(played(raw, 2).every((g) => g.played && g.totals != null)).toBe(true);
    expect(recordsPlayed(raw)).toBe((played(raw, 1).length + played(raw, 2).length) * 2);
    expect(passingYards(raw)).toBeGreaterThan(10_000);
  });
});

describe("a GM who has watched nothing", () => {
  maybe("is sent the schedule, with no result in it", async () => {
    const s = await league(users.sleeper);
    expect(s.games.length).toBeGreaterThan(0); // the fixtures exist...
    expect(decided(s)).toHaveLength(0); // ...but none has an outcome
    for (const g of s.games) {
      expect(g.homeScore).toBe(0);
      expect(g.awayScore).toBe(0);
      expect(g.totals).toBeUndefined(); // box-score detail goes with the score
    }
  });

  maybe("is not told the standings or the statistics of those games", async () => {
    const s = await league(users.sleeper);
    expect(recordsPlayed(s)).toBe(0);
    expect(passingYards(s)).toBe(0);
  });

  maybe("cannot open the play-by-play of a game they have not watched", async () => {
    const res = await call(users.sleeper, `/leagues/${leagueId}/games/${week1Game}/broadcast`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toMatch(/"plays"|"homeScore"/);
  });
});

describe("a GM who has watched week 1", () => {
  maybe("sees week 1 and nothing after it", async () => {
    const s = await league(users.watcher);
    expect(played(s, 1).every((g) => g.played)).toBe(true);
    expect(played(s, 2).some((g) => g.played || g.homeScore !== 0 || g.awayScore !== 0)).toBe(false);
    // the records and stats are those of one week, not two
    expect(recordsPlayed(s)).toBe(played(s, 1).length * 2);
    expect(passingYards(s)).toBeGreaterThan(0);
  });

  maybe("can open week 1's broadcast but not week 2's", async () => {
    expect((await call(users.watcher, `/leagues/${leagueId}/games/${week1Game}/broadcast`)).status).toBe(200);
    expect((await call(users.watcher, `/leagues/${leagueId}/games/${week2Game}/broadcast`)).status).toBe(403);
  });
});

describe("one GM's progress is not another's", () => {
  maybe("a reader who has seen more does not change what a reader who has seen less is sent", async () => {
    // in this order, in case the server's saved copy is redacted in place for one request and reused
    const before = decided(await league(users.sleeper)).length;
    const ahead = decided(await league(users.watcher)).length;
    const after = decided(await league(users.sleeper)).length;
    expect(ahead).toBeGreaterThan(0);
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  maybe("revealing a week for one GM leaves the other's view alone", async () => {
    await setup((s) => markRevealed(s, watcherGm, "REG", 2));
    expect(decided(await league(users.watcher)).length).toBeGreaterThan(played(await league(users.watcher), 1).length);
    expect(decided(await league(users.sleeper))).toHaveLength(0);
  });
});

describe("people who are not in the league", () => {
  maybe("a stranger is refused the league, its feed and every broadcast", async () => {
    for (const path of [
      `/leagues/${leagueId}`,
      `/leagues/${leagueId}/feed`,
      `/leagues/${leagueId}/games/${week1Game}/broadcast`,
    ]) {
      const res = await call(users.stranger, path);
      expect(res.status, path).toBe(403);
      expect(await res.text(), path).not.toMatch(/homeScore|passYds/);
    }
  });

  maybe("someone not signed in is refused as well", async () => {
    for (const path of [`/leagues/${leagueId}`, `/leagues/${leagueId}/games/${week1Game}/broadcast`]) {
      expect((await call(null, path)).status, path).toBe(401);
    }
  });
});

describe("the postseason", () => {
  maybe("hides every winner and the champion until each round is watched", async () => {
    await enterPostseason();
    // so there is something to leak: the saved bracket is complete
    const raw = (await readLeague(leagueId))!.state;
    expect(raw.bracket!.champion).not.toBeNull();
    expect(raw.bracket!.matchups.filter((m) => m.winner != null).length).toBeGreaterThan(5);
    const b = (await league(users.sleeper)).bracket!;
    expect(b.champion).toBeNull();
    expect(b.matchups.every((m) => m.winner == null && m.homeScore == null && m.awayScore == null)).toBe(true);
    expect(decided(await league(users.sleeper)).filter((g) => g.phase !== "REG")).toHaveLength(0);
  });

  maybe("shows a round only to the GM who has watched it", async () => {
    await enterPostseason(); // its own bracket: it does not rely on another test having made one
    await setup((s) => markRoundRevealed(s, watcherGm, "WC"));
    const mine = (await league(users.watcher)).bracket!;
    const wild = mine.matchups.filter((m) => m.round === "WC" && m.highSeed && m.lowSeed);
    expect(wild.length).toBeGreaterThan(0);
    expect(wild.every((m) => m.winner != null)).toBe(true);
    expect(mine.champion).toBeNull(); // the Super Bowl is far from watched
    const theirs = (await league(users.sleeper)).bracket!;
    expect(theirs.matchups.every((m) => m.winner == null)).toBe(true);
  });
});
