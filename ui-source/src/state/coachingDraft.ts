import type { Coach, CoachRole, LeagueState } from "@/domain";
import { COACH_ROLES } from "@/domain";
import { strategyCoachBonus } from "./aiStrategy.ts";
import { deterministicNoiseUnit, shortlistByBaseScore } from "./aiDifficulty.ts";
import { difficultyFor, strategyOf } from "./aiGms.ts";
import { coachPriorities } from "@/sim/priorities";
import { STAFF_WEIGHTS } from "./staffRatings.ts";

/**
 * The coaching fantasy draft.
 *
 * Twelve rounds, one staff job filled per team per round, snake order. The
 * order is the deliberate part: coaching round 1 is the exact reverse of
 * player-draft round 1, so whoever chose first among the players chooses last
 * among the coaches. Drafting Myles Garrett first should cost something, and
 * this is where it costs.
 *
 * Unlike the player draft there is no threshold and no automated remainder.
 * All twelve picks are made by hand, by everybody, because a staff is twelve
 * decisions and simulating eleven of them would leave the stage pointless.
 *
 * A turn is "any available candidate for any role you have not filled", which
 * is looser than a role-per-round and is what makes the snake matter: taking
 * the best quarterbacks coach early means living with whoever is left at
 * linebackers, and the GM decides which of those hurts less.
 */

/** Twelve — one pick per staff job. */
export const COACHING_ROUNDS = COACH_ROLES.length;

export interface CoachingDraftState {
  /** Team codes in pick order, the whole board, snaked. */
  pickOrder: string[];
  currentPickIndex: number;
  results: { teamCode: string; coachId: string; role: CoachRole; round: number }[];
}

/**
 * Build the board.
 *
 * `playerRound1` is the first thirty-two picks of the player draft, in order.
 * Reversing it gives coaching round 1; the snake then alternates as usual, so
 * round 2 runs in player-draft order, round 3 reversed again, and so on.
 */
export function buildCoachingOrder(playerRound1: readonly string[]): string[] {
  const reversed = [...playerRound1].reverse();
  const order: string[] = [];
  for (let round = 0; round < COACHING_ROUNDS; round++) {
    const seq = round % 2 === 0 ? reversed : [...reversed].reverse();
    order.push(...seq);
  }
  return order;
}

/**
 * Open the coaching draft on a league that has finished its player draft.
 *
 * Everybody goes into the pool first, real staff included. A fantasy league
 * drafts its coaches the way it drafts its players: Andy Reid is a candidate,
 * not Kansas City's property, and whoever takes him takes him. Leaving the
 * real staffs in place would mean thirty-two teams drafting nine coaches each
 * and the three that matter most already decided.
 */
export function beginCoachingDraft(s: LeagueState): void {
  if (s.coachingDraft) return;
  for (const c of Object.values(s.coaches)) {
    c.team = null;
    c.contract = null;
  }
  const teams = Object.keys(s.teams);
  // The player draft's first round is the first `teams.length` picks of its
  // order. A league that somehow arrives without one still gets a board.
  const playerRound1 = s.draft?.pickOrder.slice(0, teams.length) ?? teams;
  s.coachingDraft = {
    pickOrder: buildCoachingOrder(playerRound1),
    currentPickIndex: 0,
    results: [],
  };
}

/** Which team is on the clock, or undefined when the board is finished. */
export function coachingOnTheClock(s: LeagueState): string | undefined {
  const d = s.coachingDraft;
  if (!d) return undefined;
  return d.pickOrder[d.currentPickIndex];
}

export function coachingDraftComplete(s: LeagueState): boolean {
  const d = s.coachingDraft;
  return !!d && d.currentPickIndex >= d.pickOrder.length;
}

/** Jobs this team has not filled yet. */
export function vacantRoles(s: LeagueState, teamCode: string): CoachRole[] {
  const filled = new Set(
    Object.values(s.coaches)
      .filter((c) => c.team === teamCode)
      .map((c) => c.role),
  );
  return COACH_ROLES.filter((r) => !filled.has(r));
}

/** Coaches nobody has taken. */
export function availableCoaches(s: LeagueState, role?: CoachRole): Coach[] {
  return Object.values(s.coaches).filter((c) => c.team === null && (!role || c.role === role));
}

export interface CoachPickCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this team may take this coach right now.
 *
 * Deliberately strict about the turn. A coaching draft where somebody can
 * pick out of order is not a draft, and the board is shared state that every
 * GM is reading — so the ruling lives here and the server applies it, rather
 * than the screen hiding the button and hoping.
 */
export function checkCoachingPick(
  s: LeagueState,
  teamCode: string,
  coachId: string,
): CoachPickCheck {
  const d = s.coachingDraft;
  if (!d) return { ok: false, reason: "The coaching draft hasn't started." };
  if (coachingDraftComplete(s)) return { ok: false, reason: "The coaching draft is over." };
  if (d.pickOrder[d.currentPickIndex] !== teamCode) {
    return { ok: false, reason: "It isn't your pick." };
  }
  const coach = s.coaches[coachId];
  if (!coach) return { ok: false, reason: "No such coach." };
  if (coach.team) return { ok: false, reason: `${coach.name} is already taken.` };
  if (!vacantRoles(s, teamCode).includes(coach.role)) {
    return { ok: false, reason: `You've already filled ${coach.role}.` };
  }
  return { ok: true };
}

