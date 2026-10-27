/**
 * Who gets the ball when a pass arrives (Phase C1b-1): a seeded sequence of decisions in place of a step function of radii.
 *
 * The old rule was geometry alone: a defender inside 1.6 yd always intercepted, one inside 2.2 yd always broke the pass up, and only a
 * receiver with nobody inside 2.2 yd always caught it. That made 83% of throws a certainty for the defense, a receiver nearer the ball
 * than the defender still lost it, and the outcome carried no trace of who the players were.
 *
 * Reaching the ball and making a play on it are separate. The sequence, with every chance an independent, named draw:
 *
 *   1. REACH.  Each player the ball could physically get to may get a hand on it. The chance falls smoothly with his distance from the
 *      landing point (it is a half at the old radii, plus the defender reach shift for the defense), and is exactly zero beyond it, so
 *      nobody intercepts a ball he could not have reached.
 *   2. ORDER.  Those who reached it get their chance in order of who was there first. Each player's time to the ball is his distance
 *      over his speed, times a random factor (the race is exponential), so the nearer of two goes first in proportion: at equal
 *      distances it is a coin flip, a player twice as near is there first two times in three, and no inch of distance is a switch.
 *   3. ATTEMPTS, in that order, until one ends it:
 *        receiver:  secures it (hands)            -> a catch, or a contested catch if a defender had also reached it
 *        defender:  gets a hand on it (coverage, facing the ball, set and not still running); if not, the ball goes on to the next
 *                   then takes it away (hands, within the catch radius, facing it, and a human only inside his Hands window) -> interception
 *                   or only knocks it down                                                                                 -> breakup
 *   4. If nobody ends it the pass falls incomplete.
 *
 * `resolveCatch` is a pure function of its input: the same seed and positions always give the same outcome, and each draw depends only on
 * the seed, the identity of the pass and its own name, never on another draw, so adding a decision cannot change an existing one.
 */
import { BREAKUP_RADIUS, CATCH_RADIUS } from './behavior';
import { DEFENSE_CODES, OFFENSE_CODES, codeOf } from './personnel';
import { maxSpeed, type ArcadePlayer, type Vector } from './simulation';
import { roll } from './seed';

export type CatchKind = 'catch' | 'contested-catch' | 'interception' | 'breakup' | 'incomplete';
export const CATCH_KINDS: readonly CatchKind[] = ['catch', 'contested-catch', 'interception', 'breakup', 'incomplete'];

/** Yards past the old radii at which the defense still reaches a ball with even odds: one width, so a defender inside the old radius reaches it about nine times in ten. */
export const DEFENDER_REACH_SHIFT = 0.35;
/** How sharply reach falls off with distance, in yards (the logistic scale): a receiver's, and a defender's. */
export const RECEIVER_REACH_WIDTH = 0.3;
export const DEFENDER_REACH_WIDTH = 0.35;
/** Players beyond this many widths past their reach radius cannot get to the ball at all (no draw is made for them). */
const REACH_CUTOFF = 4;
/** Chance a receiver who has the ball in his hands fails to hold it, for a receiver with no hands at all; it falls linearly to nothing at 99. */
/** A player's closest approach to the ball, in yards (an arm's length): his arrival rate is one over his distance plus this, so a player right on the ball is not infinitely fast. */
export const ARRIVAL_OFFSET = 0.5;
export const DROP_AT_ZERO_HANDS = 0.3;
/** A defender's chance to get a hand on a ball he reached: this much even with no coverage skill, plus up to this much more at 99. */
export const PLAY_FLOOR = 0.55;
export const PLAY_SPAN = 0.4;
/** A defender who has to turn and find the ball (it is behind him, nearer the quarterback than he is) and one still running flat out when it arrives are less able to play it. */
export const NOT_FACING = 0.6;
export const STILL_RUNNING = 0.8;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const dist = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y);
const ROLES: readonly string[] = [...OFFENSE_CODES, ...DEFENSE_CODES];
/** A player's role number: the same for either team, so a mirrored game rolls the same numbers. */
export const roleOf = (p: ArcadePlayer): number => ROLES.indexOf(codeOf(p.id));

/** The names of the decisions. Each is its own independent draw: `roll(seed, playNumber, tick, receiver, DECISION, subject)`. */
export const DECISION = { reach: 1, order: 2, secure: 3, play: 4, takeAway: 5 } as const;

export interface CatchInput {
    readonly seed: number;
    /** With the arrival tick and the receiver, identifies the pass: a down has one pass, and it arrives once. */
    readonly playNumber: number;
    readonly tick: number;
    /** Where the ball lands and where it was thrown from. */
    readonly to: Vector;
    readonly from: Vector;
    readonly receiver: ArcadePlayer;
    readonly defenders: readonly ArcadePlayer[];
    /** Whether a defender may take the ball away (a human only inside his Hands window; an AI defender always). */
    readonly mayIntercept: (defender: ArcadePlayer) => boolean;
}
export interface CatchStep { readonly role: number; readonly player: string; readonly action: 'reach' | 'secure' | 'play' | 'take'; readonly chance: number; readonly ok: boolean }
export interface CatchResult {
    readonly kind: CatchKind;
    /** The defender who intercepted it. */
    readonly interceptor: ArcadePlayer | null;
    /** Every decision made, in order, with its chance: the mechanical explanation of the outcome. */
    readonly steps: readonly CatchStep[];
}

