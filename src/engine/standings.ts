/**
 * NFL standings + playoff seeding (Phase A1).
 *
 * Takes a list of finished games and produces division ranks and the seven
 * playoff seeds per conference, applying the league's tiebreaker procedure:
 * head-to-head, then division / common / conference records, then strength of
 * victory and strength of schedule, then net points, then a deterministic
 * fallback (team code) standing in for the coin toss. The obscure
 * "combined ranking of points scored and allowed" steps are folded into the net
 * points comparison — they change the outcome only in vanishingly rare cases.
 *
 * Division seeds are 1–4 (four division winners, ranked against each other by
 * the inter-division procedure); wild cards are 5–7 (best three non-winners in
 * the conference). #1 seed gets the bye.
 */

import {
  type Conference,
  type DivisionId,
  DIVISION_IDS,
  NFL_TEAMS,
  conferenceOf,
  divisionOf,
} from "./nfl-structure.js";

export interface FinishedGame {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export interface StandingRow {
  team: string;
  conference: Conference;
  division: DivisionId;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  winPct: number;
  divisionRecord: string; // "W-L" or "W-L-T"
  conferenceRecord: string;
  /** 1–4 within the division (1 = division winner). */
  divisionRank: number;
  /** 1–7 for a playoff team, else null. */
  seed: number | null;
  madePlayoffs: boolean;
  wonDivision: boolean;
}

export interface ConferenceSeeding {
  /** Team codes, index 0 = #1 seed … index 6 = #7 seed. */
  seeds: string[];
  divisionWinners: string[]; // seeds 1–4, in seed order
  wildCards: string[]; // seeds 5–7, in seed order
}

export interface LeagueStandings {
  rows: StandingRow[]; // all teams, sorted conference → seed/divisionRank
  seeding: Record<Conference, ConferenceSeeding>;
}

// --- per-team game log -------------------------------------------------------

interface Entry {
  opp: string;
  pf: number;
  pa: number;
  res: "W" | "L" | "T";
}

function pct(w: number, l: number, t: number): number {
  const g = w + l + t;
  return g === 0 ? 0.5 : (w + 0.5 * t) / g;
}

function recordString(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

class Season {
  readonly log = new Map<string, Entry[]>();
  readonly teams: string[];

  constructor(games: FinishedGame[], teams: string[]) {
    this.teams = [...teams].sort();
    for (const t of this.teams) this.log.set(t, []);
    for (const g of games) {
      const h = this.log.get(g.home);
      const a = this.log.get(g.away);
      if (!h || !a) throw new Error(`standings: game references unknown team ${g.home}/${g.away}`);
      const hres = g.homeScore > g.awayScore ? "W" : g.homeScore < g.awayScore ? "L" : "T";
      const ares = hres === "W" ? "L" : hres === "L" ? "W" : "T";
      h.push({ opp: g.away, pf: g.homeScore, pa: g.awayScore, res: hres });
      a.push({ opp: g.home, pf: g.awayScore, pa: g.homeScore, res: ares });
    }
  }

  tally(team: string, filter: (e: Entry) => boolean) {
    let w = 0;
    let l = 0;
    let t = 0;
    let pf = 0;
    let pa = 0;
    for (const e of this.log.get(team) ?? []) {
      if (!filter(e)) continue;
      if (e.res === "W") w += 1;
      else if (e.res === "L") l += 1;
      else t += 1;
      pf += e.pf;
      pa += e.pa;
    }
    return { w, l, t, pf, pa };
  }

  overall(team: string) {
    return this.tally(team, () => true);
  }
  overallPct(team: string): number {
    const { w, l, t } = this.overall(team);
    return pct(w, l, t);
  }
  divisionPct(team: string): number {
    const { w, l, t } = this.tally(team, (e) => divisionOf(e.opp) === divisionOf(team));
    return pct(w, l, t);
  }
  conferencePct(team: string): number {
    const { w, l, t } = this.tally(team, (e) => conferenceOf(e.opp) === conferenceOf(team));
    return pct(w, l, t);
  }

  /** Win% in games among exactly this set of teams (head-to-head). */
  headToHeadPct(team: string, group: Set<string>): number {
    const { w, l, t } = this.tally(team, (e) => group.has(e.opp) && e.opp !== team);
    return pct(w, l, t);
  }

  /** "Sweep" test: +1 if team beat every other in group, -1 if lost to every, else 0. */
  headToHeadSweep(team: string, group: string[]): number {
    const others = group.filter((x) => x !== team);
    if (others.length === 0) return 0;
    let wins = 0;
    let losses = 0;
    let meetings = 0;
    for (const e of this.log.get(team) ?? []) {
      if (!others.includes(e.opp)) continue;
      meetings += 1;
      if (e.res === "W") wins += 1;
      else if (e.res === "L") losses += 1;
    }
    // need to have actually played all of them
    const oppsPlayed = new Set((this.log.get(team) ?? []).map((e) => e.opp));
    if (!others.every((o) => oppsPlayed.has(o))) return 0;
    if (wins === meetings && meetings >= others.length) return 1;
    if (losses === meetings && meetings >= others.length) return -1;
    return 0;
  }

  /**
   * Win% against opponents that every club in `group` has faced. "Common
   * opponents" are third parties — games between the tied clubs themselves are
   * excluded. Returns null if there are none (or fewer than `minGames`).
   */
  commonGamesPct(team: string, group: string[], minGames: number): number | null {
    const inGroup = new Set(group);
    const played = group.map(
      (g) => new Set((this.log.get(g) ?? []).map((e) => e.opp).filter((o) => !inGroup.has(o))),
    );
    const common = new Set<string>();
    for (const opp of played[0] ?? []) {
      if (played.every((s) => s.has(opp))) common.add(opp);
    }
    if (common.size === 0) return null;
    const { w, l, t } = this.tally(team, (e) => common.has(e.opp));
    if (minGames > 0 && w + l + t < minGames) return null;
    return pct(w, l, t);
  }

  strengthOfVictory(team: string): number {
    const beaten = (this.log.get(team) ?? []).filter((e) => e.res === "W").map((e) => e.opp);
    if (beaten.length === 0) return 0;
    return beaten.reduce((s, o) => s + this.overallPct(o), 0) / beaten.length;
  }
  strengthOfSchedule(team: string): number {
    const opps = (this.log.get(team) ?? []).map((e) => e.opp);
    if (opps.length === 0) return 0;
    return opps.reduce((s, o) => s + this.overallPct(o), 0) / opps.length;
  }
  netPoints(team: string): number {
    const { pf, pa } = this.overall(team);
    return pf - pa;
  }
}

// --- tiebreakers -----------------------------------------------------------

type Step = (s: Season, team: string, group: string[]) => number;

// Higher is better. Each returns a comparable score; a step that can't
// distinguish returns the same value for everyone in the group.
const DIVISION_STEPS: Step[] = [
  (s, t, g) => s.headToHeadPct(t, new Set(g)),
  (s, t) => s.divisionPct(t),
  (s, t, g) => s.commonGamesPct(t, g, 0) ?? 0,
  (s, t) => s.conferencePct(t),
  (s, t) => s.strengthOfVictory(t),
  (s, t) => s.strengthOfSchedule(t),
  (s, t) => s.netPoints(t),
];

const WILDCARD_STEPS: Step[] = [
  (s, t, g) => s.headToHeadSweep(t, g),
  (s, t) => s.conferencePct(t),
  (s, t, g) => s.commonGamesPct(t, g, 4) ?? -1,
  (s, t) => s.strengthOfVictory(t),
  (s, t) => s.strengthOfSchedule(t),
  (s, t) => s.netPoints(t),
];

const EPS = 1e-9;

/**
 * Order `group` best → worst. `steps` is the tiebreaker chain; after any step
 * splits the group the procedure restarts from the top on each sub-group (the
 * league's "resume at step 1" rule). Final fallback: team code.
 */
function breakTie(s: Season, group: string[], steps: Step[]): string[] {
  if (group.length <= 1) return [...group];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const scored = group.map((t) => ({ t, v: step(s, t, group) }));
    const values = [...new Set(scored.map((x) => x.v))].sort((a, b) => b - a);
    // did this step separate anyone?
    const distinct = values.filter(
      (v, idx) => idx === 0 || Math.abs(v - values[idx - 1]!) > EPS,
    );
    if (distinct.length <= 1) continue; // no split, next step

    const buckets: string[][] = distinct.map((v) =>
      scored.filter((x) => Math.abs(x.v - v) <= EPS).map((x) => x.t),
    );
    // recurse from the top on each bucket
    return buckets.flatMap((b) => breakTie(s, b, steps));
  }

  return [...group].sort((a, b) => a.localeCompare(b));
}

/**
 * Rank teams from (potentially) different divisions — division-winner seeding or
 * the wild-card race. Win% is the primary sort; the inter-division tiebreaker
 * chain only runs within a win% tier. Per the league rule, when 2+ tied
 * contenders share a division only that division's best survivor competes; the
 * rest are spliced back in directly behind it.
 */
function rankAcrossDivisions(s: Season, teams: string[]): string[] {
  const tiers = new Map<number, string[]>();
  for (const t of teams) {
    const key = Math.round(s.overallPct(t) * 1e6);
    if (!tiers.has(key)) tiers.set(key, []);
    tiers.get(key)!.push(t);
  }

  const out: string[] = [];
  for (const [, tier] of [...tiers.entries()].sort((a, b) => b[0] - a[0])) {
    out.push(...rankTierAcrossDivisions(s, tier));
  }
  return out;
}

function rankTierAcrossDivisions(s: Season, tier: string[]): string[] {
  if (tier.length <= 1) return [...tier];

  const byDiv = new Map<DivisionId, string[]>();
  for (const t of tier) {
    const d = divisionOf(t);
    if (!byDiv.has(d)) byDiv.set(d, []);
    byDiv.get(d)!.push(t);
  }
  // one survivor per division; the rest ride directly behind it
  const internal = new Map<DivisionId, string[]>();
  for (const [d, ts] of byDiv) internal.set(d, breakTie(s, ts, DIVISION_STEPS));

  const champions = [...internal.values()].map((ordered) => ordered[0]!);
  const rankedChampions = breakTie(s, champions, WILDCARD_STEPS);

  return rankedChampions.flatMap((champ) => internal.get(divisionOf(champ))!);
}

// --- public API ----------------------------------------------------------

export function computeStandings(
  games: FinishedGame[],
  teamCodes: string[] = NFL_TEAMS as string[],
): LeagueStandings {
  const teams = [...new Set(teamCodes)];
  for (const t of teams) divisionOf(t); // validates
  const s = new Season(games, teams);

  const rowOf = new Map<string, StandingRow>();
  for (const team of teams) {
    const o = s.overall(team);
    const d = s.tally(team, (e) => divisionOf(e.opp) === divisionOf(team));
    const c = s.tally(team, (e) => conferenceOf(e.opp) === conferenceOf(team));
    rowOf.set(team, {
      team,
      conference: conferenceOf(team),
      division: divisionOf(team),
      wins: o.w,
      losses: o.l,
      ties: o.t,
      games: o.w + o.l + o.t,
      pointsFor: o.pf,
      pointsAgainst: o.pa,
      pointDiff: o.pf - o.pa,
      winPct: pct(o.w, o.l, o.t),
      divisionRecord: recordString(d.w, d.l, d.t),
      conferenceRecord: recordString(c.w, c.l, c.t),
      divisionRank: 0,
      seed: null,
      madePlayoffs: false,
      wonDivision: false,
    });
  }

  // division ranks
  for (const id of DIVISION_IDS) {
    const members = teams.filter((t) => divisionOf(t) === id);
    if (members.length === 0) continue;
    const ordered = orderByPctThen(s, members, DIVISION_STEPS);
    ordered.forEach((t, i) => {
      const r = rowOf.get(t)!;
      r.divisionRank = i + 1;
      r.wonDivision = i === 0;
    });
  }

  // conference seeding
  const seeding = {} as Record<Conference, ConferenceSeeding>;
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const confTeams = teams.filter((t) => conferenceOf(t) === conf);
    const winners = confTeams.filter((t) => rowOf.get(t)!.wonDivision);
    const rest = confTeams.filter((t) => !rowOf.get(t)!.wonDivision);

    const seededWinners = rankAcrossDivisions(s, winners).filter((t) =>
      rowOf.get(t)!.wonDivision,
    );
    // ^ rankAcrossDivisions splices in division-mates; winners are unique
    //   per division so the filter just preserves order.
    const wildOrder = rankAcrossDivisions(s, rest);
    const wildCards = wildOrder.slice(0, Math.max(0, 7 - seededWinners.length));

    const seeds = [...seededWinners, ...wildCards];
    seeds.forEach((t, i) => {
      const r = rowOf.get(t)!;
      r.seed = i + 1;
      r.madePlayoffs = true;
    });
    seeding[conf] = { seeds, divisionWinners: seededWinners, wildCards };
  }

  const rows = [...rowOf.values()].sort(
    (a, b) =>
      a.conference.localeCompare(b.conference) ||
      (a.seed ?? 99) - (b.seed ?? 99) ||
      a.division.localeCompare(b.division) ||
      a.divisionRank - b.divisionRank,
  );

  return { rows, seeding };
}

/** breakTie, but seeded by overall win% first (its natural primary sort). */
function orderByPctThen(s: Season, teams: string[], steps: Step[]): string[] {
  const groups = new Map<number, string[]>();
  for (const t of teams) {
    const key = Math.round(s.overallPct(t) * 1e6);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, g]) => breakTie(s, g, steps));
}
