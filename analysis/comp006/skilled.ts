/**
 * COMP-006: the scripted SKILLED GM.
 *
 * INFORMATION RULE. Everything below reads only what a human GM can see on the screens at the moment of the
 * decision: the player table (overall, age, position, contract, injury), public draft-board fields
 * (collegeOverall, projectedRound, the board's own `expectedRatings`), standings, rosters and cap of every team,
 * the free-agent market and its asking prices, and the trade screen's own read (`judgeTrade`, which is the
 * evaluator behind the accept-likelihood meter). It never reads: `potential`, a prospect's `trueOverall`, any CPU
 * GM's strategy / skill / difficulty (`aiGms`, `strategyOf`, `difficultyFor`), RNG state, or future results.
 * `info-guard.test.ts` greps this file for those identifiers and fails if one appears.
 *
 * KNOWLEDGE RULE. The unit weights in `unitValue.ts` are *measured engine facts* published in-repo
 * (analysis/38_unit_links.ts). A skilled player is allowed to know them; it is knowledge, not hidden state.
 *
 * ACTION RULE. Every action goes through the same `decide*` functions a GM's button press reaches
 * (online/src/decide.ts), so every legality rule, turn order and refusal is the real one.
 */
import type { LeagueState, Player, TradeAsset } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { expectedRatings } from "@/state/draftBoard.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import { marketScale, minSalaryM } from "@/state/capEconomy.ts";
import { capUsedOf } from "@/state/seed.ts";
import { STARTERS_AT, rosterUnitScore, unitGainer } from "@/state/unitValue.ts";
import { offerRoomFor, unsignedPool } from "@/state/freeAgencyEvent.ts";
import { checkRelease, releasePenalty } from "@/state/reconciliation.ts";
import { extensionAsk, previewFifthYearOption, previewFranchiseTag } from "@/state/contracts.ts";
import { judgeTrade } from "@/state/tradeModel.ts";
import { MAX_CONTRACT_M, tradeAssetValue } from "@/sim/MockSimulationService";
import { suggestedCoachingPick } from "@/state/coachingDraft.ts";
import {
  DEFENSIVE_FOCUSES,
  OFFENSIVE_FOCUSES,
  REPEAT_DECAY,
  focusGroupValue,
  focusStreak,
  type TrainingCampPlan,
} from "@/state/trainingCamp.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";
import { DEFAULT_PLAN, cleanPlan, type GamePlan } from "@/state/gamePlan.ts";

export type Module = "draft" | "fa" | "trades" | "contracts" | "lineup" | "plan" | "camp" | "coaching" | "cap";
export const ALL_MODULES: Module[] = ["draft", "fa", "trades", "contracts", "lineup", "plan", "camp", "coaching", "cap"];

/** Counters the harness reads back: what the policy did, and what its own model claimed. */
export interface Ledger {
  [key: string]: number;
}
export const bump = (l: Ledger, k: string, n = 1): void => {
  l[k] = (l[k] ?? 0) + n;
};

const isOut = (p: Player): boolean => !!p.injury_status && p.injury_status.status === "out";
const rosterOf = (s: LeagueState, team: string): Player[] =>
  Object.values(s.players).filter((p) => p.nfl_team === team && !p.retired && !p.free_agent);

/** Ratings by position for the healthy players on a roster (the lineup the engine will read), best first. */
export function ratingsByPos(players: Iterable<Player>, skip?: Set<string>): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const p of players) {
    if (isOut(p) || p.holdout || skip?.has(p.id)) continue;
    const l = m.get(p.position);
    if (l) l.push(p.overall);
    else m.set(p.position, [p.overall]);
  }
  for (const l of m.values()) l.sort((a, b) => b - a);
  return m;
}
const at = (m: Map<string, number[]>) => (pos: string): readonly number[] => m.get(pos) ?? [];

/** Margin points per game a player adds to this roster as a starter (0 if he would not start). */
export function gainOf(s: LeagueState, team: string, p: { position: string; overall: number }, skip?: Set<string>): number {
  const m = ratingsByPos(rosterOf(s, team), skip);
  return unitGainer(at(m))(p.position, p.overall);
}

