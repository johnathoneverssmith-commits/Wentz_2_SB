import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

export interface PlayerRow {
  id: string;
  age: number;
  /** The team named on the player, even after he retired (the game keeps it). */
  team: string;
  /** On the open market. */
  fa: boolean;
  retired: boolean;
  /** Contract: years left, this year's cap hit, and how many years of hits are listed; years is -1 with no contract. */
  years: number;
  hit: number;
  hits: number;
  overall: number;
}

export interface Pick {
  n: number;
  round: number;
  team: string;
  id: string | null;
  name: string | null;
}

/** The league as saved, reduced to what the offseason tests reason about. Parsed in the page. */
export interface League {
  stage: string;
  season: number;
  week: number;
  me: string;
  humanTeams: string[];
  teamCodes: string[];
  teams: Record<string, { w: number; l: number; t: number; pf: number; pa: number; capTotal: number; capDead: number }>;
  champions: Array<{ season: number; champion: string; runnerUp: string | null }>;
  teamSeasons: Array<{ season: number; team: string; finish: string; w: number; l: number; t: number }>;
  awards: Array<{ season: number; award: string; playerId: string; name: string }>;
  history: Array<{ season: number; teamCode: string; madePlayoffs: boolean; furthestRound: string; wonSuperBowl: boolean }>;
  hallOfFame: number;
  bracketChampion: string | null;
  hasBracket: boolean;
  players: Record<string, PlayerRow>;
  draft: null | { mode: string; pickOrder: string[]; current: number; results: Pick[] };
  schedule: Array<{ week: number; phase: string; home: string; away: string }>;
  gameCounts: { PRE: number; REG: number; other: number };
}

export async function readLeague(page: Page): Promise<League> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw == null) throw new Error("no saved league");
    const s = (JSON.parse(raw) as { state: Record<string, any> }).state;
    const gms = s.gms as Array<{ id: string; isHuman?: boolean; teamCode?: string }>;
    const me = gms.find((g) => g.id === s.viewerGmId)!.teamCode as string;
    const teams: League["teams"] = {};
    for (const [code, t] of Object.entries(s.teams as Record<string, any>)) teams[code] = { w: t.wins, l: t.losses, t: t.ties, pf: t.pointsFor, pa: t.pointsAgainst, capTotal: t.cap.total, capDead: t.cap.dead ?? 0 };
    const players: League["players"] = {};
    for (const [id, p] of Object.entries(s.players as Record<string, any>)) {
      players[id] = { id, age: p.age, team: p.nfl_team ?? "", fa: Boolean(p.free_agent), retired: Boolean(p.retired), years: p.contract ? p.contract.years_remaining : -1, hit: p.contract?.cap_hit_by_year?.[0] ?? 0, hits: p.contract?.cap_hit_by_year?.length ?? 0, overall: p.overall };
    }
    const games = s.games as Array<{ phase: string }>;
    const d = s.draft as null | { mode: string; pickOrder: string[]; currentPickIndex: number; results: Array<{ pickNumber: number; round: number; teamCode: string; selectedId: string | null; selectedName: string | null }> };
    return {
      stage: s.stage as string,
      season: s.season as number,
      week: s.week as number,
      me,
      humanTeams: gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode as string).sort(),
      teamCodes: Object.keys(teams).sort(),
      teams,
      champions: ((s.champions ?? []) as League["champions"]).map((c) => ({ season: c.season, champion: c.champion, runnerUp: c.runnerUp })),
      teamSeasons: ((s.teamSeasons ?? []) as Array<{ season: number; team: string; finish: string; wins: number; losses: number; ties: number }>).map((r) => ({ season: r.season, team: r.team, finish: r.finish, w: r.wins, l: r.losses, t: r.ties })),
      awards: ((s.awards ?? []) as Array<{ season: number; award: string; playerId: string; name: string }>).map((a) => ({ season: a.season, award: a.award, playerId: a.playerId, name: a.name })),
      history: (s.history as Array<{ season: number; teamCode: string; madePlayoffs: boolean; furthestRound: string; wonSuperBowl: boolean }>).map((h) => ({ season: h.season, teamCode: h.teamCode, madePlayoffs: h.madePlayoffs, furthestRound: h.furthestRound, wonSuperBowl: h.wonSuperBowl })),
      hallOfFame: (s.hallOfFame ?? []).length,
      bracketChampion: s.bracket ? s.bracket.champion : null,
      hasBracket: Boolean(s.bracket),
      players,
      draft: d ? { mode: d.mode, pickOrder: d.pickOrder, current: d.currentPickIndex, results: d.results.map((r) => ({ n: r.pickNumber, round: r.round, team: r.teamCode, id: r.selectedId, name: r.selectedName })) } : null,
      schedule: (s.schedule as Array<{ week: number; phase: string; homeTeam: string; awayTeam: string }>).map((g) => ({ week: g.week, phase: g.phase, home: g.homeTeam, away: g.awayTeam })),
      gameCounts: { PRE: games.filter((g) => g.phase === "PRE").length, REG: games.filter((g) => g.phase === "REG").length, other: games.filter((g) => g.phase !== "PRE" && g.phase !== "REG").length },
    };
  }, SAVE_KEY);
}

