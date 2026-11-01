/**
 * What a defender's coverage rating means (Phase C1b-2a): how fast he reads the receiver, how far ahead he plays him, how much room he
 * needs, and how well he contests the ball. Everything here is a smooth function of a rating and of the two players' speeds, in
 * seconds and yards, with no thresholds and no cap on any outcome. It is a pure function of the players, so it changes nothing about
 * determinism, and it is the single place that says what a coverage point is worth.
 *
 * Coverage and hands stay distinct: coverage is the *positioning and contest* skill (this file and `playChance`); hands is the skill of
 * taking the ball away once he has a hand on it (`takeAwayChance`), and it appears nowhere here.
 */
import { maxSpeed, type ArcadePlayer } from './simulation';

/** The rating at which a defender reads and reacts exactly as the Phase B2 constants did: the average corner. */
export const COVERAGE_REFERENCE = 76;
const rating = (d: Pick<ArcadePlayer, 'abilities'>): number => Math.max(0, Math.min(99, d.abilities.coverage));
/** `2 ** ((reference - rating) / halving)`: 1 at the reference, and every `halving` points below it doubles it (above it halves it). */
const slower = (d: Pick<ArcadePlayer, 'abilities'>, halving: number): number => 2 ** ((COVERAGE_REFERENCE - rating(d)) / halving);

/** Seconds the average corner needs to see his man change direction (Phase B2's fixed 0.15 s); 60 rating points double it. */
export const REACTION_SECONDS = 0.15;
export const REACTION_DOUBLING = 60;
export const reactionSeconds = (d: Pick<ArcadePlayer, 'abilities'>): number => REACTION_SECONDS * slower(d, REACTION_DOUBLING);

/** Seconds ahead of the receiver a defender aims (Phase B2's fixed 0.15 s) for the average corner. Better coverage reads the route sooner, so he aims further ahead (80 points double it). */
export const ANTICIPATION_SECONDS = 0.15;
export const ANTICIPATION_DOUBLING = 80;
export const anticipationSeconds = (d: Pick<ArcadePlayer, 'abilities'>): number => ANTICIPATION_SECONDS / slower(d, ANTICIPATION_DOUBLING);

/**
 * How much room a man defender keeps off a receiver who is still on his stem. It is what he needs, not a number:
 *
 *   room = the ground the receiver covers while the defender is still reading him              (speed x reaction)
 *        + the ground the receiver gains while the defender backpedals and decides to turn     (speed deficit x flip time)
 *        + a window he wants to keep a quick throw inside                                     (VISION_YARDS)
 *
 * so a faster receiver, a slower corner, a slower reader (low coverage) and a longer flip all lengthen it, and a corner who can run
 * with the receiver and read him quickly plays him tight. `BACKPEDAL_SHARE` is the share of his speed a corner has while going backwards.
 */
export const BACKPEDAL_SHARE = 0.85;
/** Seconds the average corner backpedals while he reads the stem before he commits his hips (the reaction scaling lengthens it for a slower reader). */
export const FLIP_SECONDS = 1;
/** Yards of the receiver's stem a corner is prepared to concede to a quick throw: the window he plays inside. */
export const VISION_YARDS = 4.5;
export function manRoom(defender: Pick<ArcadePlayer, 'abilities'>, receiver: Pick<ArcadePlayer, 'abilities'>): number {
    const vr = maxSpeed(receiver as ArcadePlayer), vd = maxSpeed(defender as ArcadePlayer), slow = slower(defender, REACTION_DOUBLING);
    const reading = vr * REACTION_SECONDS * slow;
    const deficit = Math.max(0, vr - BACKPEDAL_SHARE * vd) * FLIP_SECONDS * slow;
    return reading + deficit + VISION_YARDS;
}

/**
 * The chance a defender who has reached the ball gets a hand on it, as a smooth function of his coverage rating: a logistic centred
 * where a defender with no particular gift is as likely to as not (`CONTEST_MIDPOINT`), widening over `CONTEST_WIDTH` points.
 * It replaces the old 55% floor (a rating of 0 still got a hand on the ball more than half the time).
 */
export const CONTEST_MIDPOINT = 45;
export const CONTEST_WIDTH = 22;
export const contestSkill = (d: Pick<ArcadePlayer, 'abilities'>): number => 1 / (1 + Math.exp(-(rating(d) - CONTEST_MIDPOINT) / CONTEST_WIDTH));