/** Roughly what a margin point is worth in cap dollars ($M) for this league: set from the market, not from hidden state. */
function dollarsPerMargin(s: LeagueState): number {
  return 9 * marketScale(s);
}

export interface Ctx {
  s: LeagueState;
  team: string;
  /** teams the policy treats as non-partners at the deadline (the other skilled seats) */
  seats: Set<string>;
  mods: Set<Module>;
  ledger: Ledger;
}

// ---------------------------------------------------------------- coaching

export function coachingPick(c: Ctx): string | null {
  // the staff suggestion on the coaching draft screen: value over what the rival jobs leave behind
  return suggestedCoachingPick(c.s, c.team)?.id ?? null;
}

// ---------------------------------------------------------------- draft

const POS_CAP: Record<string, number> = { QB: 1, RB: 1, WR: 2, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, OLB: 1, ILB: 1, CB: 2, S: 2, K: 0, P: 0 };

/** The prospect to take: board projection (public), valued by what he adds to my units, with a positional cap. */
export function draftPick(c: Ctx, taken: Set<string>, drafted: Map<string, number>): string {
  const { s, team } = c;
  const pool = s.draftClass.filter((p) => !taken.has(p.id));
  const exp = expectedRatings(pool, 1);
  // rookies play next year a little better than their projection and then keep growing
  const m = ratingsByPos(rosterOf(s, team));
  // players leaving on expiring deals will not be here: count them out of the base so the draft fills the real hole
  const base = ratingsByPos(rosterOf(s, team).filter((p) => (p.contract?.years_remaining ?? 0) > 1 || p.draft_info?.class_year === s.season));
  const gainer = unitGainer(at(base));
  let best = pool[0]!;
  let bestScore = -Infinity;
  for (const p of pool) {
    const k = `${p.position}`;
    if ((drafted.get(k) ?? 0) >= (POS_CAP[p.position] ?? 1)) continue;
    const e = (exp.get(p.id) ?? 50) + 1.5;
    // value: margin points added now + a development credit proportional to the rookie's own rating headroom
    const now = gainer(p.position, e);
    const depth = (m.get(p.position)?.length ?? 0) < (STARTERS_AT[p.position] ?? 1) + 1 ? 0.04 : 0;
    const score = now + depth + 0.0008 * e;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  bump(c.ledger, "draft.picks");
  bump(c.ledger, "draft.claimedGain", Math.max(0, bestScore));
  return best.id;
}

/** Sign or release a settled rookie: late picks who will not make the 53 are released. */
export function rookieShouldSign(c: Ctx, prospect: { position: string; collegeOverall: number; projectedRound: number }): boolean {
  if (prospect.projectedRound <= 5) return true;
  const m = ratingsByPos(rosterOf(c.s, c.team));
  const depth = m.get(prospect.position) ?? [];
  const slot = (STARTERS_AT[prospect.position] ?? 0) + 1;
  return (depth[slot - 1] ?? 0) < prospect.collegeOverall - 8;
}

// ---------------------------------------------------------------- free agency

export type FaMoveOut = { pass: true } | { playerId: string; salary: number; years: number; structure?: "even" | "backloaded" | "frontloaded" };

export function faTurn(c: Ctx): FaMoveOut {
  const { s, team } = c;
  const e = s.freeAgencyEvent;
  if (!e) return { pass: true };
  const scale = marketScale(s);
  const room = offerRoomFor(s, team);
  const m = ratingsByPos(rosterOf(s, team));
  // players I already bid on count as signed for the purpose of the next bid
  for (const [pid, offers] of Object.entries(e.offers)) {
    if (e.signed.some((x) => x.playerId === pid)) continue;
    if (!offers.some((o) => o.teamCode === team)) continue;
    const bp = s.players[pid];
    if (bp) {
      const l = m.get(bp.position) ?? [];
      l.push(bp.overall);
      l.sort((a, b) => b - a);
      m.set(bp.position, l);
    }
  }
  const gainer = unitGainer(at(m));
  const $m = dollarsPerMargin(s);
  const midseason = e.market === "midseason" || s.stage === "midseasonFreeAgency";
  let best: { p: Player; salary: number; years: number; net: number } | null = null;
  for (const p of unsignedPool(s)) {
    if (p.age >= 34) continue;
    const ask = expectedSalary(p, scale);
    // bid a hair over the ask so a tie on score goes my way (money is 75% of the player's choice)
    const salary = Math.min(Math.round(ask * 1.04 * 10) / 10, Math.round(MAX_CONTRACT_M * scale * 10) / 10);
    // a free agent's value is what he adds as a starter, aged one year for the horizon
    const gain = gainer(p.position, p.overall - (p.age >= 31 ? 1.5 : 0));
    if (gain < (midseason ? 0.05 : 0.1)) continue;
    // cost: his salary against the margin he adds, at the league's price of a margin point
    const years = p.age <= 27 ? 3 : p.age <= 30 ? 2 : 1;
    const net = gain * $m - salary;
    if (net <= 0.5 * scale) continue;
    if (salary > room) continue;
    if (!best || net > best.net) best = { p, salary, years, net };
  }
  if (!best) return { pass: true };
  bump(c.ledger, "fa.offers");
  bump(c.ledger, "fa.claimedNet", best.net);
  return { playerId: best.p.id, salary: best.salary, years: best.years };
}

// ---------------------------------------------------------------- cap / roster

/**
 * Cut dead weight before the market so the cap and the roster are not the constraint: bench players who cost real
 * money, cost little to leave and fill no unit slot. Only releases `checkRelease` allows (positional minimums kept).
 */
export function trimBench(c: Ctx): string[] {
  const { s, team } = c;
  const out: string[] = [];
  const roster = rosterOf(s, team);
  const m = ratingsByPos(roster);
  const hitOf = (p: Player): number => p.contract?.cap_hit_by_year[0] ?? 0;
  const minS = minSalaryM(s);
  const cands = roster
    .filter((p) => {
      const slot = STARTERS_AT[p.position] ?? 0;
      const rank = (m.get(p.position) ?? []).indexOf(p.overall);
      return hitOf(p) > 2.5 * minS && rank >= slot + 1 && p.age >= 28;
    })
    .sort((a, b) => hitOf(b) - hitOf(a));
  for (const p of cands.slice(0, 6)) {
    const chk = checkRelease(s, team, p.id);
    if (!chk.ok) continue;
    out.push(p.id);
  }
  return out;
}

// ---------------------------------------------------------------- contracts

export interface ContractAction {
  playerId: string;
  move: { kind: "extend"; baseSalary: number; years: number; guaranteed: number } | { kind: "tag" } | { kind: "option" };
}

/** Re-sign the starters whose deals end this year, tag one who will not sign, pick up good rookies' fifth-year options. */
export function contractActions(c: Ctx): ContractAction[] {
  const { s, team } = c;
  const out: ContractAction[] = [];
  const roster = rosterOf(s, team);
  const m = ratingsByPos(roster);
  const scale = marketScale(s);
  const $m = dollarsPerMargin(s);
  let tagUsed = false;
  const expiring = roster.filter((p) => p.contract?.years_remaining === 1 && p.age <= 33).sort((a, b) => b.overall - a.overall);
  for (const p of expiring) {
    const without = new Set([p.id]);
    const base = ratingsByPos(roster, without);
    const gain = unitGainer(at(base))(p.position, p.overall);
    if (gain < 0.08) continue; // would not start, or replaceable
    const ask = extensionAsk(p, scale);
    const net = gain * $m - ask.baseSalary;
    if (net > 0) {
      out.push({ playerId: p.id, move: { kind: "extend", baseSalary: ask.baseSalary, years: ask.years, guaranteed: ask.guaranteed } });
    } else if (!tagUsed && gain * $m > 0.9 * (previewFranchiseTag(s, p).price ?? 1e9)) {
      out.push({ playerId: p.id, move: { kind: "tag" } });
      tagUsed = true;
    }
  }
  for (const p of roster) {
    const opt = previewFifthYearOption(s, p);
    if (!opt.ok || opt.price === undefined) continue;
    const gain = unitGainer(at(ratingsByPos(roster, new Set([p.id]))))(p.position, p.overall);
    if (gain * $m > opt.price) out.push({ playerId: p.id, move: { kind: "option" } });
  }
  void m;
  return out;
}

// ---------------------------------------------------------------- lineup

/** Depth order per position: healthy players best-first by rating (a chart does not follow roster changes by itself). */
export function depthOrders(c: Ctx): { position: string; ids: string[] }[] {
  const by = new Map<string, Player[]>();
  for (const p of rosterOf(c.s, c.team)) {
    const l = by.get(p.position);
    if (l) l.push(p);
    else by.set(p.position, [p]);
  }
  const out: { position: string; ids: string[] }[] = [];
  for (const [position, ps] of by) {
    ps.sort((a, b) => Number(isOut(a)) - Number(isOut(b)) || b.overall - a.overall);
    out.push({ position, ids: ps.map((p) => p.id) });
  }
  return out;
}

// ---------------------------------------------------------------- game plan

/**
 * A deliberately small tilt toward the roster's strength. The dials' effects are bounded (docs/qa-longitudinal PR #105
 * X4: five of six alternatives within ±0.3 pts/game of the standard plan), so the skilled plan only leans the pass rate
 * and the back-committee toward whichever side of the ball the roster is better at than the league.
 */
export function gamePlan(c: Ctx): GamePlan {
  const { s, team } = c;
  const mine = ratingsByPos(rosterOf(s, team));
  const avg = (m: Map<string, number[]>, pos: string, n: number): number => {
    const l = (m.get(pos) ?? []).slice(0, n);
    return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 60;
  };
  const passMine = (avg(mine, "QB", 1) * 2 + avg(mine, "WR", 3) + avg(mine, "OT", 2)) / 4;
  const runMine = (avg(mine, "RB", 1) + avg(mine, "OG", 2) + avg(mine, "C", 1)) / 3;
  const diff = passMine - runMine;
  const passRate = Math.max(-4, Math.min(4, Math.round(diff / 5)));
  return cleanPlan({ ...DEFAULT_PLAN, passRate });
}

// ---------------------------------------------------------------- training camp

export function campPlan(c: Ctx): TrainingCampPlan {
  const { s, team } = c;
  const pick = (groups: readonly string[], side: "offense" | "defense"): string => {
    const values = groups.map((g) => focusGroupValue(s, team, g) * REPEAT_DECAY ** focusStreak(s, team, side, g));
    let bi = 0;
    values.forEach((v, i) => {
      if (v > values[bi]!) bi = i;
    });
    return groups[bi]!;
  };
  return {
    offensiveFocus: pick(OFFENSIVE_FOCUSES, "offense") as TrainingCampPlan["offensiveFocus"],
    defensiveFocus: pick(DEFENSIVE_FOCUSES, "defense") as TrainingCampPlan["defensiveFocus"],
    submitted: true,
  };
}

// ---------------------------------------------------------------- trades

type DeadlineMove =
  | { kind: "propose"; toTeam: string; give: string[]; get: string[] }
  | { kind: "skip" }
  | { kind: "accept" }
  | { kind: "deny" };

const assetId = (a: TradeAsset): string => (a.kind === "player" ? a.playerId! : `pick:${a.pick!.year}-${a.pick!.round}-${a.pick!.originalTeam}`);

/** What an asset costs me to give up, in margin points per game (a bench player ~0, a starter his unit gain, a pick a rookie's expected value). */
function myCost(s: LeagueState, team: string, a: TradeAsset): number {
  if (a.kind === "pick") {
    const r = a.pick!.round;
    return [0, 0.5, 0.3, 0.18, 0.1, 0.06, 0.04, 0.02][r] ?? 0.02;
  }
  const p = s.players[a.playerId!];
  if (!p) return 0;
  const roster = rosterOf(s, team);
  const without = ratingsByPos(roster, new Set([p.id]));
  const withIt = ratingsByPos(roster);
  const full = rosterUnitScore(at(withIt));
  const less = rosterUnitScore(at(without));
  return Math.max(0, full - less);
}

/** What an incoming asset adds to me, in margin points per game. */
function myGain(s: LeagueState, team: string, a: TradeAsset): number {
  if (a.kind === "pick") return myCost(s, team, a);
  const p = s.players[a.playerId!];
  if (!p) return 0;
  return gainOf(s, team, p);
}

function packageNet(s: LeagueState, team: string, give: TradeAsset[], get: TradeAsset[]): number {
  // evaluated as one roster change so a swap at one position is not double counted
  const roster = rosterOf(s, team);
  const giveIds = new Set(give.filter((a) => a.kind === "player").map((a) => a.playerId!));
  const after = roster.filter((p) => !giveIds.has(p.id));
  for (const a of get) if (a.kind === "player" && s.players[a.playerId!]) after.push(s.players[a.playerId!]!);
  const delta = rosterUnitScore(at(ratingsByPos(after))) - rosterUnitScore(at(ratingsByPos(roster)));
  const picks = (xs: TradeAsset[]) => xs.filter((a) => a.kind === "pick").reduce((t, a) => t + myCost(s, team, a), 0);
  // a contract that runs past this year costs future cap; the money is priced at the league's margin price
  const money = (xs: TradeAsset[]) =>
    xs
      .filter((a) => a.kind === "player")
      .reduce((t, a) => {
        const p = s.players[a.playerId!];
        return t + (p?.contract?.cap_hit_by_year[0] ?? 0);
      }, 0);
  const capShadow = (money(get) - money(give)) / (dollarsPerMargin(s) * 6);
  // a deadline lets the cap break, but a GM who ends over it must cut starters: price that in as infeasible
  const t = s.teams[team];
  if (t && capUsedOf(s, team) + money(get) - money(give) > t.cap.total) return -1;
  return delta + picks(get) - picks(give) - capShadow;
}

const ownedPicks = (s: LeagueState, team: string): TradeAsset[] =>
  Object.values(s.draftPicks ?? {})
    .filter((pk) => pk.ownedBy === team)
    .map((pk) => ({ kind: "pick" as const, pick: pk }));

/** Respond to an offer waiting on me: accept only if it makes my units better by my model and the league would allow it. */
export function respondToOffer(c: Ctx): DeadlineMove {
  const d = c.s.tradeDeadline?.active;
  if (!d) return { kind: "deny" };
  const iAmTo = d.toTeam === c.team;
  const give = iAmTo ? d.toAssets : d.fromAssets;
  const get = iAmTo ? d.fromAssets : d.toAssets;
  const net = packageNet(c.s, c.team, give, get);
  if (net > 0.06) {
    bump(c.ledger, "trade.accepted");
    bump(c.ledger, "trade.claimedNet", net);
    return { kind: "accept" };
  }
  return { kind: "deny" };
}

/**
 * My proposing turn: look for the biggest upgrade at a unit slot that I can pay for with surplus (bench players and
 * picks), asking the trade screen's own evaluator whether the other team would take it. Only CPU teams are partners.
 */
export function proposeTurn(c: Ctx): DeadlineMove {
  const { s, team } = c;
  const mine = rosterOf(s, team);
  const base = ratingsByPos(mine);
  const gainer = unitGainer(at(base));
  type Cand = { p: Player; gain: number };
  const cands: Cand[] = [];
  for (const p of Object.values(s.players)) {
    if (p.retired || p.free_agent || p.nfl_team === team || c.seats.has(p.nfl_team) || !s.teams[p.nfl_team]) continue;
    if (isOut(p) || p.holdout) continue;
    const g = gainer(p.position, p.overall);
    if (g >= 0.15) cands.push({ p, gain: g });
  }
  cands.sort((a, b) => b.gain - a.gain);
  const picks = ownedPicks(s, team).sort((a, b) => (a.pick!.round - b.pick!.round) || (a.pick!.year - b.pick!.year));
  // my pieces cheapest-for-me first
  const benchAssets: { a: TradeAsset; cost: number }[] = [];
  for (const p of mine) {
    const a: TradeAsset = { kind: "player", playerId: p.id };
    const cost = myCost(s, team, a);
    if (cost < 0.03 && p.overall >= 62) benchAssets.push({ a, cost });
  }
  for (const a of picks) benchAssets.push({ a, cost: myCost(s, team, a) });
  benchAssets.sort((x, y) => tradeAssetValue(s, y.a) / (y.cost + 0.02) - tradeAssetValue(s, x.a) / (x.cost + 0.02));

  let best: { toTeam: string; give: TradeAsset[]; get: TradeAsset[]; net: number } | null = null;
  let evals = 0;
  for (const { p, gain } of cands.slice(0, 14)) {
    if (evals > 60) break;
    const get: TradeAsset[] = [{ kind: "player", playerId: p.id }];
    const give: TradeAsset[] = [];
    const used = new Set<string>();
    // add my cheapest-for-me assets until the trade screen reads the deal as acceptable
    for (const b of benchAssets) {
      if (give.length >= 3) break;
      const id = assetId(b.a);
      if (used.has(id)) continue;
      give.push(b.a);
      used.add(id);
      const ev = judgeTrade(s, team, p.nfl_team, give, get);
      evals++;
      if (ev.acceptLikelihood >= 0.7) {
        const net = packageNet(s, team, give, get);
        if (net > 0.1 && (!best || net > best.net)) best = { toTeam: p.nfl_team, give: [...give], get, net };
        break;
      }
    }
    void gain;
  }
  if (!best) return { kind: "skip" };
  bump(c.ledger, "trade.proposed");
  bump(c.ledger, "trade.claimedNet", best.net);
  return { kind: "propose", toTeam: best.toTeam, give: best.give.map(assetId), get: best.get.map(assetId) };
}

export function deadlineMove(c: Ctx): DeadlineMove | null {
  const duty = pendingFor(c.s, c.team);
  if (!duty) return null;
  if (duty === "propose") return c.mods.has("trades") ? proposeTurn(c) : { kind: "skip" };
  return c.mods.has("trades") ? respondToOffer(c) : { kind: "deny" };
}

export const cityOf = (code: string): string => TEAMS_BY_CODE[code]?.label ?? code;
export { capUsedOf };

/**
 * Get under the cap the way a GM does: release the players who cost the most cap per unit of value lost
 * (bench first), only releases `checkRelease` allows. Called before the staff's own fix at a free-agency summary.
 */
export function capCuts(c: Ctx): string[] {
  const { s, team } = c;
  const out: string[] = [];
  const total = s.teams[team]!.cap.total;
  const gone = new Set<string>();
  for (let guard = 0; guard < 25; guard++) {
    const over = capUsedOf(s, team) - total - out.reduce((t, id) => t + ((s.players[id]?.contract?.cap_hit_by_year[0] ?? 0) - releasePenalty(s.players[id]!)), 0);
    if (over <= 0) break;
    const roster = rosterOf(s, team).filter((p) => !gone.has(p.id));
    const full = rosterUnitScore(at(ratingsByPos(roster)));
    let best: { id: string; ratio: number } | null = null;
    for (const p of roster) {
      const hit = p.contract?.cap_hit_by_year[0] ?? 0;
      const saved = hit - releasePenalty(p);
      if (saved < 0.5) continue;
      if (!checkRelease(s, team, p.id).ok) continue;
      const loss = full - rosterUnitScore(at(ratingsByPos(roster.filter((x) => x.id !== p.id))));
      const ratio = saved / (loss + 0.02);
      if (!best || ratio > best.ratio) best = { id: p.id, ratio };
    }
    if (!best) break;
    out.push(best.id);
    gone.add(best.id);
  }
  return out;
}