export const ROSTER_SIZE = 53;

/** A drafted prospect becomes a player under this id when he is signed (the game's `upsertRookiePlayer`). */
export const rookieOf = (prospectId: string): string => `p_rookie_${prospectId}`;

/** A team's players: named to it, not retired, not on the market. */
export const rosterOf = (l: League, team: string): PlayerRow[] => Object.values(l.players).filter((p) => p.team === team && !p.retired && !p.fa);
export const capUsed = (l: League, team: string): number => Math.round(rosterOf(l, team).reduce((n, p) => n + p.hit, 0) * 10) / 10;
export const retiredIds = (l: League): string[] => Object.values(l.players).filter((p) => p.retired).map((p) => p.id).sort();

/**
 * What a reload must not change. Everything that is a record or a one-time event: the year, the stage, who has retired, the draft as
 * it stands, every kind of history, every player's age, who is on which team and on what contract.
 */
export function stable(l: League) {
  return {
    stage: l.stage,
    season: l.season,
    week: l.week,
    champions: l.champions,
    teamSeasons: l.teamSeasons,
    awards: l.awards,
    history: l.history,
    hallOfFame: l.hallOfFame,
    bracketChampion: l.bracketChampion,
    retired: retiredIds(l),
    draft: l.draft,
    gameCounts: l.gameCounts,
    players: Object.values(l.players).map((p) => `${p.id}|${p.age}|${p.team}|${p.fa ? 1 : 0}|${p.retired ? 1 : 0}|${p.years}|${p.hit}|${p.hits}|${p.overall}`),
    records: Object.entries(l.teams).map(([c, t]) => `${c}|${t.w}-${t.l}-${t.t}|${t.pf}-${t.pa}`),
  };
}

/** The same thirty-two franchises, the same human GM on the same team, whatever the stage. */
export function expectIdentity(l: League, base: League): void {
  expect(l.teamCodes, "the same thirty-two franchises").toEqual(base.teamCodes);
  expect(l.humanTeams, "the human GM still runs the same franchise").toEqual(base.humanTeams);
  expect(l.me).toBe(base.me);
}

/**
 * The season that ended is on the record, once and as it was: the champion and runner-up, every team's season, the awards, the
 * human GMs' history and the Hall of Fame (which only grows).
 */
