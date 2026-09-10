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

import { type BoxScore, extractBoxScore } from "./boxscore.js";
import { type ClinchResult, type ClinchTag, clinchStatus } from "./clinch.js";
import { type Conference, NFL_TEAMS } from "./nfl-structure.js";
import { type PlayoffResult, simulatePlayoffs } from "./playoffs.js";
import { roster, teamList } from "./roster.js";
import { type SchedulePair, nflSchedule } from "./schedule.js";
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

// --- stateful, week-by-week season loop (for an interactive franchise UI) ---

export interface SeasonProgress {
  seed: number;
  year: number;
  /** The full 272-game slate. A game's index here is its `simulateGame` seed offset. */
  schedule: SchedulePair[];
  /** Next regular-season week to play (1–18); 19 once the regular season is done. */
  nextWeek: number;
  /** Results so far, in schedule order. */
  results: SeasonGame[];
}

const REGULAR_SEASON_WEEKS = 18;

const toFinished = (g: SeasonGame): FinishedGame => ({
  home: g.home,
  away: g.away,
  homeScore: g.homeScore,
  awayScore: g.awayScore,
});

/** Fresh season, no games played. Same schedule + seed indexing as `simulateNflSeason`. */
export function startSeason(seed: number, opts: NflSeasonOptions = {}): SeasonProgress {
  const year = opts.year ?? 2026;
  const schedule = nflSchedule(opts.priorRank ? { year, priorRank: opts.priorRank } : { year });
  return { seed, year, schedule, nextWeek: 1, results: [] };
}

/**
 * Sim the next unplayed week and return the advanced progress plus that week's
 * games. Pure: `p` is not mutated. A no-op (empty `games`) once the regular
 * season is complete.
 */
export function playWeek(p: SeasonProgress): { progress: SeasonProgress; games: SeasonGame[] } {
  if (p.nextWeek > REGULAR_SEASON_WEEKS) return { progress: p, games: [] };
  const games: SeasonGame[] = [];
  p.schedule.forEach((s, i) => {
    if (s.week !== p.nextWeek) return;
    const g = simulateGame(p.seed + i, s.home, s.away);
    games.push({
      week: s.week,
      home: s.home,
      away: s.away,
      homeScore: g.score[0],
      awayScore: g.score[1],
    });
  });
  return {
    progress: { ...p, nextWeek: p.nextWeek + 1, results: [...p.results, ...games] },
    games,
  };
}

/** Sim forward until `nextWeek` is past `week` (or the regular season ends). */
export function playThroughWeek(p: SeasonProgress, week: number): SeasonProgress {
  let cur = p;
  while (cur.nextWeek <= Math.min(week, REGULAR_SEASON_WEEKS)) cur = playWeek(cur).progress;
  return cur;
}

export function regularSeasonComplete(p: SeasonProgress): boolean {
  return p.nextWeek > REGULAR_SEASON_WEEKS;
}

/** Standings as they stand right now (partial or complete). */
export function progressStandings(p: SeasonProgress): LeagueStandings {
  return computeStandings(p.results.map(toFinished));
}

/** Clinch / elimination tags as they stand right now. */
export function progressClinches(p: SeasonProgress): ClinchResult[] {
  return clinchStatus(p.results.map(toFinished), p.schedule);
}

/** A team's not-yet-played opponents, in week order (`@OPP` = away). */
export function remainingOpponents(p: SeasonProgress, team: string): string[] {
  return p.schedule
    .filter((s) => s.week >= p.nextWeek && (s.home === team || s.away === team))
    .map((s) => (s.home === team ? s.away : `@${s.home}`));
}

/**
 * Re-sim one scheduled game and pull its box score. Deterministic — uses the
 * game's index in the slate as the seed offset, exactly as `playWeek` does — so
 * this reproduces a game the loop already played without storing every `Game`.
 */
export function boxScoreFor(p: SeasonProgress, game: { home: string; away: string }): BoxScore {
  const i = p.schedule.findIndex((s) => s.home === game.home && s.away === game.away);
  if (i < 0) throw new Error(`boxScoreFor: ${game.away} @ ${game.home} is not on the schedule`);
  const s = p.schedule[i]!;
  return extractBoxScore(simulateGame(p.seed + i, s.home, s.away), s.home, s.away, s.week);
}

