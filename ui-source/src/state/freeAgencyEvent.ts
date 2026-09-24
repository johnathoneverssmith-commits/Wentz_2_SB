import type { LeagueState, Player } from "@/domain";

import { unitGainer } from "./unitValue.ts";
import { offerToContract } from "./rules";
import { bestOfferFor, expectedSalary, type Offer } from "./freeAgencyValues";
import { deterministicNoiseUnit, difficultyProfile, shortlistByBaseScore } from "./aiDifficulty.ts";

/**
 * Turn-based free agency: five rounds, one offer or pass per team per round.
 *
 * The shape is the fantasy draft's, deliberately, because GMs already know how
 * to read it. What differs is that nothing resolves until a round ends: offers
 * accumulate all round, every team acts knowing what has been bid so far, and
 * the signings all happen at once when the last team has acted.
 *
 * The order is the reverse of a draft's and that is on purpose. The best
 * roster offers first and the worst offers last, so a weak team acts with the
 * most information — it can see every offer already on the table and decide
 * what it takes to beat them. It is a real advantage, and it is the one the
 * spec asks for.
 *
 * Offers are binding and cumulative. A team can come back for the same player
 * in a later round with more money, but it cannot take back what it already
 * offered, and every outstanding offer stays live until he signs. That makes
 * an early bid a genuine commitment rather than an opening position.
 */

export const FREE_AGENCY_ROUNDS = 5;

export interface FreeAgencyEventState {
  round: number;
  /** Team codes, fixed for the whole event: best roster first. */
  order: string[];
  /** Index into `order` for the team whose turn it is. */
  turnIndex: number;
  /** Every offer ever made, by player id. Nothing is ever removed. */
  offers: Record<string, Offer[]>;
  /** Completed signings, in the order they happened. */
  signed: {
    playerId: string;
    teamCode: string;
    salary: number;
    years: number;
    round: number;
  }[];
  /** Teams that have acted this round, so a turn cannot be taken twice. */
  actedThisRound: string[];
  /** True once the event is over and the summary should open. */
  complete: boolean;
}

/** Order for the whole event: strongest roster first. */
export function freeAgencyOrder(s: LeagueState): string[] {
  return Object.keys(s.teams).sort(
    (a, b) => (s.teams[b]?.ratings.overall ?? 0) - (s.teams[a]?.ratings.overall ?? 0),
  );
}

/** Everyone who can still be signed. */
export function unsignedPool(s: LeagueState): Player[] {
  const signed = new Set((s.freeAgencyEvent?.signed ?? []).map((x) => x.playerId));
  return Object.values(s.players).filter(
    (p) => p.free_agent && !p.retired && !signed.has(p.id),
  );
}

export function beginFreeAgencyEvent(s: LeagueState): void {
  if (s.freeAgencyEvent) return;
  s.freeAgencyEvent = {
    round: 1,
    order: freeAgencyOrder(s),
    turnIndex: 0,
    offers: {},
    signed: [],
    actedThisRound: [],
    complete: false,
  };
}

/** Whose turn it is, or undefined when the round is between resolutions. */
export function onTheClock(s: LeagueState): string | undefined {
  const e = s.freeAgencyEvent;
  if (!e || e.complete) return undefined;
  return e.order[e.turnIndex];
}

/** The leading offer for a player right now, for the board to show. */
export function leadingOffer(s: LeagueState, playerId: string): Offer | null {
  const e = s.freeAgencyEvent;
  const p = s.players[playerId];
  if (!e || !p) return null;
  return bestOfferFor(s, p, e.offers[playerId] ?? []);
}

export interface OfferCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this team may make this offer now.
 *
 * Deliberately permissive about money and roster size — the spec suspends the
 * cap and the roster maximum for the duration of bidding, and puts them back
 * at reconciliation. Bidding against a constraint you will resolve later is
 * the point: a team can win a player it cannot yet afford and then work out
 * how to fit him.
 */
export function checkOffer(
  s: LeagueState,
  teamCode: string,
  playerId: string,
  salary: number,
  years: number,
): OfferCheck {
  const e = s.freeAgencyEvent;
  if (!e || e.complete) return { ok: false, reason: "Free agency isn't running." };
  if (onTheClock(s) !== teamCode) return { ok: false, reason: "It isn't your turn." };
  const p = s.players[playerId];
  if (!p) return { ok: false, reason: "No such player." };
  if (!p.free_agent || p.retired) return { ok: false, reason: "He isn't a free agent." };
  if (e.signed.some((x) => x.playerId === playerId)) {
    return { ok: false, reason: "He's already signed." };
  }
  if (!Number.isFinite(salary) || salary <= 0) return { ok: false, reason: "Enter a salary." };
  if (!Number.isInteger(years) || years < 1 || years > 5) {
    return { ok: false, reason: "Contracts run one to five years." };
  }
  return { ok: true };
}

