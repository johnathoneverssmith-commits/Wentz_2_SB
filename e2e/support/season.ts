import { computeStandings } from "../../src/engine/standings.ts";

import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

/** The NFL's two conferences. The league's team list is pinned by fixtures/inputs.json, so this cannot drift silently. */
export const AFC = ["BAL", "BUF", "CIN", "CLE", "DEN", "HOU", "IND", "JAX", "KC", "LAC", "LV", "MIA", "NE", "NYJ", "PIT", "TEN"] as const;
export const NFC = ["ARI", "ATL", "CAR", "CHI", "DAL", "DET", "GB", "LAR", "MIN", "NO", "NYG", "PHI", "SEA", "SF", "TB", "WAS"] as const;

export interface SavedGame {
  id: string;
  week: number;
  phase: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  played: boolean;
}

export interface SavedTeam {
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  confRank: number;
  divRank: number;
  leagueRank: number;
}

/** What the season is, in the league the app saved: stage and week, every game, the schedule, the standings, the bracket. */
export interface Season {
  stage: string;
  week: number;
  me: string;
  games: SavedGame[];
  /** The regular-season schedule: who plays whom, home first, by week. */
  schedule: Array<{ week: number; home: string; away: string }>;
  teams: Record<string, SavedTeam>;
  pending: null | { phase: string; week: number; gameIds: string[] };
  bracket: null | {
    round: string;
    champion: string | null;
    seeds: { AFC: string[]; NFC: string[] };
    matchups: Array<{ round: string; conference: string; high: { code: string; seed: number } | null; low: { code: string; seed: number } | null; winner: string | null; homeScore: number | null }>;
  };
}

export async function readSeason(page: Page): Promise<Season> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw == null) throw new Error("no saved league");
    const s = (JSON.parse(raw) as { state: Record<string, any> }).state;
    const me = (s.gms as Array<{ id: string; teamCode?: string }>).find((g) => g.id === s.viewerGmId)!.teamCode as string;
    const teams: Record<string, SavedTeam> = {};
    for (const [code, t] of Object.entries(s.teams as Record<string, any>)) {
      teams[code] = { w: t.wins, l: t.losses, t: t.ties, pf: t.pointsFor, pa: t.pointsAgainst, confRank: t.conferenceRank, divRank: t.divisionRank, leagueRank: t.leagueRank };
    }
    const b = s.bracket as null | { currentRound: string; champion: string | null; seeds: { AFC: string[]; NFC: string[] }; matchups: Array<{ round: string; conference: string; highSeed: { code: string; seed: number } | null; lowSeed: { code: string; seed: number } | null; winner: string | null; homeScore: number | null }> };
    return {
      stage: s.stage as string,
      week: s.week as number,
      me,
      games: (s.games as Array<Record<string, any>>).map((g) => ({ id: g.id, week: g.week, phase: g.phase, home: g.homeTeam, away: g.awayTeam, homeScore: g.homeScore, awayScore: g.awayScore, played: Boolean(g.played) })),
      schedule: (s.schedule as Array<{ week: number; phase: string; homeTeam: string; awayTeam: string }>).filter((g) => g.phase === "REG").map((g) => ({ week: g.week, home: g.homeTeam, away: g.awayTeam })),
      teams,
      pending: s.pendingGameDay ? { phase: s.pendingGameDay.phase, week: s.pendingGameDay.week, gameIds: s.pendingGameDay.gameIds } : null,
      bracket: b ? { round: b.currentRound, champion: b.champion, seeds: b.seeds, matchups: b.matchups.map((m) => ({ round: m.round, conference: m.conference, high: m.highSeed, low: m.lowSeed, winner: m.winner, homeScore: m.homeScore })) } : null,
    };
  }, SAVE_KEY);
}

export const regGames = (s: Season, week?: number): SavedGame[] => s.games.filter((g) => g.phase === "REG" && (week === undefined || g.week === week));
export const scheduledIn = (s: Season, week: number) => s.schedule.filter((g) => g.week === week);