export interface PictureSeed {
  seed: number;
  team: string;
  record: string;
  wonDivision: boolean;
  /** strongest clinch/elimination tag, if any */
  clinch: ClinchTag | null;
  /** why this team holds the seed, if a tiebreaker decided it */
  tiebreaker?: string;
}

export interface PictureContender {
  team: string;
  record: string;
  /** games behind the current #7 seed (½ per game; 0 if it would be in on a tie) */
  gamesBack: number;
  clinch: ClinchTag | null;
}

export interface ConferencePicture {
  seeds: PictureSeed[];
  inHunt: PictureContender[];
  eliminated: string[];
}

const winEquiv = (r: { wins: number; losses: number; ties: number }) => r.wins + 0.5 * r.ties;

/**
 * "If the season ended today" plus who's still alive — folds `progressStandings`
 * and `progressClinches` into one per-conference view for a playoff-picture UI.
 */
export function playoffPicture(p: SeasonProgress): Record<Conference, ConferencePicture> {
  const standings = progressStandings(p);
  const clinch = new Map(progressClinches(p).map((c) => [c.team, strongestTag(c)]));
  const rowOf = new Map(standings.rows.map((r) => [r.team, r]));

  const out = {} as Record<Conference, ConferencePicture>;
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const seedTeams = standings.seeding[conf].seeds;
    const seeds: PictureSeed[] = seedTeams.map((team, i) => {
      const r = rowOf.get(team)!;
      return {
        seed: i + 1,
        team,
        record: recordText(r),
        wonDivision: r.wonDivision,
        clinch: clinch.get(team) ?? null,
        ...(r.tiebreaker ? { tiebreaker: r.tiebreaker } : {}),
      };
    });

    const cutoff = seedTeams.length ? winEquiv(rowOf.get(seedTeams[seedTeams.length - 1]!)!) : 0;
    const rest = standings.rows
      .filter((r) => r.conference === conf && !seedTeams.includes(r.team))
      .sort((a, b) => winEquiv(b) - winEquiv(a) || b.pointDiff - a.pointDiff);

    const inHunt: PictureContender[] = [];
    const eliminated: string[] = [];
    for (const r of rest) {
      if (clinch.get(r.team) === "eliminated") {
        eliminated.push(r.team);
      } else {
        inHunt.push({
          team: r.team,
          record: recordText(r),
          gamesBack: Math.max(0, (cutoff - winEquiv(r)) / 2),
          clinch: clinch.get(r.team) ?? null,
        });
      }
    }
    out[conf] = { seeds, inHunt, eliminated };
  }
  return out;
}

function recordText(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

function strongestTag(c: ClinchResult): ClinchTag | null {
  for (const t of ["homefield", "bye", "division", "berth", "eliminated"] as const) {
    if (c.tags.includes(t)) return t;
  }
  return null;
}

/**
 * Play out any weeks left, then the playoffs. From a fresh `startSeason` this is
 * identical to `simulateNflSeason` (same schedule, same per-game seed offsets).
 */
export function finishSeason(p: SeasonProgress): NflSeasonResult {
  let cur = p;
  while (!regularSeasonComplete(cur)) cur = playWeek(cur).progress;
  const standings = computeStandings(cur.results.map(toFinished), NFL_TEAMS as string[]);
  const playoffs = simulatePlayoffs(cur.seed, standings.seeding);
  return { games: cur.results, standings, playoffs, champion: playoffs.champion };
}

/**
 * A full NFL season: the real 17-game schedule through `simulateGame` (rating
 * layer ON), the league standings with tiebreakers, then the 14-team playoff
 * bracket. `simulateGame(seed + gameIndex, …)` per regular-season game and a
 * disjoint seed range for the playoffs, so a given `seed` + `year` reproduces
 * the season and the champion exactly. Needs a full player pool (every team in
 * `teams` must have a roster). Equivalent to `finishSeason(startSeason(seed, opts))`.
 */
export function simulateNflSeason(seed: number, opts: NflSeasonOptions = {}): NflSeasonResult {
  return finishSeason(startSeason(seed, opts));
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
