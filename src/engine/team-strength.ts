import type { Player } from "../schema/player.js";
import type { Roster } from "./roster.js";

/**
 * The part of team quality the modelled families cannot see (§23 residual).
 *
 * ## The problem this exists to fix
 *
 * The rating layer carries about half the team-quality signal it should, and
 * two unrelated measurements agree on that:
 *
 * | | real | engine |
 * |---|---:|---:|
 * | between-team points sd | 4.28 | 2.15 |
 * | favourite win rate | 66–70% | 56–59% |
 *
 * (Between/within decomposition over 1,632 real team-games, 2023–25, against
 * 2,000 engine team-games with the rating layer on. The favourite rate is
 * `m24b_rating_layer_validation.report.md`, which had it at 58.8% by summed
 * overall, against NFL point-spread favourites at 66–70%.)
 *
 * The *within*-team spread is already right — 8.68 against 8.96 — so this is
 * not a missing game-to-game form factor. The engine's good teams simply are
 * not good enough and its bad teams are not bad enough.
 *
 * ## Why this is an addition and not a bigger beta
 *
 * The same §23 report shows all seven modelled families landing at 0.99–1.0×
 * their historical anchors by design magnitude. Every modelled channel is
 * already calibrated correctly, so scaling the betas would break seven right
 * answers to patch one aggregate. The report names the real cause in passing:
 * *"overall folds in depth / special teams / blocking the V1 engine does not
 * model yet."* Team quality acts through more channels than V1 models; each
 * modelled one is right; the remainder is missing entirely.
 *
 * So this is the remainder, as one channel, fitted against the two aggregates
 * above — the same shape as `home-field.ts`, which is a mechanism whose size
 * was fitted against the one number nobody can argue with.
 *
 * ## What it reads
 *
 * A snap-weighted mean of the whole roster rather than the starters, because
 * the starters are exactly what the modelled families already read. The
 * weights fall off steeply — a starter plays most snaps, his backup plays
 * some, the fourth man at a position plays almost none — so this is "how good
 * is the team that actually takes the field", including the depth and the
 * unmodelled positions that the families skip.
 *
 * ## Where it applies
 *
 * The same channels the rest of the layer moves: completion, sacks, and rush
 * yards. Deliberately *not* the scoring rate directly — a team-quality thumb
 * on the scoreboard would produce the right variance through a mechanism that
 * does not exist, and every downstream statistic would be wrong in a way the
 * summary numbers would hide.
 *
 * ## The league average does not move
 *
 * What enters a play is the difference between the two teams on the field, so
 * across a balanced schedule the shifts cancel league-wide. That is what keeps
 * §22 — measured with the rating layer off entirely — and the §26 joint
 * calibration undisturbed.
 */

/**
 * Snap weight by depth-chart position.
 *
 * Steeper than playing time actually is, on purpose: the point is to weight
 * toward the players who decide games without letting a long roster of camp
 * bodies dominate the average.
 */
const DEPTH_WEIGHTS = [1, 0.35, 0.12, 0.05];

/**
 * Which side of the ball a position is on.
 *
 * The index is computed per side, not per team, and that matters more than it
 * looks. A single team-wide index makes every matchup exactly zero-sum: the
 * same gap that helps one offense hurts the other by the identical amount, so
 * the two scores become almost perfectly anti-correlated and margins blow out.
 * Measured: a team-wide index put score-margin sd at 16.15 against a real
 * 14.33, while points sd was fine at 9.58 against 9.93 — the individual scores
 * were right and their *relationship* was not.
 *
 * Splitting it fixes that, because a team's offense and its defense are
 * different numbers. What drives a drive is this offense against that defense,
 * which is how football works and is no longer a mirror.
 */
const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE", "OT", "OG", "C", "OL"]);
const DEFENSE = new Set(["EDGE", "DT", "DL", "ILB", "OLB", "LB", "CB", "S", "DB"]);

/**
 * Memoised per roster.
 *
 * This is read three times a play, and walking a 53-man roster each time made
 * the engine roughly two orders of magnitude slower — the full test suite went
 * from under three minutes to over four hours. A roster's depth chart does not
 * change inside a game, so the index is computed once and kept on a WeakMap
 * that lets the roster be collected with it.
 */
const _cache = new WeakMap<Roster, StrengthIndex>();

export interface StrengthIndex {
  /** Snap-weighted mean of the offense, 0–99. */
  offense: number;
  /** Snap-weighted mean of the defense, 0–99. */
  defense: number;
}

