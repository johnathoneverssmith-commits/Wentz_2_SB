import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult, LeagueState, PlayerStatLine, TeamState } from "@/domain";

import { NFL_TEAMS } from "../../../src/engine/nfl-structure.ts";
import { computeStandings, type FinishedGame } from "../../../src/engine/standings.ts";
import { isHumansOnly } from "./leagueFormat.ts";

// The engine spells the Rams "LA"; this UI spells them "LAR" (the same translation HttpSimulationService makes).
const toEngine = (code: string): string => (code === "LAR" ? "LA" : code);
const toUi = (code: string): string => (code === "LA" ? "LAR" : code);

export interface ConferenceField {
  /** Seeds 1-7, best first: the four division champions, then the three wild cards. */
  seeds: string[];
  divisionWinners: string[];
  wildCards: string[];
  /** The whole conference, best first: the seeds, then everyone else by the wild-card procedure. */
  order: string[];
}

export interface AuthoritativeStandings {
  AFC: ConferenceField;
  NFC: ConferenceField;
  /** 1-4 within each division, by team code. */
  divisionRank: Record<string, number>;
}

/**
 * The league's standings and playoff seeding by the one documented rule book: the engine's `computeStandings`
 * (division champions are seeds 1-4 whatever their record, wild cards 5-7, and every tie goes through head-to-head,
 * division / common / conference record, strength of victory and schedule, then net points).
 *
 * This is the only place the UI decides who ranks where. The ranks stored on each team, the bracket the local game
 * seeds (and the multiplayer server, which seeds with the same code), and the order the standings tables list all
 * come from it, so the same completed season reads the same everywhere. A league with no NFL structure (humans only:
 * one table, no divisions) has no such rules and keeps its own ordering; this returns null for it.
 */
export function authoritativeStandings(state: Pick<LeagueState, "teams" | "games" | "config">): AuthoritativeStandings | null {
  if (isHumansOnly(state)) return null;
  const codes = Object.keys(state.teams);
  const nfl = new Set<string>(NFL_TEAMS);
  if (codes.length !== nfl.size || codes.some((c) => !nfl.has(toEngine(c)))) return null;
  const games: FinishedGame[] = state.games
    .filter((g) => g.phase === "REG" && g.played)
    .map((g) => ({ home: toEngine(g.homeTeam), away: toEngine(g.awayTeam), homeScore: g.homeScore, awayScore: g.awayScore }));
  const result = computeStandings(games, codes.map(toEngine));
  const field = (conf: "AFC" | "NFC"): ConferenceField => {
    const c = result.seeding[conf];
    return { seeds: c.seeds.map(toUi), divisionWinners: c.divisionWinners.map(toUi), wildCards: c.wildCards.map(toUi), order: c.order.map(toUi) };
  };
  return { AFC: field("AFC"), NFC: field("NFC"), divisionRank: Object.fromEntries(result.rows.map((r) => [toUi(r.team), r.divisionRank])) };
}

/** Recompute every team's W/L/T + points + ranks from played REG games. */
export function recomputeStandings(state: LeagueState): void {
  for (const code of Object.keys(state.teams)) {
    const t = state.teams[code]!;
    t.wins = t.losses = t.ties = t.pointsFor = t.pointsAgainst = 0;
  }
  for (const g of state.games) {
    if (g.phase !== "REG" || !g.played) continue;
    apply(state.teams[g.homeTeam], g, "home");
    apply(state.teams[g.awayTeam], g, "away");
  }

  const codes = Object.keys(state.teams);
  const pct = (t: TeamState) => {
    const games = t.wins + t.losses + t.ties;
    return games ? (t.wins + 0.5 * t.ties) / games : 0;
  };
  const diff = (t: TeamState) => t.pointsFor - t.pointsAgainst;
  // NFL tiebreakers, in order: head-to-head, division record (division
  // rivals), conference record, then point differential. Point differential
  // alone used to decide every tie — on the standings and in playoff seeding.
  const rec = new Map<string, { w: number; g: number }>();
  const bump = (k: string, win: number) => {
    const r = rec.get(k) ?? { w: 0, g: 0 };
    r.w += win;
    r.g += 1;
    rec.set(k, r);
  };
  const conf = (c: string) => TEAMS_BY_CODE[c]?.conference;
  const div = (c: string) => `${conf(c)}-${TEAMS_BY_CODE[c]?.division}`;
  for (const g of state.games) {
    if (g.phase !== "REG" || !g.played) continue;
    const hw = g.homeScore > g.awayScore ? 1 : g.homeScore === g.awayScore ? 0.5 : 0;
    for (const [me, them, w] of [
      [g.homeTeam, g.awayTeam, hw],
      [g.awayTeam, g.homeTeam, 1 - hw],
    ] as const) {
      bump(`h2h|${me}|${them}`, w);
      if (div(me) === div(them)) bump(`div|${me}`, w);
      if (conf(me) === conf(them)) bump(`conf|${me}`, w);
    }
  }
  const rpct = (k: string) => {
    const r = rec.get(k);
    return r && r.g ? r.w / r.g : 0;
  };
  const cmp = (a: string, b: string) =>
    pct(state.teams[b]!) - pct(state.teams[a]!) ||
    rpct(`h2h|${b}|${a}`) - rpct(`h2h|${a}|${b}`) ||
    (div(a) === div(b) ? rpct(`div|${b}`) - rpct(`div|${a}`) : 0) ||
    (conf(a) === conf(b) ? rpct(`conf|${b}`) - rpct(`conf|${a}`) : 0) ||
    diff(state.teams[b]!) - diff(state.teams[a]!) ||
    state.teams[b]!.pointsFor - state.teams[a]!.pointsFor ||
    a.localeCompare(b);

  const league = [...codes].sort(cmp);
  league.forEach((c, i) => (state.teams[c]!.leagueRank = i + 1));

  for (const conf of ["AFC", "NFC"] as const) {
    const inConf = codes.filter((c) => TEAMS_BY_CODE[c]!.conference === conf).sort(cmp);
    inConf.forEach((c, i) => (state.teams[c]!.conferenceRank = i + 1));
  }
  const divKey = (c: string) => `${TEAMS_BY_CODE[c]!.conference}-${TEAMS_BY_CODE[c]!.division}`;
  const divs = new Set(codes.map(divKey));
  for (const d of divs) {
    const inDiv = codes.filter((c) => divKey(c) === d).sort(cmp);
    inDiv.forEach((c, i) => (state.teams[c]!.divisionRank = i + 1));
  }

  // The division and conference ranks come from the rule book, not from the shorter ordering above (which stays for
  // the league-wide rank and for a league with no divisions): a division champion is a top-four seed, and ties follow
  // the whole tiebreak procedure.
  const rules = authoritativeStandings(state);
  if (rules) {
    for (const [code, rank] of Object.entries(rules.divisionRank)) state.teams[code]!.divisionRank = rank;
    for (const conf of [rules.AFC, rules.NFC]) conf.order.forEach((code, i) => (state.teams[code]!.conferenceRank = i + 1));
  }
}

