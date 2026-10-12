import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { simulateBlock } from "../src/blocks.js";

/**
 * A playthrough reported the whole league at 0 passing yards. Whatever the
 * cause, a simulated week must never get there quietly: one real week through
 * the block path the server runs, checked at every place a passing yard is
 * kept - the game's team totals, the player lines, and the season stats.
 */
it("a simulated week throws the ball, and every stat layer records it", () => {
  const s = createLeague(9090, { ...DEFAULT_CONFIG });
  fillRosterGaps(s);
  if (!s.schedule?.length) s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  const played = simulateBlock(s, "REG", 1, 1);
  expect(played).toBeGreaterThan(10);

  const games = s.games.filter((g) => g.phase === "REG" && g.week === 1);
  const teamGames = games.length * 2;
  const teamPass = games.reduce((n, g) => n + (g.totals?.home.passYards ?? 0) + (g.totals?.away.passYards ?? 0), 0);
  const teamRush = games.reduce((n, g) => n + (g.totals?.home.rushYards ?? 0) + (g.totals?.away.rushYards ?? 0), 0);
  // the NFL: ~215 net passing and ~115 rushing yards a team-game
  expect(teamPass / teamGames).toBeGreaterThan(150);
  expect(teamPass).toBeGreaterThan(teamRush);

  const players = Object.values(s.players);
  const playerPass = players.reduce((n, p) => n + (p.season_stats?.passYds ?? 0), 0);
  const playerRec = players.reduce((n, p) => n + (p.season_stats?.recYds ?? 0), 0);
  expect(playerPass / teamGames).toBeGreaterThan(150);
  expect(playerRec).toBe(playerPass);
  // every team had a passer who threw
  for (const code of new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))) {
    const thrown = players.filter((p) => p.nfl_team === code).reduce((n, p) => n + (p.season_stats?.passAtt ?? 0), 0);
    expect(thrown, code).toBeGreaterThan(15);
  }
});

/**
 * The same question across many leagues, with a yardstick for "how far is too
 * far".
 *
 * One league is one roll of the dice: a team-game's passing yards have a
 * standard deviation near 89, so a single week of 32 team-games moves its own
 * average by ~16 yards without anything being wrong. Looking at more leagues
 * does two things. It catches a failure that only shows on some leagues (the
 * zero-yards bug depended on which players were on the field). And it lets the
 * allowed distance be computed instead of guessed: a mean of n team-games is
 * within a few standard errors (sd / sqrt(n)) of the truth, and "a few" is
 * chosen so that a healthy engine all but never trips it.
 *
 * What the numbers are measured against is this path as it plays today - the
 * franchise defaults (Amplified talent, weather, injuries), not raw NFL
 * averages, which the engine is calibrated near but deliberately runs a little
 * hotter than (more rushing, slightly fewer sacks). `NFL` below is a wide
 * sanity envelope so that re-measuring the baseline can never quietly bless a
 * broken engine. Nothing here changes any rating, formula or probability.
 *
 * BASELINE: 24 leagues (seeds 101-124) x 3 regular-season weeks = 2,304
 * team-games, measured on 2026-10-12. Those seeds are in neither the default
 * nor the deep set below (a test checks it), so the baseline and the leagues
 * under test are independent samples and the allowed distance can count both
 * errors honestly: z * sd * sqrt(1/n + 1/N). If a deliberate engine change
 * moves the averages, re-measure on the same seeds and update it in the same
 * commit, saying why.
 *
 * The same 24 leagues showed how much league means really vary: only 0.6 to
 * 0.75 of what treating every team-game as independent predicts (passing
 * yards: 6.8 against 9.1). Games share a schedule and an opponent, which
 * evens things out. So the per-game bands below err on the generous side,
 * which is the right side for a check that must not cry wolf.
 *
 * Cost: ~5 seconds a league. The default is 6 leagues; STATS_SEEDS=12 (or any
 * number up to the length of SEEDS) widens the net for a deep check.
 */
const BASELINE_SEEDS = Array.from({ length: 24 }, (_, i) => 101 + i);
const BASELINE = {
  n: 2304,
  // per team-game: mean and standard deviation
  passYards: { mean: 227.2, sd: 89.0 },
  rushYards: { mean: 118.0, sd: 60.6 },
  points: { mean: 23.84, sd: 12.56 },
  sacksAllowed: { mean: 2.127, sd: 1.936 },
  passAtt: { mean: 29.59, sd: 6.54 },
} as const;
type Stat = keyof Omit<typeof BASELINE, "n">;
const STATS = Object.keys(BASELINE).filter((k) => k !== "n") as Stat[];
/** The statistics judged one by one; sacks are judged as a rate (below), which is far more sensitive. */
const BANDED = STATS.filter((k) => k !== "sacksAllowed");