/** Chances, each a function of geometry and ratings only. */
export const receiverReach = (r: ArcadePlayer, to: Vector): number => {
    const d = dist(r, to), p = logistic((CATCH_RADIUS - d) / RECEIVER_REACH_WIDTH);
    return d > CATCH_RADIUS + REACH_CUTOFF * RECEIVER_REACH_WIDTH ? 0 : p;
};
export const defenderReach = (d: ArcadePlayer, to: Vector): number => {
    const x = dist(d, to), p = logistic((BREAKUP_RADIUS + DEFENDER_REACH_SHIFT - x) / DEFENDER_REACH_WIDTH);
    return x > BREAKUP_RADIUS + DEFENDER_REACH_SHIFT + REACH_CUTOFF * DEFENDER_REACH_WIDTH ? 0 : p;
};
/** A receiver who has it in his hands holds it: his hands rating against the drop chance. */
export const secureChance = (r: ArcadePlayer): number => 1 - DROP_AT_ZERO_HANDS * (1 - Math.min(99, Math.max(0, r.abilities.hands)) / 99);
const facing = (d: ArcadePlayer, i: Pick<CatchInput, 'to' | 'from'>) => dist(d, i.from) <= dist(i.to, i.from) ? 1 : NOT_FACING;
const settled = (d: ArcadePlayer) => Math.hypot(d.vx, d.vy) < 0.5 * maxSpeed(d) ? 1 : STILL_RUNNING;
/** A defender who has reached the ball gets a hand on it: coverage skill, facing it, and set when it arrives. */
export const playChance = (d: ArcadePlayer, i: Pick<CatchInput, 'to' | 'from'>): number =>
    Math.min(1, (PLAY_FLOOR + PLAY_SPAN * Math.min(99, Math.max(0, d.abilities.coverage)) / 99) * facing(d, i) * settled(d));
/** Having got a hand on it, a defender takes it away if the ball is inside his catch radius, he is facing it, and his hands hold it. */
export const takeAwayChance = (d: ArcadePlayer, i: Pick<CatchInput, 'to' | 'from'>): number => {
    const x = dist(d, i.to), c = BREAKUP_RADIUS + DEFENDER_REACH_SHIFT - x, k = CATCH_RADIUS + DEFENDER_REACH_SHIFT - x;
    const inside = Math.min(1, logistic(k / DEFENDER_REACH_WIDTH) / Math.max(1e-9, logistic(c / DEFENDER_REACH_WIDTH)));
    return Math.min(1, Math.min(99, Math.max(0, d.abilities.hands)) / 99 * inside * facing(d, i));
};

export function resolveCatch(i: CatchInput): CatchResult {
    const steps: CatchStep[] = [];
    const draw = (decision: number, subject: ArcadePlayer) => roll(i.seed, i.playNumber, i.tick, roleOf(i.receiver), decision, roleOf(subject));
    const attempt = (action: CatchStep['action'], who: ArcadePlayer, chance: number, decision: number): boolean => {
        const ok = draw(decision, who) < chance;
        steps.push({ role: roleOf(who), player: who.id, action, chance, ok });
        return ok;
    };
    // 1. reach
    const reached: ArcadePlayer[] = [];
    const rr = receiverReach(i.receiver, i.to);
    if (rr > 0 && attempt('reach', i.receiver, rr, DECISION.reach)) reached.push(i.receiver);
    const defenders = [...i.defenders].sort((a, b) => roleOf(a) - roleOf(b));
    for (const d of defenders) {
        const p = defenderReach(d, i.to);
        if (p > 0 && attempt('reach', d, p, DECISION.reach)) reached.push(d);
    }
    // 2. order: an exponential race, faster for the nearer
    const rate = (p: ArcadePlayer) => 1 / (dist(p, i.to) + ARRIVAL_OFFSET);
    const order = reached.map(p => ({ p, at: -Math.log(1 - draw(DECISION.order, p)) / rate(p) }))
        .sort((a, b) => a.at - b.at || roleOf(a.p) - roleOf(b.p)).map(x => x.p);
    const defended = order.some(p => p !== i.receiver);
    // 3. attempts
    for (const p of order) {
        if (p === i.receiver) {
            if (attempt('secure', p, secureChance(p), DECISION.secure)) return { kind: defended ? 'contested-catch' : 'catch', interceptor: null, steps };
            continue;
        }
        if (!attempt('play', p, playChance(p, i), DECISION.play)) continue;
        const take = i.mayIntercept(p) ? takeAwayChance(p, i) : 0;
        if (attempt('take', p, take, DECISION.takeAway)) return { kind: 'interception', interceptor: p, steps };
        return { kind: 'breakup', interceptor: null, steps };
    }
    // 4. nobody ended it
    return { kind: 'incomplete', interceptor: null, steps };
}
