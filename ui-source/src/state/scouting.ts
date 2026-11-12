/**
 * Scouting, slice 1: one basic rating report per prospect, a finite budget,
 * the same menu and the same prices for a person and for the league's CPU GMs.
 *
 * What a report is. The public board (`expectedRatings`, the projected round and
 * range) already tells every GM what a prospect's slot is worth on average. The
 * part it cannot see is eps = trueOverall - projection (sd 6.6 at the top of
 * the board to 11.2 at the bottom). A basic report measures eps with noise
 * (sd 7) and shrinks it by the Bayes weight k = tau^2 / (tau^2 + 7^2), so the
 * estimate is calibrated and never exact:
 *
 *   estimate = projection + k * (eps + noise)
 *
 * The noise is seeded by (league seed, season, prospect), not by who asks and
 * not by when: asking twice returns the same report, and two teams that scout
 * the same prospect read the same number. There is no re-roll to exploit.
 *
 * What is stored is only `{ estimate, lo, hi }`. Neither the true rating nor eps
 * is recoverable from it: the stored number is a shrunk blend of eps and noise,
 * and the noise is not stored.
 *
 * Budget. Everyone spends 1 point per basic report. A person has `HUMAN_POINTS`;
 * a CPU GM has `CPU_POINTS` (half), at every difficulty. CPU teams choose targets from public information only
 * (`suggestTargets`), the same function a person can press as "Scout my needs".
 *
 * Plain data in, plain data out. `makeReport` is the one function that reads a
 * hidden rating; it runs where the class is generated (the browser in a solo
 * game, the server online) and its output is the only thing that travels.
 */
import type { DraftProspect, LeagueState, Position } from "@/domain";
import { POSITION_VALUE, expectedRatings } from "./draftBoard.ts";

/** Reports a person can buy per draft. 24 basic reports at positions of need is the measured design (PR #107). */
export const HUMAN_POINTS = 24;
/** Price of one basic report, in points. */
export const BASIC_COST = 1;
/** Noise sd of a basic report, in rating points. */
export const BASIC_SIGMA = 7;
/** Measured sd of (true - projection) by public rank bucket of 32 (PR #107, 30 classes, 9,600 prospects). */
const TAU_BY_BUCKET = [6.6, 7.7, 8.7, 8.9, 10.0, 10.4, 11.0, 11.0, 11.2];
/** z for an 80% interval. */
const Z80 = 1.2816;

export interface ScoutReport {
  /** the best estimate of his rookie rating after the report, rounded */
  estimate: number;
  /** an 80% interval around it */
  lo: number;
  hi: number;
}

export interface ScoutingState {
  /** the draft year these reports belong to; a new class starts a clean ledger */
  year: number;
  /** team -> prospect id -> report */
  reports: Record<string, Record<string, ScoutReport>>;
}

const tauOf = (rank: number): number => TAU_BY_BUCKET[Math.min(TAU_BY_BUCKET.length - 1, Math.floor((rank - 1) / 32))]!;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function gauss(key: string): number {
  const a = hash(key + "a") / 4294967296 || 1e-9;
  const b = hash(key + "b") / 4294967296;
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

/** Public rank of every prospect: by the public projection, ties by id. */
export function publicRanks(prospects: readonly DraftProspect[], expected = expectedRatings(prospects, 1)): Map<string, number> {
  return new Map(
    [...prospects]
      .sort((a, b) => expected.get(b.id)! - expected.get(a.id)! || (a.id < b.id ? -1 : 1))
      .map((p, i) => [p.id, i + 1]),
  );
}

/** The one reader of a hidden rating. Pure: the same inputs give the same report. */
export function makeReport(args: {
  seed: number;
  year: number;
  prospect: Pick<DraftProspect, "id" | "trueOverall">;
  projection: number;
  rank: number;
}): ScoutReport {
  const { prospect, projection, rank } = args;
  const tau = tauOf(rank);
  const k = (tau * tau) / (tau * tau + BASIC_SIGMA * BASIC_SIGMA);
  const eps = prospect.trueOverall - projection;
  const noise = BASIC_SIGMA * gauss(`${args.seed}|${args.year}|${prospect.id}|basic`);
  const estimate = projection + k * (eps + noise);
  // the posterior sd of eps given the report
  const sd = Math.sqrt((tau * tau * BASIC_SIGMA * BASIC_SIGMA) / (tau * tau + BASIC_SIGMA * BASIC_SIGMA));
  return { estimate: Math.round(estimate), lo: Math.round(estimate - Z80 * sd), hi: Math.round(estimate + Z80 * sd) };
}

/** Reports each CPU GM buys, at every difficulty. Measured in `docs/scouting-pilot-results.md`: at 24 the CPUs match a person and the human edge is gone; at 12 a person who scouts at need keeps one. */
export const CPU_POINTS = 12;

/** Points this team may spend this draft: a person gets `HUMAN_POINTS`, a CPU GM `CPU_POINTS`, whatever the difficulty. */
export function budgetFor(s: Pick<LeagueState, "gms" | "teams">, team: string): number {
  return s.gms.some((g) => g.isHuman && g.teamCode === team) ? HUMAN_POINTS : CPU_POINTS;
}

function ledger(s: LeagueState, year: number): ScoutingState {
  if (!s.scouting || s.scouting.year !== year) s.scouting = { year, reports: {} };
  return s.scouting;
}

export function reportsFor(s: Pick<LeagueState, "scouting">, team: string, year: number): Record<string, ScoutReport> {
  return s.scouting && s.scouting.year === year ? s.scouting.reports[team] ?? {} : {};
}
export function pointsSpent(s: Pick<LeagueState, "scouting">, team: string, year: number): number {
  return Object.keys(reportsFor(s, team, year)).length * BASIC_COST;
}

export type SpendResult =
  | { ok: true; report: ScoutReport; left: number }
  | { ok: false; reason: "no-draft" | "unknown-prospect" | "taken" | "already-scouted" | "no-points" };

/**
 * Spend one report on a prospect. The ledger is the only state: a repeat is refused (it would return the same
 * report), a drafted prospect is refused (nothing left to decide), and the budget is checked here, not in the screen.
 */
export function spendReport(s: LeagueState, team: string, prospectId: string, budget: number): SpendResult {
  const d = s.draft;
  if (!d || d.mode !== "rookie" || d.currentPickIndex >= d.pickOrder.length) return { ok: false, reason: "no-draft" };
  const p = s.draftClass.find((x) => x.id === prospectId);
  if (!p) return { ok: false, reason: "unknown-prospect" };
  if (d.results.some((r) => r.selectedId === prospectId)) return { ok: false, reason: "taken" };
  const mine = ledger(s, d.year).reports[team] ?? {};
  if (mine[prospectId]) return { ok: false, reason: "already-scouted" };
  if ((Object.keys(mine).length + 1) * BASIC_COST > budget) return { ok: false, reason: "no-points" };
  const expected = expectedRatings(s.draftClass, 1);
  const rank = publicRanks(s.draftClass, expected).get(prospectId)!;
  const report = makeReport({ seed: s.seed ?? 0, year: d.year, prospect: p, projection: expected.get(prospectId)!, rank });
  (ledger(s, d.year).reports[team] ??= {})[prospectId] = report;
  return { ok: true, report, left: budget - (Object.keys(mine).length + 1) * BASIC_COST };
}

const POS12: Position[] = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "ILB", "CB", "S"];

