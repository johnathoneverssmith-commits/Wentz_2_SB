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
  /**
   * When this team was in a multi-team tie that a tiebreaker resolved, how it
   * came out ahead — e.g. "conference record over BAL, PIT". Absent when the
   * team's placement never required a tiebreaker.
   */
  tiebreaker?: string;
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

interface Step {
  fn: (s: Season, team: string, group: string[]) => number;
  label: string;
}

// Higher is better. Each returns a comparable score; a step that can't
// distinguish returns the same value for everyone in the group.
const DIVISION_STEPS: Step[] = [
  { fn: (s, t, g) => s.headToHeadPct(t, new Set(g)), label: "head-to-head" },
  { fn: (s, t) => s.divisionPct(t), label: "division record" },
  { fn: (s, t, g) => s.commonGamesPct(t, g, 0) ?? 0, label: "common games" },
  { fn: (s, t) => s.conferencePct(t), label: "conference record" },
  { fn: (s, t) => s.strengthOfVictory(t), label: "strength of victory" },
  { fn: (s, t) => s.strengthOfSchedule(t), label: "strength of schedule" },
  { fn: (s, t) => s.netPoints(t), label: "net points" },
];

const WILDCARD_STEPS: Step[] = [
  { fn: (s, t, g) => s.headToHeadSweep(t, g), label: "head-to-head sweep" },
  { fn: (s, t) => s.conferencePct(t), label: "conference record" },
  { fn: (s, t, g) => s.commonGamesPct(t, g, 4) ?? -1, label: "common games" },
  { fn: (s, t) => s.strengthOfVictory(t), label: "strength of victory" },
  { fn: (s, t) => s.strengthOfSchedule(t), label: "strength of schedule" },
  { fn: (s, t) => s.netPoints(t), label: "net points" },
];

const EPS = 1e-9;

interface TieOutcome {
  order: string[];
  /** team → how it finished ahead of at least one team it was tied with. */
  notes: Map<string, string>;
}

function nameList(teams: string[]): string {
  return teams.length <= 3
    ? teams.join(", ")
    : `${teams.slice(0, 3).join(", ")} +${teams.length - 3}`;
}

/**
 * Order `group` best → worst and record why. `steps` is the tiebreaker chain;
 * after any step splits the group the procedure restarts from the top on each
 * sub-group (the league's "resume at step 1" rule). Final fallback: team code.
 * A team only gets a note when it actually finished ahead of a team it was tied
 * with.
 */
function breakTie(s: Season, group: string[], steps: Step[]): TieOutcome {
  if (group.length <= 1) return { order: [...group], notes: new Map() };

  for (const step of steps) {
    const scored = group.map((t) => ({ t, v: step.fn(s, t, group) }));
    const values = [...new Set(scored.map((x) => x.v))].sort((a, b) => b - a);
    const distinct = values.filter((v, idx) => idx === 0 || Math.abs(v - values[idx - 1]!) > EPS);
    if (distinct.length <= 1) continue; // this step didn't separate anyone

    const buckets = distinct.map((v) =>
      scored.filter((x) => Math.abs(x.v - v) <= EPS).map((x) => x.t),
    );
    const order: string[] = [];
    const notes = new Map<string, string>();
    buckets.forEach((bucket, bi) => {
      const beaten = buckets.slice(bi + 1).flat();
      const sub = breakTie(s, bucket, steps);
      order.push(...sub.order);
      for (const [t, n] of sub.notes) notes.set(t, n); // deeper split wins
      if (beaten.length > 0) {
        for (const t of bucket) {
          if (!notes.has(t)) notes.set(t, `${step.label} over ${nameList(beaten)}`);
        }
      }
    });
    return { order, notes };
  }

  // nothing separated them — deterministic stand-in for the coin toss
  const order = [...group].sort((a, b) => a.localeCompare(b));
  const notes = new Map<string, string>();
  order.slice(0, -1).forEach((t, i) => notes.set(t, `coin toss over ${nameList(order.slice(i + 1))}`));
  return { order, notes };
}

