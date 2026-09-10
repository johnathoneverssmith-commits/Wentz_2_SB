/**
 * Headless season driver (Phase A1 regression guard).
 *
 * Plays a full round-robin-sliced schedule through `simulateGame` (rating layer
 * ON) and rolls the results up into a standings table. The schedule generator
 * here is a balanced 17-round circle-method round robin — deliberately simple;
 * the real NFL division/conference schedule is Phase A1 proper and plugs in via
 * `SeasonOptions.schedule`. This module exists so the season loop has a
 * deterministic vitest sanity check before the franchise UI is wired on top.
 */

import { NFL_TEAMS } from "./nfl-structure.js";
import { type PlayoffResult, simulatePlayoffs } from "./playoffs.js";
import { roster, teamList } from "./roster.js";
import { nflSchedule } from "./schedule.js";
import { simulateGame } from "./sim.js";
import { type FinishedGame, type LeagueStandings, computeStandings } from "./standings.js";

export interface SeasonGame {
  week: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamStanding {
  team: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  /** (wins + 0.5·ties) / games */
  winPct: number;
}

export interface SeasonResult {
  games: SeasonGame[];
  standings: TeamStanding[];
}

export interface SeasonOptions {
  /** Rounds of the round robin to play; one game per team per round. Default 17. */
  gamesPerTeam?: number;
  /** Team codes to include. Default `teamList()`. */
  teams?: string[];
  /** Explicit `[home, away]` pairs in schedule order; overrides generation. */
  schedule?: Array<readonly [string, string]>;
}

const BYE = "__BYE__";

/**
 * Circle-method round robin. Returns `rounds` rounds, each a list of
 * `[home, away]` pairs; every real team appears once per round (a `BYE` slot is
 * dropped). Home/away alternates by round+slot parity so the split stays even.
 */
export function roundRobinSchedule(teams: string[], rounds: number): Array<[string, string]>[] {
  const arr = [...teams];
  if (arr.length % 2 === 1) arr.push(BYE);
  const m = arr.length;
  const half = m / 2;
  const idx = arr.map((_, i) => i);
  const out: Array<[string, string]>[] = [];
  const homeCount = new Map<string, number>(teams.map((t) => [t, 0]));

  for (let r = 0; r < rounds; r++) {
    const round: Array<[string, string]> = [];
    for (let i = 0; i < half; i++) {
      const a = arr[idx[i]!]!;
      const b = arr[idx[m - 1 - i]!]!;
      if (a === BYE || b === BYE) continue;
      // greedy home/away balance: host is whoever has fewer homes so far,
      // parity of (r + i) breaks ties deterministically
      const ha = homeCount.get(a)!;
      const hb = homeCount.get(b)!;
      const aHosts = ha !== hb ? ha < hb : (r + i) % 2 === 0;
      const [home, away] = aHosts ? [a, b] : [b, a];
      homeCount.set(home, homeCount.get(home)! + 1);
      round.push([home, away]);
    }
    out.push(round);
    // rotate everything but the first fixed position
    idx.splice(1, 0, idx.pop()!);
  }
  return out;
}

function blankStanding(team: string): TeamStanding {
  return {
    team,
    wins: 0,
    losses: 0,
    ties: 0,
    games: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    winPct: 0,
  };
}

/**
 * Sim a whole season. `simulateGame(seed + gameIndex, home, away)` per game, so
 * the same `seed` reproduces the same season exactly.
 */
export function simulateSeason(seed: number, opts: SeasonOptions = {}): SeasonResult {
  const teams = opts.teams ?? teamList();
  const gamesPerTeam = opts.gamesPerTeam ?? 17;

  const scheduled: { week: number; home: string; away: string }[] = [];
  if (opts.schedule) {
    const perWeek = Math.max(1, Math.floor(teams.length / 2));
    opts.schedule.forEach(([home, away], i) => {
      scheduled.push({ week: Math.floor(i / perWeek) + 1, home, away });
    });
  } else {
    if (gamesPerTeam > teams.length - 1) {
      throw new Error(
        `simulateSeason: gamesPerTeam ${gamesPerTeam} exceeds ${teams.length - 1} distinct opponents`,
      );
    }
    roundRobinSchedule(teams, gamesPerTeam).forEach((round, w) => {
      for (const [home, away] of round) scheduled.push({ week: w + 1, home, away });
    });
  }

  const table = new Map<string, TeamStanding>(teams.map((t) => [t, blankStanding(t)]));
  const games: SeasonGame[] = [];

  scheduled.forEach(({ week, home, away }, i) => {
    const g = simulateGame(seed + i, home, away);
    const [homePts, awayPts] = g.score;
    games.push({ week, home, away, homeScore: homePts, awayScore: awayPts });

    const H = table.get(home);
    const A = table.get(away);
    if (!H || !A) throw new Error(`simulateSeason: game references unknown team ${home}/${away}`);
    H.games += 1;
    A.games += 1;
    H.pointsFor += homePts;
    H.pointsAgainst += awayPts;
    A.pointsFor += awayPts;
    A.pointsAgainst += homePts;
    if (homePts > awayPts) {
      H.wins += 1;
      A.losses += 1;
    } else if (awayPts > homePts) {
      A.wins += 1;
      H.losses += 1;
    } else {
      H.ties += 1;
      A.ties += 1;
    }
  });

  const standings = [...table.values()];
  for (const s of standings) {
    s.pointDiff = s.pointsFor - s.pointsAgainst;
    s.winPct = s.games ? (s.wins + 0.5 * s.ties) / s.games : 0;
  }
  standings.sort(
    (x, y) =>
      y.winPct - x.winPct ||
      y.pointDiff - x.pointDiff ||
      y.pointsFor - x.pointsFor ||
      x.team.localeCompare(y.team),
  );

  return { games, standings };
}

export interface NflSeasonResult {
  /** Regular-season games, in schedule (week) order. */
  games: SeasonGame[];
  /** Division ranks + conference seeding, after the NFL tiebreaker procedure. */
  standings: LeagueStandings;
  /** Full bracket through the Super Bowl. */
  playoffs: PlayoffResult;
  champion: string;
}

export interface NflSeasonOptions {
  /** Season year — drives the schedule's division-pairing rotations. Default 2026. */
  year?: number;
  /** team → prior-year division finish rank (1–4); used for same-place matchups. */
  priorRank?: Map<string, number>;
}

/**
 * A full NFL season: the real 17-game schedule through `simulateGame` (rating
 * layer ON), the league standings with tiebreakers, then the 14-team playoff
 * bracket. `simulateGame(seed + gameIndex, …)` per regular-season game and a
 * disjoint seed range for the playoffs, so a given `seed` + `year` reproduces
 * the season and the champion exactly. Needs a full player pool (every team in
 * `teams` must have a roster).
 */
export function simulateNflSeason(seed: number, opts: NflSeasonOptions = {}): NflSeasonResult {
  const year = opts.year ?? 2026;
  const teams = NFL_TEAMS as string[];
  const schedule = nflSchedule(
    opts.priorRank ? { year, priorRank: opts.priorRank } : { year },
  );

  const games: SeasonGame[] = [];
  const finished: FinishedGame[] = [];
  schedule.forEach(({ week, home, away }, i) => {
    const g = simulateGame(seed + i, home, away);
    const [homeScore, awayScore] = g.score;
    games.push({ week, home, away, homeScore, awayScore });
    finished.push({ home, away, homeScore, awayScore });
  });

  const standings = computeStandings(finished, teams);
  const playoffs = simulatePlayoffs(seed, standings.seeding);

  return { games, standings, playoffs, champion: playoffs.champion };
}

/**
 * team → division finish rank (1–4) from a completed season's standings, for
 * feeding the *next* season's schedule (`priorRank`) so same-place matchups
 * chain realistically.
 */
export function priorRankFromStandings(standings: LeagueStandings): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of standings.rows) m.set(r.team, r.divisionRank);
  return m;
}