/**
 * Where a team's roster is thinnest against the league, from public rosters only: its best player at each position
 * minus the mean of the league's best-per-team there. Lowest first.
 */
export function needPositions(s: LeagueState, team: string, count = 4): Position[] {
  const best = new Map<string, number>();
  const lg = new Map<string, number[]>();
  for (const p of Object.values(s.players)) {
    if (p.retired) continue;
    if (p.nfl_team === team) best.set(p.position, Math.max(best.get(p.position) ?? 0, p.overall));
    else if (p.nfl_team !== "FA" && !String(p.nfl_team).startsWith("PS:")) {
      const l = lg.get(p.position) ?? [];
      l.push(p.overall);
      lg.set(p.position, l);
    }
  }
  return POS12.map((pos) => {
    const l = (lg.get(pos) ?? [70]).sort((a, b) => b - a);
    const top = l.filter((_, i) => i % 31 === 0).slice(0, 32);
    const mean = top.reduce((a, b) => a + b, 0) / top.length;
    return [pos, (best.get(pos) ?? 40) - mean] as const;
  })
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
    .map((x) => x[0]);
}

/** A team's own first picks, as 1-based overall slots (this draft's first rounds). */
function ownSlots(s: LeagueState, team: string, n = 5): number[] {
  return (s.draft?.pickOrder ?? []).map((t, i) => (t === team ? i + 1 : 0)).filter(Boolean).slice(0, n);
}

/**
 * The prospects a team should buy reports on: at its positions of need, near where it picks (a few slots above its
 * first pick through the first-round-and-a-bit below it), best public projection first. Public data only. Top-of-board
 * scouting is deliberately not what this returns (it measured 0.00 in PR #107; see the validation).
 */
export function suggestTargets(s: LeagueState, team: string, budget: number): string[] {
  const expected = expectedRatings(s.draftClass, 1);
  const ranks = publicRanks(s.draftClass, expected);
  const need = new Set(needPositions(s, team));
  const slots = ownSlots(s, team);
  const done = reportsFor(s, team, s.draft?.year ?? s.season);
  const taken = new Set((s.draft?.results ?? []).map((r) => r.selectedId));
  const near = (r: number) => slots.some((pk) => r >= pk - 8 && r <= pk + 40);
  return [...s.draftClass]
    .filter((p) => need.has(p.position) && near(ranks.get(p.id)!) && !done[p.id] && !taken.has(p.id))
    .sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
    .slice(0, Math.max(0, budget - Object.keys(done).length * BASIC_COST))
    .map((p) => p.id);
}

/** A CPU team buys its reports once, when the draft opens, with the same function and prices as a person. */
export function runCpuScouting(s: LeagueState, team: string, budget: number): number {
  let n = 0;
  for (const id of suggestTargets(s, team, budget)) if (spendReport(s, team, id, budget).ok) n++;
  return n;
}

/**
 * A team's board: the public projection, with the report's estimate in place of it where the team bought one.
 * The only place a report changes a decision; `draftBoard.ts` is untouched.
 */
export function applyReports(expected: Map<string, number>, reports: Record<string, ScoutReport>): Map<string, number> {
  const out = new Map(expected);
  for (const [id, r] of Object.entries(reports)) if (out.has(id)) out.set(id, r.estimate);
  return out;
}

// Re-exported so a screen needs one import for the position weight it already shows.
export { POSITION_VALUE };

/**
 * What a viewer's copy of the league may carry of the scouting ledger: their own team's reports and no one else's.
 * Reports are the same number for every team that buys one, so another team's ledger would be free scouting on
 * every prospect it covers (and a map of what the CPU is targeting). A solo save keeps the whole ledger, which
 * is the league's own; a pull for an online GM must pass through this.
 */
export function scoutingViewFor(
  scouting: LeagueState["scouting"],
  team: string | null | undefined,
): LeagueState["scouting"] {
  if (!scouting) return undefined;
  return { year: scouting.year, reports: team && scouting.reports[team] ? { [team]: scouting.reports[team]! } : {} };
}