export function expectHistoryKept(l: League, base: League): void {
  const season = base.season;
  expect(l.champions.filter((c) => c.season === season), `${season}: one champion row`).toEqual(base.champions.filter((c) => c.season === season));
  expect(l.champions.filter((c) => c.season === season)).toHaveLength(1);
  expect(l.champions.find((c) => c.season === season)!.champion, "the champion is the team that won the Super Bowl").toBe(base.bracketChampion);
  expect(l.champions, "no earlier or later season's champion row was lost, changed or doubled").toEqual(expect.arrayContaining(base.champions));
  expect(new Set(l.champions.map((c) => c.season)).size, "one row per season").toBe(l.champions.length);
  expect(l.teamSeasons.filter((r) => r.season === season), `${season}: every team's season`).toEqual(base.teamSeasons.filter((r) => r.season === season));
  expect(l.awards.filter((a) => a.season === season), `${season}: the awards`).toEqual(base.awards.filter((a) => a.season === season));
  expect(l.history.filter((h) => h.season === season), `${season}: the human GMs' history`).toEqual(base.history.filter((h) => h.season === season));
  expect(l.hallOfFame, "the Hall of Fame never shrinks").toBeGreaterThanOrEqual(base.hallOfFame);
}

/** Nobody un-retires; and no retired player is on a roster. */
export function expectRetirements(l: League, earlier: League): void {
  const now = new Set(retiredIds(l));
  for (const id of retiredIds(earlier)) expect(now.has(id), `${id} retired earlier and is back`).toBe(true);
  for (const code of l.teamCodes) for (const p of rosterOf(l, code)) expect(p.retired).toBe(false);
}

/** Every rostered player has a real contract: years left, a positive cap hit. */
export function contractProblems(l: League): string[] {
  const out: string[] = [];
  for (const code of l.teamCodes) for (const p of rosterOf(l, code)) if (p.years < 1 || p.years > 6 || !(p.hit > 0) || p.hits < 1) out.push(`${code} ${p.id}: ${p.years} year(s), hit ${p.hit}, ${p.hits} hit(s) listed`);
  return out;
}

/** A team the game will play: a full roster, every contract real, under the cap. */
export function legalProblems(l: League): string[] {
  const out = contractProblems(l);
  for (const code of l.teamCodes) {
    const n = rosterOf(l, code).length;
    if (n !== ROSTER_SIZE) out.push(`${code}: ${n} players`);
    if (capUsed(l, code) > l.teams[code]!.capTotal) out.push(`${code}: cap ${capUsed(l, code)} of ${l.teams[code]!.capTotal}`);
  }
  return out;
}

/**
 * The rookie draft, from the save alone: 224 picks (seven rounds of the thirty-two teams), no player taken twice, each pick made by the team
 * the order gave it, every round in the same order, and that order the worst regular-season record first. (`prior` is the league as the
 * season left it, for the records the order is made from.)
 */
export function expectDraftValid(l: League, prior: League, complete: boolean): void {
  const d = l.draft!;
  expect(d.mode).toBe("rookie");
  expect(d.pickOrder, "seven rounds of thirty-two").toHaveLength(224);
  const round1 = d.pickOrder.slice(0, 32);
  expect(new Set(round1).size, "round one: every team once").toBe(32);
  for (let r = 1; r < 7; r++) expect(d.pickOrder.slice(r * 32, r * 32 + 32), `round ${r + 1} is round one's order`).toEqual(round1);
  const pct = (c: string) => {
    const t = prior.teams[c]!;
    return (t.w + 0.5 * t.t) / (t.w + t.l + t.t);
  };
  for (let i = 1; i < 32; i++) expect(pct(round1[i]!), `pick ${i + 1} (${round1[i]}) is not worse than pick ${i} (${round1[i - 1]})`).toBeGreaterThanOrEqual(pct(round1[i - 1]!));
  d.results.forEach((r, i) => {
    expect(r.n, "picks are numbered in order").toBe(i + 1);
    expect(r.team, `pick ${i + 1} was made by the team the order gave it`).toBe(d.pickOrder[i]);
    expect(r.round).toBe(Math.floor(i / 32) + 1);
  });
  const ids = d.results.map((r) => r.id).filter((id): id is string => !!id);
  expect(new Set(ids).size, "no player taken twice").toBe(ids.length);
  if (complete) {
    expect(d.results).toHaveLength(224);
    expect(ids).toHaveLength(224);
    for (const code of l.teamCodes) expect(d.results.filter((r) => r.team === code), `${code} made seven picks`).toHaveLength(7);
  }
}