/**
 * Sacks as a share of dropbacks. A game's sack count is a small number (about
 * two) with a standard deviation as large as itself, so averaging counts
 * leaves a band near a fifth of the value. The rate a league produces over
 * its three weeks (about 200 sacks) is far steadier: it differs from league to
 * league by only 0.0041, 6% of its value. The spread is measured between whole
 * leagues, not assumed, so it already includes everything that makes a league's
 * rate wander. It is inflated by 15% (about one standard error of an estimate
 * made from 24 leagues) so that a baseline that happened to be quiet cannot
 * make the band too tight.
 */
const SACK_RATE = { mean: 0.06706, leagueSd: 0.00409, leagues: 24, inflate: 1.15 };

/** The NFL, 2018-2025 (artifacts/validation/simulation_validation.json), as a wide envelope. */
const NFL = { points: 22.56, passAtt: 32.82, completion: 0.647, sackRate: 0.0663, rushYards: 23.99 * 4.276 };

const SEEDS = [9090, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13];
const SEED_COUNT = Math.min(SEEDS.length, Math.max(1, Number(process.env.STATS_SEEDS ?? 6)));
const WEEKS = 3;
/** Standard errors allowed for one league / for all of them pooled. */
const Z_ONE = 4.5;
const Z_POOLED = 4;

interface Played {
  seed: number;
  rows: Record<Stat, number[]>;
  completions: number;
  s: ReturnType<typeof createLeague>;
}

