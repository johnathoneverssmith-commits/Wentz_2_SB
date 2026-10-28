import type { Contract } from "../../ui-source/src/domain/player.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { runProcess } from "../../.claude/skills/wentz-verify/run-checks.mjs";
import { REPO_ROOT } from "./stack.ts";
import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

export interface PlayerRow {
  id: string;
  age: number;
  storedId: string;
  holdout: string | null;
  position: string;
  yearsPro: number;
  contract: Contract | null;
  draftInfo: { round: number; pick: number; class_year: number } | null;
  retiredSeason: number | null;
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
  /** How far the cap has risen since the league began (1 if it has not): the factor on the minimum deal and the squad salary. */
  capScale: number;
  teams: Record<string, { w: number; l: number; t: number; pf: number; pa: number; capTotal: number; capDead: number }>;
  champions: Array<{ season: number; champion: string; runnerUp: string | null }>;
  teamSeasons: Array<{ season: number; team: string; finish: string; w: number; l: number; t: number }>;
  awards: Array<{ season: number; award: string; playerId: string; name: string }>;
  history: Array<{ season: number; teamCode: string; madePlayoffs: boolean; furthestRound: string; wonSuperBowl: boolean }>;
  hallOfFame: number;
  bracketChampion: string | null;
  hasBracket: boolean;
  /** Every playoff game as played, in the order saved (null once the bracket is gone). */
  playoffGames: null | Array<{ round: string; teams: string[]; winner: string | null }>;
  players: Record<string, PlayerRow>;
  draft: null | { mode: string; pickOrder: string[]; current: number; results: Pick[] };
  signings: Array<{ playerId: string; teamCode: string; salary: number; years: number; round: number }>;
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
    const capScale = typeof s.capScale === "number" && s.capScale > 0 ? (s.capScale as number) : 1;
    const players: League["players"] = {};
    for (const [id, p] of Object.entries(s.players as Record<string, any>)) {
      players[id] = { id, storedId: p.id, holdout: p.holdout ?? null, position: p.position, yearsPro: p.years_pro, contract: p.contract ?? null, draftInfo: p.draft_info ?? null, retiredSeason: p.retired_season ?? null, age: p.age, team: p.nfl_team ?? "", fa: Boolean(p.free_agent), retired: Boolean(p.retired), years: p.contract ? p.contract.years_remaining : -1, hit: p.contract?.cap_hit_by_year?.[0] ?? 0, hits: p.contract?.cap_hit_by_year?.length ?? 0, overall: p.overall };
    }
    const games = s.games as Array<{ phase: string }>;
    const d = s.draft as null | { mode: string; pickOrder: string[]; currentPickIndex: number; results: Array<{ pickNumber: number; round: number; teamCode: string; selectedId: string | null; selectedName: string | null }> };
    return {
      stage: s.stage as string,
      season: s.season as number,
      week: s.week as number,
      capScale,
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
      playoffGames: s.bracket ? (s.bracket.matchups as Array<{ round: string; highSeed: { code: string } | null; lowSeed: { code: string } | null; winner: string | null }>).map((m) => ({ round: m.round, teams: [m.highSeed?.code, m.lowSeed?.code].filter((c): c is string => !!c), winner: m.winner })) : null,
      players,
      draft: d ? { mode: d.mode, pickOrder: d.pickOrder, current: d.currentPickIndex, results: d.results.map((r) => ({ n: r.pickNumber, round: r.round, team: r.teamCode, id: r.selectedId, name: r.selectedName })) } : null,
      signings: (s.freeAgencyEvent?.signed ?? []).map((x: any) => ({ playerId: x.playerId, teamCode: x.teamCode, salary: x.salary, years: x.years, round: x.round })),
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
    players: l.players,
    signings: l.signings,
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
 * The NFL's draft order, derived from the finished season in the save and written without the game's sorting code: each team's fate comes
 * from the last playoff game it appears in, its record from the saved standings, and its schedule strength from the saved schedule.
 *
 *  - Picks 1-18: the teams that missed the playoffs. Then those out in the wild card, the divisional round, the conference final, the
 *    Super Bowl runner-up (31st) and the champion (32nd). Within a stage, the worse record picks first.
 *  - Level on record: the weaker schedule (the lower combined win percentage of the opponents it played) first, then fewer net points.
 *  - Still level (only the coin toss can tell them apart): the group keeps its members in the later rounds and rotates: a pair swaps each
 *    round, and in a larger group the first moves to the end while the others move up one.
 */
export function expectNflDraftOrder(pickOrder: string[], prior: League): void {
  expect(prior.playoffGames, "the finished season's bracket is in the save").not.toBeNull();
  const games = prior.playoffGames!;
  const champion = prior.bracketChampion!;
  const lastGame = new Map<string, { round: string; winner: string | null }>();
  for (const g of games) for (const t of g.teams) lastGame.set(t, { round: g.round, winner: g.winner });
  const stageOf = (code: string): number => {
    const g = lastGame.get(code);
    if (!g) return 0; // missed the playoffs
    if (code === champion) return 5;
    expect(g.winner, `${code} went out in its last game, the ${g.round}`).not.toBe(code);
    return { WC: 1, DIV: 2, CONF: 3, SB: 4 }[g.round]!;
  };
  const expectedSizes = [0, 0, 0, 0, 0, 0];
  for (const c of prior.teamCodes) expectedSizes[stageOf(c)]!++;
  expect(expectedSizes, "18 missed the playoffs; 14 made them: 6 out in the wild card, 4 in the divisional round, 2 in the conference final, the runner-up, the champion").toEqual([18, 6, 4, 2, 1, 1]);

  const pct = (c: string) => {
    const t = prior.teams[c]!;
    return (t.w + 0.5 * t.t) / (t.w + t.l + t.t);
  };
  const faced = new Map<string, string[]>();
  for (const g of prior.schedule.filter((x) => x.phase === "REG")) {
    faced.set(g.home, [...(faced.get(g.home) ?? []), g.away]);
    faced.set(g.away, [...(faced.get(g.away) ?? []), g.home]);
  }
  const sos = (c: string) => {
    let credit = 0, played = 0;
    for (const o of faced.get(c) ?? []) {
      const t = prior.teams[o]!;
      credit += t.w + 0.5 * t.t;
      played += t.w + t.l + t.t;
    }
    return played === 0 ? 0.5 : credit / played;
  };
  const net = (c: string) => prior.teams[c]!.pf - prior.teams[c]!.pa;
  const same = (a: string, b: string) => stageOf(a) === stageOf(b) && Math.abs(pct(a) - pct(b)) < 1e-9 && Math.abs(sos(a) - sos(b)) < 1e-9 && net(a) === net(b);

  expect(pickOrder, "seven rounds of thirty-two").toHaveLength(224);
  const round1 = pickOrder.slice(0, 32);
  expect(new Set(round1).size, "round one: every team once").toBe(32);

  // stage by stage, in order, then within a stage the tiebreaks in order
  for (let i = 1; i < 32; i++) {
    const a = round1[i - 1]!, b = round1[i]!;
    const where = `pick ${i} (${a}) then pick ${i + 1} (${b})`;
    expect(stageOf(b), `${where}: the playoff stage never goes back (missed, wild card, divisional, conference, runner-up, champion)`).toBeGreaterThanOrEqual(stageOf(a));
    if (stageOf(a) !== stageOf(b)) continue;
    if (Math.abs(pct(a) - pct(b)) > 1e-9) expect(pct(b), `${where}: the worse record picks first`).toBeGreaterThan(pct(a));
    else if (Math.abs(sos(a) - sos(b)) > 1e-9) expect(sos(b), `${where}: level on record, the weaker schedule picks first`).toBeGreaterThan(sos(a));
    else if (net(a) !== net(b)) expect(net(b), `${where}: level on schedule, the fewer net points pick first`).toBeGreaterThan(net(a));
  }
  expect(stageOf(round1[30]!), "31st: the Super Bowl runner-up").toBe(4);
  expect(stageOf(round1[31]!), "32nd: the Super Bowl champion").toBe(5);
  expect(round1[31]).toBe(champion);
  expect(round1.slice(0, expectedSizes[0]!).every((c) => stageOf(c) === 0), "the first picks are the teams that missed the playoffs").toBe(true);

  // later rounds: the same order, except groups only the coin toss separated, which rotate
  const groups: string[][] = [];
  for (const c of round1) {
    const g = groups[groups.length - 1];
    if (g && same(g[0]!, c)) g.push(c);
    else groups.push([c]);
  }
  for (let r = 2; r <= 7; r++) {
    const want = groups.flatMap((g) => [...g.slice((r - 1) % g.length), ...g.slice(0, (r - 1) % g.length)]);
    expect(pickOrder.slice((r - 1) * 32, r * 32), `round ${r}: round one's order, with tied groups rotated ${r - 1} place(s)`).toEqual(want);
  }
}

/**
 * The rookie draft, from the save alone: 224 picks (seven rounds of the thirty-two teams), no player taken twice, each pick made by the team
 * the order gave it, in the NFL's order (`expectNflDraftOrder`). (`prior` is the league as the season left it, for the bracket, records and
 * schedule the order is made from.)
 */
export function expectDraftValid(l: League, prior: League, complete: boolean): void {
  const d = l.draft!;
  expect(d.mode).toBe("rookie");
  expect(d.pickOrder, "seven rounds of thirty-two").toHaveLength(224);
  expectNflDraftOrder(d.pickOrder, prior);
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


export interface ExtensionQuote {
  eligible: boolean;
  marketNow: number;
  marketBefore: number | null;
  offer: { baseSalary: number; years: number; guaranteed: number };
}
export type ExtensionQuotes = Record<string, ExtensionQuote>;

/**
 * Read-only quotes from the authoritative contract API, NOT startHoldouts/applyExtension.
 * Use post-CPU-camp ratings with the pre-camp contracts. The oracle independently checks
 * the allowed boundary, CPU ownership, preserved fields, every new term and cap legality.
 * There is no extension transaction log; eligibility + exact quote is the available evidence.
 */
export async function contractRuleQuotes(page: Page, before: League): Promise<ExtensionQuotes> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key)!, SAVE_KEY);
  const state = (JSON.parse(raw) as { state: Record<string, any> }).state;
  for (const [id, p] of Object.entries(state.players as Record<string, any>)) {
    if (before.players[id]) p.contract = before.players[id]!.contract;
  }
  state.priorPlayers = before.players;
  const dir = mkdtempSync(join(tmpdir(), "wentz-contract-quotes-"));
  try {
    const input = join(dir, "input.json"), output = join(dir, "output.json");
    writeFileSync(input, JSON.stringify(state));
    const r = await runProcess({ file: process.execPath, args: [createRequire(import.meta.url).resolve("tsx/cli"), "--tsconfig", "tsconfig.app.json", fileURLToPath(new URL("../fixtures/contract-quotes.ts", import.meta.url)), input, output], shell: false },
      { cwd: join(REPO_ROOT, "ui-source"), env: baseEnvironment(process.env), timeoutMs: 30_000 });
    if (r.error || r.timedOut || r.status !== 0) throw new Error("Reading contract quotes failed: " + (r.error ?? r.stderr));
    return JSON.parse(readFileSync(output, "utf8")) as ExtensionQuotes;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface OffseasonWindow {
  /** Roster reconciliation can cut or stash players; it cannot transfer active players. */
  reconcile?: boolean;
  retirement?: boolean;
  /** The preseason gate can sign players previously observed on the market. */
  fill?: boolean;
  fillQuotes?: ExtensionQuotes;
  /** Rollover may retire market players; this year's rookies cannot disappear. */
  rollover?: boolean;
  /** Only entry into camp can automatically extend CPU players. */
  campQuotes?: ExtensionQuotes;
}
const owner = (p: PlayerRow) => p.team.startsWith("PS:") ? p.team.slice(3) : p.team;
const roundMoney = (x: number) => Math.round(x * 10) / 10;
/** The league minimum deal and the practice-squad salary at the league's prices ($M), as the game writes them. */
export const minDealOf = (l: { capScale: number }): number => roundMoney(l.capScale);
export const squadDealOf = (l: { capScale: number }): number => Math.round(0.2 * l.capScale * 100) / 100;

/**
 * All selected rookies must remain individually identifiable. No majority threshold.
 * A same-action cut/re-sign without a persisted signing record or an intervening market
 * snapshot cannot be proved; it is rejected rather than inventing a transaction.
 */
export function expectRookieAccounting(picks: Pick[], before: League, after: League, window: OffseasonWindow = {}): void {
  expect(picks).toHaveLength(224);
  const ids = picks.map(r => rookieOf(r.id!));
  expect(new Set(ids).size, "224 distinct signed rookie identities").toBe(224);
  const storedIds = Object.values(after.players).map(p => p.storedId);
  expect(new Set(storedIds).size, "one saved record per player identity").toBe(storedIds.length);
  for (const r of picks) {
    const id = rookieOf(r.id!);
    const was = before.players[id], p = after.players[id];
    expect(p, "pick " + r.n + ": rookie must not silently disappear").toBeTruthy();
    expect(p!.storedId, id + ": saved key and player identity").toBe(id);
    expect(p!.draftInfo, id + ": original selection preserved").toEqual({ round: r.round, pick: r.n, class_year: before.players[id]?.draftInfo?.class_year ?? before.season });
    if (!was) {
      expect(p, id + ": first assignment is the drafting team").toMatchObject({ team: r.team, fa: false, retired: false });
      continue;
    }
    expectOwnershipTransition(was, p!, before, after, window);
  }
}

/** No transfers are inferred from a destination alone. Record or observed market state required. */
function expectOwnershipTransition(was: PlayerRow, p: PlayerRow, before: League, after: League, window: OffseasonWindow): void {
  const label = p.id + ": ";
  if (was.retired) {
    expect(p.retired, label + "retirement is permanent").toBe(true);
    expect(p.team, label + "retired identity's team is unchanged").toBe(was.team);
    return;
  }
  if (p.retired) {
    expect(window.rollover && was.fa, label + "only an observed market player can be pruned at rollover").toBe(true);
    expect(p.retiredSeason, label + "retirement belongs to this rollover").toBe(after.season);
    expect(p.contract).toBeNull();
    return;
  }
  if (p.fa) {
    expect(p.team, label + "released player belongs to the market").toBe("FA");
    expect(p.contract).toBeNull();
    expect(was.fa || window.reconcile, label + "release requires a reconciliation boundary").toBeTruthy();
    return;
  }
  if (was.team === p.team && !was.fa) return;
  if (!was.fa && owner(was) === owner(p) && p.team.startsWith("PS:")) {
    expect(window.reconcile, label + "practice-squad move requires reconciliation").toBe(true);
    expect(was.yearsPro).toBeLessThanOrEqual(2);
    expect(was.hit).toBeLessThanOrEqual(1.5 * after.capScale);
    expect(Object.values(after.players).filter(x => x.team === p.team && !x.retired).length).toBeLessThanOrEqual(16);
    return;
  }
  if (was.team.startsWith("PS:") && p.team === owner(was) && (window.reconcile || window.fill)) {
    expect(p.contract, label + "promotion uses the one-year minimum deal").toEqual({
      team_id: p.team, years_remaining: 1, total_value: minDealOf(after), guaranteed: 0, cap_hit_by_year: [minDealOf(after)], signing_bonus: 0 });
    return;
  }
  const signing = after.signings.find(x => x.playerId === p.id && x.teamCode === p.team &&
    !before.signings.some(old => JSON.stringify(old) === JSON.stringify(x)));
  expect(Boolean(signing) || (was.fa && window.fill), label + "unexplained ownership change").toBe(true);
  expect(after.teamCodes).toContain(p.team);
}

/** Complete contracts are immutable outside an evidenced signing, PS move or eligible CPU camp extension. */
export function expectContractContinuity(before: League, after: League, window: OffseasonWindow = {}): number {
  let extensions = 0;
  const extendedTeams = new Set<string>();
  for (const [id, was] of Object.entries(before.players)) {
    const p = after.players[id];
    // Old retirees and generated emergency/depth fillers have documented compaction/removal paths.
    if (!p) {
      expect(was.retired || id.startsWith("p_depth_") || id.startsWith("emg_"), id + ": unexplained missing contracted player").toBe(true);
      continue;
    }
    if (was.retired) { expect(p.retired, id + ": retirement remains permanent").toBe(true); continue; }
    if (p.retired) {
      expect(window.retirement || (window.rollover && was.fa), id + ": retirement requires retirement review or observed market pruning").toBeTruthy();
      continue;
    }
    expectOwnershipTransition(was, p, before, after, window);
    if (p.fa) continue;
    const recorded = after.signings.find(x => x.playerId === id && x.teamCode === p.team && !before.signings.some(old => JSON.stringify(old) === JSON.stringify(x)));
    if (was.fa || recorded) {
      const signing = recorded;
      if (signing) {
        expect(p.contract, id + ": free-agency signing terms").toEqual({
          team_id: p.team, years_remaining: signing.years, total_value: roundMoney(signing.salary * signing.years),
          guaranteed: 0, cap_hit_by_year: Array(signing.years).fill(signing.salary), signing_bonus: 0,
        });
      } else {
        expect(window.fill, id + ": unrecorded signing requires an observed free agent and roster fill").toBe(true);
        const c = p.contract!, quote = window.fillQuotes?.[id];
        expect(quote, id + ": unlogged roster-fill signing needs authoritative market quotes").toBeTruthy();
        const full = [quote!.marketBefore, quote!.marketNow].filter((n): n is number => n !== null).map(n => roundMoney(Math.max(minDealOf(after), n)));
        const late = [quote!.marketBefore, quote!.marketNow].filter((n): n is number => n !== null).map(n => Math.max(minDealOf(after), roundMoney(n * 0.35)));
        expect(Number.isInteger(c.years_remaining) && c.years_remaining >= 1 && c.years_remaining <= 5, id + ": documented fill term").toBe(true);
        expect(c.years_remaining === 1 ? [minDealOf(after), ...late] : [minDealOf(after), ...full], id + ": documented fill price").toContain(c.cap_hit_by_year[0]);
        expect(p.contract, id + ": complete roster-fill signing terms").toEqual({
          team_id: p.team, years_remaining: c.years_remaining,
          total_value: roundMoney(c.cap_hit_by_year[0]! * c.years_remaining),
          guaranteed: 0, cap_hit_by_year: Array(c.years_remaining).fill(c.cap_hit_by_year[0]), signing_bonus: 0,
        });
      }
      continue;
    }
    if (was.team !== p.team) {
      // Ownership already proved above. Same-owner PS moves have fixed published terms.
      if (p.team.startsWith("PS:") && owner(p) === owner(was)) {
        expect(p.contract, id + ": practice-squad terms").toEqual({ team_id: owner(p), years_remaining: 1, total_value: squadDealOf(after), guaranteed: 0, cap_hit_by_year: [squadDealOf(after)], signing_bonus: 0 });
        continue;
      }
      if (was.team.startsWith("PS:") && p.team === owner(was)) continue;
      throw new Error(id + ": active-player transfer needs a separate observed release before contract comparison");
    }
    if (JSON.stringify(p.contract) === JSON.stringify(was.contract)) continue;
    const q = window.campQuotes?.[id];
    expect(window.campQuotes && before.stage === "freeAgencySummary" && after.stage === "trainingCamp",
      id + ": contract changed outside CPU camp entry").toBeTruthy();
    expect(before.humanTeams, id + ": human contract requires an explicit authorized action").not.toContain(p.team);
    expect(q?.eligible, id + ": CPU extension must meet authoritative holdout rules").toBe(true);
    expect(was.contract, id + ": extension requires an existing contract").not.toBeNull();
    expect(extendedTeams.has(p.team), id + ": at most one CPU holdout extension per team").toBe(false);
    extendedTeams.add(p.team);
    const c = was.contract!, offer = q!.offer, carried = c.prorated_per_year ?? 0;
    const priorCommitments = Object.values(before.players).filter(x => x.team === p.team && !x.retired && x.contract && x.contract.years_remaining >= 2)
      .reduce((n, x) => n + (x.contract!.cap_hit_by_year[1] ?? 0), 0);
    expect(roundMoney(priorCommitments - (c.cap_hit_by_year[1] ?? 0) + offer.baseSalary),
      id + ": CPU holdout offer preserves the documented $12M budget buffer (a share of the cap: $12M at the starting prices)").toBeLessThanOrEqual(after.teams[p.team]!.capTotal - 12 * after.capScale);
    const expected = { ...c, years_remaining: 1 + offer.years,
      cap_hit_by_year: [c.cap_hit_by_year[0]!, ...Array(offer.years).fill(roundMoney(offer.baseSalary + carried))],
      total_value: roundMoney(c.cap_hit_by_year[0]! + (offer.baseSalary + carried) * offer.years),
      guaranteed: offer.guaranteed, option_exercised: true };
    delete expected.franchise_tag_season; delete expected.franchise_tag_price;
    expect(p.contract, id + ": CPU extension matches every quoted term").toEqual(expected);
    const nextPayroll = Object.values(after.players).filter(x => x.team === p.team && !x.fa && !x.retired && x.contract && x.contract.years_remaining >= 2)
      .reduce((n, x) => n + (x.contract!.cap_hit_by_year[1] ?? 0), 0);
    expect(roundMoney(nextPayroll), id + ": CPU extension fits next year's cap").toBeLessThanOrEqual(after.teams[p.team]!.capTotal);
    extensions++;
  }
  return extensions;
}