/** How good is the team that actually takes the field, by side. */
export function strengthIndex(r: Roster): StrengthIndex {
  const hit = _cache.get(r);
  if (hit !== undefined) return hit;

  let offNum = 0;
  let offDen = 0;
  let defNum = 0;
  let defDen = 0;
  for (const [pos, list] of r.depth) {
    const side = OFFENSE.has(pos) ? "off" : DEFENSE.has(pos) ? "def" : null;
    if (side === null) continue; // kickers and punters are their own model
    list.forEach((p: Player, i: number) => {
      const w = DEPTH_WEIGHTS[i] ?? 0;
      if (w === 0) return;
      if (side === "off") {
        offNum += w * (p.overall ?? 0);
        offDen += w;
      } else {
        defNum += w * (p.overall ?? 0);
        defDen += w;
      }
    });
  }
  const out: StrengthIndex = {
    offense: offDen > 0 ? offNum / offDen : 0,
    defense: defDen > 0 ? defNum / defDen : 0,
  };
  _cache.set(r, out);
  return out;
}

/**
 * Multiplies every shift below. Fitted, not chosen, and it came out at one.
 *
 * Swept over 2,816 team-games a point, every ordered pair of the 32 teams,
 * against four numbers rather than one — because a channel that adds variance
 * can hit a scoring target while getting the *relationship* between the two
 * scores wrong, and margin is where that shows:
 *
 * | scale | points sd | margin sd | favourite win % | between-team sd |
 * |---|---:|---:|---:|---:|
 * | 0.0 | 8.79 | — | 56.2 | 1.76 |
 * | **1.0** | **9.51** | **14.58** | **67.8** | 3.39 |
 * | 1.2 | 9.50 | 14.75 | 68.3 | 3.67 |
 * | 1.35 | 10.00 | 15.78 | 68.8 | 3.99 |
 * | 2.0 | 10.60 | 17.39 | 75.0 | 4.93 |
 * | *real* | *9.93* | *14.33* | *66–70* | *4.28* |
 *
 * 1.35 puts `points_sd` almost exactly on target and is still wrong: margin sd
 * goes 10% over and the sack rate goes 10.6% over with it. 1.0 keeps every
 * validated metric inside the ±10% threshold — at a 4,992-game confirmation,
 * points sd −5.0%, margin sd +2.1%, completion −0.2%, favourite rate 65.9% —
 * and leaves the between-team decomposition, which is a diagnostic derived
 * here rather than a validated metric, about 20% light.
 *
 * The scale landing on one is a coincidence worth keeping rather than
 * deleting: it says the per-channel weights below *are* the calibration, and
 * it leaves the knob in place and documented for the next refit. (Home field
 * did the same thing and came out at 1.11.)
 */
export const TEAM_STRENGTH_SCALE = 1.0;

/**
 * Per-point-of-index channel effects.
 *
 * Signs are from the offense's point of view: a better offense completes
 * more, is sacked less, and runs for more. The defensive index enters with
 * the opposite sign, so what actually drives a play is the *difference*
 * between the two teams on the field.
 *
 * The magnitudes are relative weights rather than fitted constants — the one
 * fitted number is `TEAM_STRENGTH_SCALE`, and these set how it is spread
 * across the channels, in the same proportions the modelled families move
 * them.
 */
const PER_POINT = {
  /** logit, M09 COMPLETE */
  complete: 0.055,
  /** logit, M04 SACK */
  sack: -0.045,
  /** yards, M15 rush */
  rushYards: 0.055,
} as const;

type Channel = keyof typeof PER_POINT;

/**
 * The shift for one channel, from the two teams' indices.
 *
 * Deliberately a difference and nothing else. An earlier draft centred each
 * index on a league mean before subtracting, which reads as though it matters
 * and cancels exactly: `(off - m) - (def - m)` is `off - def`. Since only the
 * difference survives, there is no league constant to keep, and nothing here
 * has to be re-centred when a fantasy draft moves every player in the league.
 *
 * It is also why the league average cannot move. Across a balanced schedule
 * every team is on both sides of this, so the shifts cancel league-wide and
 * §22 — measured with the rating layer off entirely — is untouched.
 */
export function strengthShift(
  offense: StrengthIndex,
  defense: StrengthIndex,
  channel: Channel,
): number {
  // this offense against that defense — not team against team, which would be
  // a mirror and would double-count the same gap on both scoreboards
  return (offense.offense - defense.defense) * PER_POINT[channel] * TEAM_STRENGTH_SCALE;
}