/**
 * Rank teams from (potentially) different divisions — division-winner seeding or
 * the wild-card race. Win% is the primary sort; the inter-division tiebreaker
 * chain only runs within a win% tier. Per the league rule, when 2+ tied
 * contenders share a division only that division's best survivor competes; the
 * rest are spliced back in directly behind it.
 */
function rankAcrossDivisions(s: Season, teams: string[]): TieOutcome {
  const tiers = new Map<number, string[]>();
  for (const t of teams) {
    const key = Math.round(s.overallPct(t) * 1e6);
    if (!tiers.has(key)) tiers.set(key, []);
    tiers.get(key)!.push(t);
  }

  const order: string[] = [];
  const notes = new Map<string, string>();
  for (const [, tier] of [...tiers.entries()].sort((a, b) => b[0] - a[0])) {
    const t = rankTierAcrossDivisions(s, tier);
    order.push(...t.order);
    for (const [k, v] of t.notes) notes.set(k, v);
  }
  return { order, notes };
}

function rankTierAcrossDivisions(s: Season, tier: string[]): TieOutcome {
  if (tier.length <= 1) return { order: [...tier], notes: new Map() };

  const byDiv = new Map<DivisionId, string[]>();
  for (const t of tier) {
    const d = divisionOf(t);
    if (!byDiv.has(d)) byDiv.set(d, []);
    byDiv.get(d)!.push(t);
  }
  // one survivor per division; the rest ride directly behind it
  const internal = new Map<DivisionId, string[]>();
  const notes = new Map<string, string>();
  for (const [d, ts] of byDiv) {
    const t = breakTie(s, ts, DIVISION_STEPS);
    internal.set(d, t.order);
    for (const [k, v] of t.notes) notes.set(k, v);
  }

  const champions = [...internal.values()].map((ordered) => ordered[0]!);
  const ranked = breakTie(s, champions, WILDCARD_STEPS);
  for (const [k, v] of ranked.notes) notes.set(k, v);

  return {
    order: ranked.order.flatMap((champ) => internal.get(divisionOf(champ))!),
    notes,
  };
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
    const { order, notes } = orderByPctThen(s, members, DIVISION_STEPS);
    order.forEach((t, i) => {
      const r = rowOf.get(t)!;
      r.divisionRank = i + 1;
      r.wonDivision = i === 0;
      const note = notes.get(t);
      if (note) r.tiebreaker = note;
    });
  }

  // conference seeding
  const seeding = {} as Record<Conference, ConferenceSeeding>;
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const confTeams = teams.filter((t) => conferenceOf(t) === conf);
    const winners = confTeams.filter((t) => rowOf.get(t)!.wonDivision);
    const rest = confTeams.filter((t) => !rowOf.get(t)!.wonDivision);

    const winnerRank = rankAcrossDivisions(s, winners);
    const seededWinners = winnerRank.order.filter((t) => rowOf.get(t)!.wonDivision);
    // ^ rankAcrossDivisions splices in division-mates; winners are unique
    //   per division so the filter just preserves order.
    const wildRank = rankAcrossDivisions(s, rest);
    const wildCards = wildRank.order.slice(0, Math.max(0, 7 - seededWinners.length));

    const seeds = [...seededWinners, ...wildCards];
    seeds.forEach((t, i) => {
      const r = rowOf.get(t)!;
      r.seed = i + 1;
      r.madePlayoffs = true;
      // a cross-division note (seed placement) is more playoff-relevant than a
      // within-division one — let it win.
      const note = winnerRank.notes.get(t) ?? wildRank.notes.get(t);
      if (note) r.tiebreaker = note;
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
function orderByPctThen(s: Season, teams: string[], steps: Step[]): TieOutcome {
  const groups = new Map<number, string[]>();
  for (const t of teams) {
    const key = Math.round(s.overallPct(t) * 1e6);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const order: string[] = [];
  const notes = new Map<string, string>();
  for (const [, g] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const t = breakTie(s, g, steps);
    order.push(...t.order);
    for (const [k, v] of t.notes) notes.set(k, v);
  }
  return { order, notes };
}