/** Record an offer and end the team's turn. */
export function applyOffer(
  s: LeagueState,
  teamCode: string,
  playerId: string,
  salary: number,
  years: number,
): void {
  const e = s.freeAgencyEvent;
  if (!e) return;
  const list = (e.offers[playerId] ??= []);
  list.push({
    teamCode,
    salary: Math.round(salary * 10) / 10,
    years,
    round: e.round,
    sequence: list.length,
  });
  endTurn(s, teamCode);
}

/** Take the turn without offering. */
export function applyPass(s: LeagueState, teamCode: string): void {
  endTurn(s, teamCode);
}

function endTurn(s: LeagueState, teamCode: string): void {
  const e = s.freeAgencyEvent;
  if (!e) return;
  if (!e.actedThisRound.includes(teamCode)) e.actedThisRound.push(teamCode);
  e.turnIndex += 1;
  if (e.turnIndex >= e.order.length) resolveRound(s);
}

/**
 * Settle the round: every player with an eligible offer signs at once.
 *
 * All at once rather than as the offers arrive, because a player who signed
 * the moment somebody cleared his asking price would never hear the better
 * offer coming two turns later. Waiting until the round ends is what makes it
 * worth bidding late.
 *
 * Offers for players who did not sign are kept. They stay live into the next
 * round, so a team that bid early and lost is still in the running without
 * having to bid again.
 */
export function resolveRound(s: LeagueState): void {
  const e = s.freeAgencyEvent;
  if (!e) return;

  for (const [playerId, offers] of Object.entries(e.offers)) {
    if (e.signed.some((x) => x.playerId === playerId)) continue;
    const p = s.players[playerId];
    if (!p || !p.free_agent || p.retired) continue;
    const win = bestOfferFor(s, p, offers);
    if (!win) continue;

    p.free_agent = false;
    p.nfl_team = win.teamCode;
    // the same builder the rest of the app signs with, so a free-agency
    // contract is indistinguishable from any other once it exists
    p.contract = offerToContract({
      teamCode: win.teamCode,
      baseSalary: win.salary,
      years: win.years,
      signingBonus: 0,
      guaranteed: 0,
    });

    e.signed.push({
      playerId,
      teamCode: win.teamCode,
      salary: win.salary,
      years: win.years,
      round: e.round,
    });
  }

  e.actedThisRound = [];
  e.turnIndex = 0;

  // The pool emptying is a real ending, not just the round limit — with
  // nobody left to sign there is nothing for a sixth turn to do.
  if (e.round >= FREE_AGENCY_ROUNDS || unsignedPool(s).length === 0) {
    e.complete = true;
    return;
  }
  e.round += 1;
}

/**
 * What a CPU team does on its turn.
 *
 * Simple and deterministic: find the best player it can plausibly win at a
 * position it is thin at, and offer slightly over the asking price. It does
 * not chase a player another team has already bid far more for, which keeps
 * the AI from burning every round on the same name.
 */
export function cpuTurn(s: LeagueState, teamCode: string, index?: RoundIndex): void {
  const e = s.freeAgencyEvent;
  if (!e) return applyPass(s, teamCode);

  // `runCpuTurns` hands these down so a sweep costs one pass over the players
  // rather than two per team; a lone call still works on its own.
  const idx = index ?? indexRound(s);
  const pool = idx.pool;
  if (pool.length === 0) return applyPass(s, teamCode);

  // Best overall this team already has at each position. It is a map lookup
  // rather than a roster re-scan because `shortlistByBaseScore` below asks
  // once per player in the pool — the same mistake `bestAvailable` in
  // rules.ts documents hitting inside the draft's sort comparator.
  const bestByPosition = idx.bestByTeam.get(teamCode);
  const bestAt = (position: string): number => bestByPosition?.get(position) ?? 0;

  // AI Difficulty (§13.1): search only the top `candidateDepth` plausible
  // targets by raw gain — Expert (Infinity) considers every legal target,
  // exactly the prior behavior.
  const difficulty = difficultyProfile(s.config.difficulty);
  const shortlist = shortlistByBaseScore(pool, (p) => p.overall - bestAt(p.position), difficulty.candidateDepth);

  // Free Agency + Contracts optimization pass (free_agency.five_round_cpu):
  // chase a bid war less far, rebid less aggressively, and require a real
  // upgrade rather than any positive gain at all. §13.2: the 1.4x rational
  // chase ceiling is the same league rule at every difficulty; a lower
  // difficulty may just give up on a bid war earlier within it, by a
  // deterministic amount keyed to the decision itself.
  const RATIONAL_CHASE_CEILING = 1.4;
  // Master only: a signing is worth what it adds to the team's units, not
  // just how much better he is than the best man already there
  const lists = idx.ratingsByTeam.get(teamCode);
  const units =
    difficulty.unitAwareness > 0 ? unitGainer((pos) => lists?.get(pos) ?? []) : null;
  let target: Player | null = null;
  let bestGain = -Infinity;
  for (const p of shortlist) {
    const lead = leadingOffer(s, p.id);
    const ask = expectedSalary(p);
    const ceilingUnit = (deterministicNoiseUnit(teamCode, s.season, "fa_chase_ceiling", p.id) + 1) / 2; // [0,1]
    const ceilingMultiplier = difficulty.chaseCeilingFloor + (1 - difficulty.chaseCeilingFloor) * ceilingUnit;
    // somebody else has already blown past this difficulty's effective chase ceiling: leave it
    if (lead && lead.salary > ask * RATIONAL_CHASE_CEILING * ceilingMultiplier) continue;
    // §13.1: bounded valuation noise on the target-ranking score, same as draft/coaching.
    const noise =
      difficulty.evaluationNoise === 0 ? 0 : deterministicNoiseUnit(teamCode, s.season, "fa_target", p.id) * difficulty.evaluationNoise;
    const gain =
      p.overall - bestAt(p.position) + noise + (units ? difficulty.unitAwareness * units(p.position, p.overall) : 0);
    if (gain > bestGain) {
      bestGain = gain;
      target = p;
    }
  }

  if (!target || bestGain < 2) return applyPass(s, teamCode);

  const lead = leadingOffer(s, target.id);
  // §13.3: a rebid over an existing offer can be deterministically missed
  // even though the target is still rational; a fresh, uncontested offer
  // never is (there is no "rebid" to miss).
  if (lead && difficulty.missedRebidRate > 0) {
    const missUnit = (deterministicNoiseUnit(teamCode, s.season, "fa_rebid", target.id) + 1) / 2; // [0,1)
    if (missUnit < difficulty.missedRebidRate) return applyPass(s, teamCode);
  }

  const ask = expectedSalary(target);
  const salary = Math.round(Math.max(ask, (lead?.salary ?? 0) * 1.04) * 10) / 10;
  const years = target.age <= 26 ? 4 : target.age <= 29 ? 3 : 2;
  applyOffer(s, teamCode, target.id, salary, years);
}