export interface FranchiseOptions {
  /** First season year. Default 2026. */
  startYear?: number;
  /** How many consecutive seasons to run. Default 2. */
  seasons?: number;
  /** team → division finish rank feeding season 1's schedule. */
  priorRank?: Map<string, number>;
}

/**
 * Run consecutive NFL seasons, feeding each one the previous season's division
 * finish order as `priorRank`. `simulateNflSeason(seed + n, { year: startYear +
 * n, … })` per season, so the whole run is deterministic in `seed` + options.
 */
export function simulateFranchise(seed: number, opts: FranchiseOptions = {}): NflSeasonResult[] {
  const startYear = opts.startYear ?? 2026;
  const seasons = opts.seasons ?? 2;

  const out: NflSeasonResult[] = [];
  let priorRank = opts.priorRank;
  for (let n = 0; n < seasons; n += 1) {
    const result = simulateNflSeason(seed + n, {
      year: startYear + n,
      ...(priorRank ? { priorRank } : {}),
    });
    out.push(result);
    priorRank = priorRankFromStandings(result.standings);
  }
  return out;
}

/** Summed `overall` of a team's starting offense + base defense — a rough roster-strength proxy. */
export function rosterStrength(team: string): number {
  const r = roster(team);
  const units = [r.offense(), r.defense()];
  let total = 0;
  for (const u of units) {
    for (const p of Object.values(u)) if (p) total += p.overall;
  }
  return total;
}