/** How the app writes a record: wins-losses, with ties added only when there are some. */
export const recordText = (t: { w: number; l: number; t: number }): string => (t.t > 0 ? `${t.w}-${t.l}-${t.t}` : `${t.w}-${t.l}`);

/** The standings, recounted from the games alone: what the saved standings must equal. */
export function recount(s: Season): Record<string, { w: number; l: number; t: number; pf: number; pa: number }> {
  const out: Record<string, { w: number; l: number; t: number; pf: number; pa: number }> = {};
  for (const code of Object.keys(s.teams)) out[code] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  for (const g of regGames(s)) {
    if (!g.played) continue;
    for (const [code, mine, theirs] of [[g.home, g.homeScore, g.awayScore], [g.away, g.awayScore, g.homeScore]] as const) {
      const r = out[code]!;
      r.pf += mine;
      r.pa += theirs;
      if (mine > theirs) r.w += 1;
      else if (mine < theirs) r.l += 1;
      else r.t += 1;
    }
  }
  return out;
}

/**
 * Everything that must be true of the regular season so far, checked against the saved league alone:
 *   - each game is on the schedule, and is there exactly once; no game is on the books twice, none is invented;
 *   - every scheduled game of every completed week has been played, and none of any later week;
 *   - no team plays twice in a week;
 *   - each team's record and points are what its games add up to, and the ranks agree with the records.
 * `through` is the last week that must be complete.
 */
export function expectSeasonConsistent(s: Season, through: number): void {
  const games = regGames(s);
  const ids = games.map((g) => g.id);
  expect(new Set(ids).size, "no game is on the books twice").toBe(ids.length);
  expect(games.every((g) => g.played), "every game on the books has been played").toBe(true);

  const key = (g: { week: number; home: string; away: string }) => `${g.week}|${g.home}|${g.away}`;
  const wanted = s.schedule.filter((g) => g.week <= through).map(key).sort();
  expect(games.map(key).sort(), `exactly the scheduled games of weeks 1-${through}, each once`).toEqual(wanted);

  for (let week = 1; week <= through; week++) {
    const teams = regGames(s, week).flatMap((g) => [g.home, g.away]);
    expect(new Set(teams).size, `week ${week}: no team plays twice`).toBe(teams.length);
  }

  const counted = recount(s);
  for (const [code, t] of Object.entries(s.teams)) {
    expect({ w: t.w, l: t.l, t: t.t, pf: t.pf, pa: t.pa }, `${code}'s record is what its games add up to`).toEqual(counted[code]);
  }

  // league-wide, every win is somebody's loss and every point scored is a point allowed
  const all = Object.values(counted);
  expect(all.reduce((n, r) => n + r.w, 0)).toBe(all.reduce((n, r) => n + r.l, 0));
  expect(all.reduce((n, r) => n + r.pf, 0)).toBe(all.reduce((n, r) => n + r.pa, 0));

  // ranks: every rank 1..n is used once, and a team with a better winning percentage is never ranked behind a worse one
  const pct = (t: SavedTeam) => (t.w + t.l + t.t === 0 ? 0 : (t.w + 0.5 * t.t) / (t.w + t.l + t.t));
  const groups: Record<string, { codes: string[]; rank: (t: SavedTeam) => number }> = {
    league: { codes: Object.keys(s.teams), rank: (t) => t.leagueRank },
    AFC: { codes: [...AFC], rank: (t) => t.confRank },
    NFC: { codes: [...NFC], rank: (t) => t.confRank },
  };
  for (const [name, g] of Object.entries(groups)) {
    expect(g.codes.map((c) => g.rank(s.teams[c]!)).sort((a, b) => a - b), `${name}: ranks 1..${g.codes.length}, each once`).toEqual(g.codes.map((_, i) => i + 1));
    for (const a of g.codes) for (const b of g.codes) if (pct(s.teams[a]!) > pct(s.teams[b]!)) expect(g.rank(s.teams[a]!), `${name}: ${a} (${recordText(s.teams[a]!)}) ranks ahead of ${b} (${recordText(s.teams[b]!)})`).toBeLessThan(g.rank(s.teams[b]!));
  }
}