function playLeague(seed: number): Played {
  const s = createLeague(seed, { ...DEFAULT_CONFIG });
  fillRosterGaps(s);
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  simulateBlock(s, "REG", 1, WEEKS);
  const rows = { passYards: [], rushYards: [], points: [], sacksAllowed: [], passAtt: [] } as Played["rows"];
  let completions = 0;
  for (const g of s.games.filter((g) => g.phase === "REG" && g.played)) {
    for (const side of ["home", "away"] as const) {
      const t = g.totals![side];
      for (const k of STATS) rows[k].push(t[k] as number);
      completions += t.passComp as number;
    }
  }
  return { seed, rows, completions, s };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
/** How far a mean of n team-games may sit from the baseline: z standard errors, counting the baseline's own error. */
const allowed = (stat: Stat, n: number, z: number) =>
  z * BASELINE[stat].sd * Math.sqrt(1 / n + 1 / BASELINE.n);

/** How far the mean of `leagues` leagues' sack rates may sit from the baseline. */
const allowedSackRate = (leagues: number, z: number) =>
  z * SACK_RATE.leagueSd * SACK_RATE.inflate * Math.sqrt(1 / leagues + 1 / SACK_RATE.leagues);
/** A league's sacks as a share of its dropbacks (a sack replaces an attempt). */
const sackRateOf = (l: Played) => {
  const sacks = l.rows.sacksAllowed.reduce((x, y) => x + y, 0);
  return sacks / (sacks + l.rows.passAtt.reduce((x, y) => x + y, 0));
};

/** A league is played the first time a test asks for it, and kept for the rest. */
const leaguesPlayed = new Map<number, Played>();
const league = (seed: number): Played => {
  if (!leaguesPlayed.has(seed)) leaguesPlayed.set(seed, playLeague(seed));
  return leaguesPlayed.get(seed)!;
};
const chosen = SEEDS.slice(0, SEED_COUNT);

describe("across leagues", () => {
  const leagues = { get all() { return chosen.map(league); } };

  it.each(chosen)(
    "league %i: every statistic is a number, and the totals agree with the players' lines",
    (seed) => {
      const l = league(seed);
      const games = l.s.games.filter((g) => g.phase === "REG" && g.played);
      expect(games.length).toBeGreaterThan(40); // 3 weeks of a 32-team league
      for (const g of games) {
        // both teams' scores: a whole number from 0 up to a ceiling no real game reaches
        for (const [side, score] of [["home", g.homeScore], ["away", g.awayScore]] as const) {
          expect(Number.isInteger(score), `${g.id} ${side} score ${score}`).toBe(true);
          expect(score, `${g.id} ${side} score`).toBeGreaterThanOrEqual(0);
          expect(score, `${g.id} ${side} score`).toBeLessThan(90);
        }
        for (const side of ["home", "away"] as const) {
          for (const [k, v] of Object.entries(g.totals![side])) {
            if (typeof v === "number") expect(Number.isFinite(v), `${g.id} ${side}.${k}`).toBe(true);
          }
        }
      }
      for (const p of Object.values(l.s.players)) {
        for (const [k, v] of Object.entries(p.season_stats ?? {})) {
          if (typeof v !== "number") continue;
          expect(Number.isFinite(v), `${p.id} ${k}=${v}`).toBe(true);
          // yards can be negative (a stopped runner, a catch behind the line); a count cannot
          if (!/yds|yards/i.test(k)) expect(v, `${p.id} ${k}=${v}`).toBeGreaterThanOrEqual(0);
        }
      }
      const players = Object.values(l.s.players);
      const sum = (f: (p: (typeof players)[number]) => number | undefined) => players.reduce((n, p) => n + (f(p) ?? 0), 0);
      expect(sum((p) => p.season_stats?.recYds)).toBe(sum((p) => p.season_stats?.passYds)); // every yard thrown is caught
      // and every team did all three things, in every league
      for (const code of new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))) {
        const mine = players.filter((p) => p.nfl_team === code);
        expect(mine.reduce((n, p) => n + (p.season_stats?.passAtt ?? 0), 0), `${code} pass attempts`).toBeGreaterThan(20);
        expect(mine.reduce((n, p) => n + (p.season_stats?.rushYds ?? 0), 0), `${code} rushing yards`).toBeGreaterThan(0);
      }
    },
  );

  it.each(chosen)(
    "league %i: passing, rushing, scoring and sacks are each near the baseline",
    (seed) => {
      const l = league(seed);
      const n = l.rows.points.length;
      for (const k of BANDED) {
        const got = mean(l.rows[k]);
        const tol = allowed(k, n, Z_ONE);
        expect(Math.abs(got - BASELINE[k].mean), `${k}: ${got.toFixed(2)} vs ${BASELINE[k].mean} +/-${tol.toFixed(2)}`).toBeLessThan(tol);
      }
      const rate = sackRateOf(l);
      const tol = allowedSackRate(1, Z_ONE);
      expect(Math.abs(rate - SACK_RATE.mean), `sack rate: ${rate.toFixed(4)} vs ${SACK_RATE.mean} +/-${tol.toFixed(4)}`).toBeLessThan(tol);
    },
  );

  it("pooled over every league, each statistic stays within a tight band of the baseline", () => {
    const n = leagues.all.reduce((m, l) => m + l.rows.points.length, 0);
    for (const k of BANDED) {
      const got = mean(leagues.all.flatMap((l) => l.rows[k]));
      const tol = allowed(k, n, Z_POOLED);
      expect(Math.abs(got - BASELINE[k].mean), `${k}: ${got.toFixed(2)} vs ${BASELINE[k].mean} +/-${tol.toFixed(2)} (${(100 * tol / BASELINE[k].mean).toFixed(1)}%)`).toBeLessThan(tol);
    }
    const rate = mean(leagues.all.map(sackRateOf));
    const tol = allowedSackRate(leagues.all.length, Z_POOLED);
    expect(Math.abs(rate - SACK_RATE.mean), `sack rate: ${rate.toFixed(4)} vs ${SACK_RATE.mean} +/-${tol.toFixed(4)} (${(100 * tol / SACK_RATE.mean).toFixed(1)}%)`).toBeLessThan(tol);
  });

  it("the baseline was measured on leagues the tests never play", () => {
    expect(BASELINE_SEEDS.filter((seed) => SEEDS.includes(seed))).toEqual([]);
    expect(new Set(BASELINE_SEEDS).size).toBe(24);
  });

  it("the bands are tight enough to notice a real shift (a loose band would pass anything)", () => {
    // Computed, not simulated. Even one league's three weeks must flag a
    // quarter-sized move in yards, points or attempts; at the default size it
    // is about a tenth. The sack rate is judged between leagues, so it needs
    // several: at the default size a shift of about a seventh is noticed.
    const n = chosen.length * 96;
    for (const k of ["passYards", "rushYards", "points", "passAtt"] as const) {
      expect(allowed(k, n, Z_POOLED) / BASELINE[k].mean, k).toBeLessThan(0.25);
    }
    const sacks = allowedSackRate(chosen.length, Z_POOLED) / SACK_RATE.mean;
    expect(sacks, "sack rate").toBeLessThan(chosen.length >= 3 ? 0.18 : 0.45);
  });

  it("and remains inside the NFL's own envelope, so the baseline cannot drift somewhere absurd", () => {
    const all = (k: Stat) => leagues.all.flatMap((l) => l.rows[k]);
    const completions = leagues.all.reduce((m, l) => m + l.completions, 0);
    const near = (got: number, want: number, rel: number, what: string) =>
      expect(Math.abs(got / want - 1), `${what}: ${got.toFixed(4)} vs NFL ${want.toFixed(4)}`).toBeLessThan(rel);
    near(mean(all("points")), NFL.points, 0.12, "points a team-game");
    near(mean(all("passAtt")), NFL.passAtt, 0.15, "pass attempts a team-game");
    near(completions / all("passAtt").reduce((x, y) => x + y, 0), NFL.completion, 0.1, "completion rate");
    const sacks = all("sacksAllowed").reduce((x, y) => x + y, 0);
    near(sacks / (sacks + all("passAtt").reduce((x, y) => x + y, 0)), NFL.sackRate, 0.25, "sack rate");
    near(mean(all("rushYards")), NFL.rushYards, 0.22, "rushing yards a team-game");
  });
});