function apply(t: TeamState | undefined, g: GameResult, side: "home" | "away"): void {
  if (!t) return;
  const forPts = side === "home" ? g.homeScore : g.awayScore;
  const againstPts = side === "home" ? g.awayScore : g.homeScore;
  t.pointsFor += forPts;
  t.pointsAgainst += againstPts;
  if (forPts > againstPts) t.wins += 1;
  else if (forPts < againstPts) t.losses += 1;
  else t.ties += 1;
}

/** Accumulate per-player season stat lines from a batch of game results. */
export function accrueSeasonStats(state: LeagueState, results: GameResult[]): void {
  for (const g of results) {
    for (const side of ["home", "away"] as const) {
      for (const line of g.playerLines?.[side] ?? []) {
        const p = state.players[line.playerId];
        if (!p) continue;
        // online: what this week added, so a GM who hasn't watched it yet
        // can be shown the season as of the week they have (`statLedger`)
        if (state.statLedger && g.phase === "REG") {
          const week = (state.statLedger[g.week] ??= {});
          const d = (week[line.playerId] ??= { gamesPlayed: 0 });
          d.gamesPlayed += 1;
          for (const [k, v] of Object.entries(line)) {
            if (typeof v !== "number" || v === 0) continue;
            const key = k as keyof PlayerStatLine;
            (d as unknown as Record<string, number>)[key] = ((d as unknown as Record<string, number>)[key] ?? 0) + v;
          }
        }
        const s = (p.season_stats ??= { gamesPlayed: 0 });
        s.gamesPlayed += 1;
        s.passYds = (s.passYds ?? 0) + (line.passYds ?? 0);
        s.passTd = (s.passTd ?? 0) + (line.passTd ?? 0);
        s.passInt = (s.passInt ?? 0) + (line.passInt ?? 0);
        s.passAtt = (s.passAtt ?? 0) + (line.passAtt ?? 0);
        s.passCmp = (s.passCmp ?? 0) + (line.passCmp ?? 0);
        s.rushYds = (s.rushYds ?? 0) + (line.rushYds ?? 0);
        s.rushTd = (s.rushTd ?? 0) + (line.rushTd ?? 0);
        s.rushAtt = (s.rushAtt ?? 0) + (line.rushAtt ?? 0);
        s.rec = (s.rec ?? 0) + (line.rec ?? 0);
        s.recYds = (s.recYds ?? 0) + (line.recYds ?? 0);
        s.recTd = (s.recTd ?? 0) + (line.recTd ?? 0);
        s.tackles = (s.tackles ?? 0) + (line.tackles ?? 0);
        s.sacks = (s.sacks ?? 0) + (line.sacks ?? 0);
        s.defInt = (s.defInt ?? 0) + (line.defInt ?? 0);
        s.passDef = (s.passDef ?? 0) + (line.passDef ?? 0);
        s.ffum = (s.ffum ?? 0) + (line.ffum ?? 0);
        s.fgm = (s.fgm ?? 0) + (line.fgm ?? 0);
        s.fga = (s.fga ?? 0) + (line.fga ?? 0);
        s.xpm = (s.xpm ?? 0) + (line.xpm ?? 0);
        s.xpa = (s.xpa ?? 0) + (line.xpa ?? 0);
      }
    }
  }
}

/** Wipe every player's accumulating season stats (regular-season week 1). */
export function resetSeasonStats(state: LeagueState): void {
  for (const p of Object.values(state.players)) p.season_stats = { gamesPlayed: 0 };
}

/**
 * The season's player stats as of `throughWeek`, for a GM who hasn't watched
 * past it: this block's later weeks (`statLedger`) come back off. Online
 * blocks are simulated whole before anyone watches them, and the stats pages
 * and MVP race used to show every result of the block the moment it ran.
 */
export function rewindSeasonStats(state: LeagueState, throughWeek: number): void {
  const ledger = state.statLedger;
  if (!ledger) return;
  for (const [weekKey, lines] of Object.entries(ledger)) {
    if (Number(weekKey) <= throughWeek) continue;
    for (const [playerId, d] of Object.entries(lines)) {
      const st = state.players[playerId]?.season_stats as unknown as Record<string, number> | undefined;
      if (!st) continue;
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === "number") st[k] = Math.max(0, (st[k] ?? 0) - v);
      }
    }
  }
}