/** Applies the pick. Call `checkCoachingPick` first; this assumes it passed. */
export function applyCoachingPick(s: LeagueState, teamCode: string, coachId: string): void {
  const d = s.coachingDraft;
  const coach = s.coaches[coachId];
  if (!d || !coach) return;
  coach.team = teamCode;
  // his own asking price, as the hiring market uses: a flat $4.0M put every
  // coach on every staff, head coach to special teams, on the same deal
  if (!coach.contract) {
    const ask = coachPriorities(coach).expectation;
    coach.contract = { yearsRemaining: ask.years, annualValue: ask.baseSalary };
  }
  d.results.push({
    teamCode,
    coachId,
    role: coach.role,
    round: Math.floor(d.currentPickIndex / Object.keys(s.teams).length) + 1,
  });
  d.currentPickIndex += 1;
}

/**
 * The pick an AI team makes: the best coach available for a job it still has.
 *
 * Deliberately simple and deterministic. It takes the highest-rated candidate
 * across all of its vacant roles rather than filling in a fixed order, which
 * means an AI team behaves the way the draft intends — best available, and
 * live with the gaps.
 */
/**
 * A candidate's worth to this team right now: his rating, plus how far the
 * job falls off if it waits.
 *
 * Taking the highest rating on the board every round filled the deep jobs
 * first (a 89 receivers coach over an 86 head coach) and left the thin ones
 * to the dregs — a playthrough staff ended with linebackers and defensive
 * backs coaches at 55, developing their players 25% *slower*. What a job
 * will cost later is the candidate the other teams still hiring for it
 * leave behind: the (n+1)th best, where n is how many of them there are.
 */
export function coachingPickValue(s: LeagueState, teamCode: string): (c: Coach) => number {
  const later = new Map<CoachRole, number>();
  const rivalsHiring = new Map<CoachRole, number>();
  for (const t of Object.keys(s.teams)) {
    if (t === teamCode) continue;
    for (const role of vacantRoles(s, t)) rivalsHiring.set(role, (rivalsHiring.get(role) ?? 0) + 1);
  }
  const pools = new Map<CoachRole, number[]>();
  for (const c of availableCoaches(s)) {
    const l = pools.get(c.role);
    if (l) l.push(ratingOf(c));
    else pools.set(c.role, [ratingOf(c)]);
  }
  for (const role of COACH_ROLES) {
    const pool = (pools.get(role) ?? []).sort((a, b) => b - a);
    later.set(role, pool[Math.min(rivalsHiring.get(role) ?? 0, pool.length - 1)] ?? 40);
  }
  // weighted the way the staff rating weighs jobs: a head coach or a
  // coordinator counts for over twice a position coach. Unweighted, a GM who
  // took every suggestion filled the deep-tailed position jobs first and was
  // left a 67 coordinator pair and the 25th-best staff of 32.
  return (c) => (STAFF_WEIGHTS[c.role] ?? 1) * (ratingOf(c) + (ratingOf(c) - (later.get(c.role) ?? ratingOf(c))));
}

/** The pick a GM should make: the best value among the jobs still open. */
export function suggestedCoachingPick(s: LeagueState, teamCode: string): Coach | null {
  const open = new Set(vacantRoles(s, teamCode));
  const value = coachingPickValue(s, teamCode);
  let best: Coach | null = null;
  for (const c of availableCoaches(s)) {
    if (!open.has(c.role)) continue;
    if (!best || value(c) > value(best)) best = c;
  }
  return best;
}

export function bestCoachingPick(s: LeagueState, teamCode: string): string | null {
  const vacancies = new Set(vacantRoles(s, teamCode));
  // AI GM season strategy (§6): a bounded role preference on top of the same
  // rating-based evaluator — a strategy can break a close tie between two
  // similarly-rated candidates for different roles, never hand a team a
  // meaningfully worse coach because the role fits its personality.
  const strategy = strategyOf(s, teamCode);
  // AI Difficulty (§12): a narrower search (fewer candidates seriously
  // evaluated) plus deterministic score noise on top of the same base
  // rating — role vacancies/availability stay identical at every level.
  const difficulty = difficultyFor(s, teamCode);
  const eligible = availableCoaches(s).filter((c) => vacancies.has(c.role));
  const shortlist = shortlistByBaseScore(eligible, ratingOf, difficulty.candidateDepth);
  const score = (c: Coach): number => {
    const noise =
      difficulty.coachEvaluationNoise === 0
        ? 0
        : deterministicNoiseUnit(teamCode, s.season, "coaching_draft", c.id) * difficulty.coachEvaluationNoise;
    return ratingOf(c) + strategyCoachBonus(strategy, c.role) + noise;
  };
  let best: Coach | null = null;
  for (const c of shortlist) {
    if (!best || score(c) > score(best)) best = c;
  }
  return best?.id ?? null;
}

/**
 * One number for a coach, whatever kind they are.
 *
 * The development coaches carry `overall`; the three real ones carry their own
 * characteristics instead, so this reads whichever they have. It exists for
 * comparing candidates, not for gameplay.
 */
export function ratingOf(c: Coach): number {
  if (c.overall != null) return c.overall;
  if (c.role === "HC") {
    return Math.round(((c.gameManagement ?? 60) + (c.discipline ?? 60)) / 2);
  }
  return c.playCallIq ?? 60;
}

/** Run AI picks until a human team is on the clock, or the board is done. */
export function runAiCoachingPicks(s: LeagueState, humanTeams: Set<string>): number {
  let made = 0;
  while (!coachingDraftComplete(s)) {
    const onClock = coachingOnTheClock(s);
    if (!onClock || humanTeams.has(onClock)) break;
    const pick = bestCoachingPick(s, onClock);
    if (!pick) break;
    applyCoachingPick(s, onClock, pick);
    made++;
  }
  return made;
}