/**
 * Everything a CPU turn needs that does not change while a round is running.
 *
 * Nothing signs mid-round — `resolveRound` is the only thing that moves a
 * player onto a roster — so the unsigned pool and every team's best-by-
 * position are fixed for the whole round. Computing them per turn meant two
 * full passes over ~2,000 players for each of ~30 CPU teams between one
 * human turn and the next, and single-player runs all of that inside an
 * immer producer where every read is a proxy trap. One click cost well over
 * a second of frozen tab.
 */
interface RoundIndex {
  round: number;
  pool: Player[];
  bestByTeam: Map<string, Map<string, number>>;
  /** every rostered rating by team and position, for the Master AI's unit model */
  ratingsByTeam: Map<string, Map<string, number[]>>;
}

/**
 * How many times the round index has been rebuilt this process.
 *
 * Rebuilding is the expensive thing here — it walks every player in the
 * league — and the bug this guards against was rebuilding it once per *team*
 * rather than once per *round*, which took a single free-agency turn from
 * 189ms to 1325ms and froze the tab. That used to be pinned with a wall-clock
 * budget, which is not a safe assertion inside a parallel test runner: the
 * same turn measured 525ms, 725ms and 795ms across runs on a busy machine and
 * failed a suite that had nothing wrong with it. Counting the rebuilds
 * measures the actual invariant and does not care how loaded the box is.
 */
export let roundIndexBuilds = 0;
export function resetRoundIndexBuilds(): void {
  roundIndexBuilds = 0;
}

function indexRound(s: LeagueState): RoundIndex {
  roundIndexBuilds++;
  const signed = new Set((s.freeAgencyEvent?.signed ?? []).map((x) => x.playerId));
  const pool: Player[] = [];
  const bestByTeam = new Map<string, Map<string, number>>();
  const ratingsByTeam = new Map<string, Map<string, number[]>>();
  // one pass for all three: who is still available, and what every roster already has
  for (const p of Object.values(s.players)) {
    if (p.retired) continue;
    if (p.free_agent) {
      if (!signed.has(p.id)) pool.push(p);
      continue;
    }
    let byPos = bestByTeam.get(p.nfl_team);
    if (!byPos) bestByTeam.set(p.nfl_team, (byPos = new Map()));
    if (p.overall > (byPos.get(p.position) ?? 0)) byPos.set(p.position, p.overall);
    let lists = ratingsByTeam.get(p.nfl_team);
    if (!lists) ratingsByTeam.set(p.nfl_team, (lists = new Map()));
    const l = lists.get(p.position);
    if (l) l.push(p.overall);
    else lists.set(p.position, [p.overall]);
  }
  return { round: s.freeAgencyEvent?.round ?? 0, pool, bestByTeam, ratingsByTeam };
}

/** Run CPU turns until a human is on the clock or the event ends. */
export function runCpuTurns(s: LeagueState, humanTeams: Set<string>): number {
  let acted = 0;
  let guard = 0;
  let index = indexRound(s);
  while (guard++ < 400) {
    const e = s.freeAgencyEvent;
    if (!e || e.complete) break;
    // a resolved round signs players, which is the one thing that invalidates
    // the index — rebuild it then, and only then
    if (e.round !== index.round) index = indexRound(s);
    const team = onTheClock(s);
    if (!team || humanTeams.has(team)) break;
    cpuTurn(s, team, index);
    acted++;
  }
  return acted;
}