/** A digest of every game on the books (who, when, the score), to show none was replayed or rewritten. */
export const gamesDigest = (s: Season): string => s.games.map((g) => `${g.id}:${g.phase}:${g.week}:${g.home}:${g.away}:${g.homeScore}-${g.awayScore}`).join("\n");

/** Independent of Mock and saved ranks: the documented main-engine NFL rules, from completed games only. */
export function authoritativeSeeding(s: Season) {
  const engineCode = (c: string) => c === "LAR" ? "LA" : c;
  const uiCode = (c: string) => c === "LA" ? "LAR" : c;
  const standings = computeStandings(regGames(s).filter((g) => g.played).map((g) => ({
    home: engineCode(g.home), away: engineCode(g.away), homeScore: g.homeScore, awayScore: g.awayScore,
  })));
  const conference = (conf: "AFC" | "NFC") => ({
    seeds: standings.seeding[conf].seeds.map(uiCode),
    divisionWinners: standings.seeding[conf].divisionWinners.map(uiCode),
    wildCards: standings.seeding[conf].wildCards.map(uiCode),
  });
  return { AFC: conference("AFC"), NFC: conference("NFC") };
}

/** Independent identity oracle. The fixture pins the source team list; names must match a saved code, not another rendered row. */
const IDENTITIES: Record<string, readonly [string, string]> = {
  BAL: ["Baltimore Ravens", "Baltimore"], BUF: ["Buffalo Bills", "Buffalo"],
  CIN: ["Cincinnati Bengals", "Cincinnati"], CLE: ["Cleveland Browns", "Cleveland"],
  DEN: ["Denver Broncos", "Denver"], HOU: ["Houston Texans", "Houston"],
  IND: ["Indianapolis Colts", "Indianapolis"], JAX: ["Jacksonville Jaguars", "Jacksonville"],
  KC: ["Kansas City Chiefs", "Kansas City"], LAC: ["Los Angeles Chargers", "L.A. Chargers"],
  LV: ["Las Vegas Raiders", "Las Vegas"], MIA: ["Miami Dolphins", "Miami"],
  NE: ["New England Patriots", "New England"], NYJ: ["New York Jets", "N.Y. Jets"],
  PIT: ["Pittsburgh Steelers", "Pittsburgh"], TEN: ["Tennessee Titans", "Tennessee"],
  ARI: ["Arizona Cardinals", "Arizona"], ATL: ["Atlanta Falcons", "Atlanta"],
  CAR: ["Carolina Panthers", "Carolina"], CHI: ["Chicago Bears", "Chicago"],
  DAL: ["Dallas Cowboys", "Dallas"], DET: ["Detroit Lions", "Detroit"],
  GB: ["Green Bay Packers", "Green Bay"], LAR: ["Los Angeles Rams", "L.A. Rams"],
  MIN: ["Minnesota Vikings", "Minnesota"], NO: ["New Orleans Saints", "New Orleans"],
  NYG: ["New York Giants", "N.Y. Giants"], PHI: ["Philadelphia Eagles", "Philadelphia"],
  SEA: ["Seattle Seahawks", "Seattle"], SF: ["San Francisco 49ers", "San Francisco"],
  TB: ["Tampa Bay Buccaneers", "Tampa Bay"], WAS: ["Washington Commanders", "Washington"],
};
export function teamIdentity(code: string) {
  const identity = IDENTITIES[code];
  if (!identity) throw new Error(`unknown persisted team identity: ${code}`);
  return { name: identity[0], label: identity[1] };
}
