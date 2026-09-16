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
 * Memoised per roster.
 *
 * This is read three times a play, and walking a 53-man roster each time made
 * the engine roughly two orders of magnitude slower — the full test suite went
 * from under three minutes to over four hours. A roster's depth chart does not
 * change inside a game, so the index is computed once and kept on a WeakMap
 * that lets the roster be collected with it.
 */
const _cache = new WeakMap<Roster, number>();

/** How good is the team that actually takes the field, 0–99. */
export function strengthIndex(r: Roster): number {
  const hit = _cache.get(r);
  if (hit !== undefined) return hit;

  let num = 0;
  let den = 0;
  for (const [, list] of r.depth) {
    list.forEach((p: Player, i: number) => {
      const w = DEPTH_WEIGHTS[i] ?? 0;
      if (w === 0) return;
      num += w * (p.overall ?? 0);
      den += w;
    });
  }
  const out = den > 0 ? num / den : 0;
  _cache.set(r, out);
  return out;
}

/**
 * Multiplies every shift below. Fitted, not chosen.
 *
 * Swept over 2,816 team-games a point, every ordered pair of the 32 teams:
 *
 * | scale | points sd | between-team sd | favourite win % |
 * |---|---:|---:|---:|
 * | 0.0 | 8.79 | 1.76 | 56.2 |
 * | 1.2 | **9.77** | 3.55 | **68.0** |
 * | 1.3 | 9.93 | 3.71 | 69.6 |
 * | 1.6 | 10.16 | 4.20 | 71.5 |
 * | 1.8 | 10.30 | 4.46 | 72.7 |
 * | *real* | *9.93* | *4.28* | *66-70* |
 *
 * The three targets do not all land at once, so the two that are actually
 * validated win: `points_sd` is the §22 metric and the favourite rate is the
 * §23 benchmark, while the between-team decomposition is a diagnostic derived
 * here. 1.3 hits `points_sd` exactly but puts the favourite rate at the top of
 * its range; 1.2 is mid-range there and leaves `points_sd` 1.6% light, which
 * is well inside the ±10% pass threshold.
 *
 * 1.2 gets the benefit of the doubt for a second reason. The favourite here is
 * picked by mean starter overall, which is cruder than the summed-overall
 * measure the §23 report used — and cruder still than a betting line, which is
 * what the 66-70% anchor describes. A cruder signal should win *less* often,
 * so a reading at the top of the range is more likely to be over the line than
 * a reading in the middle.
 *
 * The underlying rates barely move across this whole sweep: completion 0.659
 * -> 0.659, yards per carry 4.52 -> 4.53, sack rate 0.0657 -> 0.0672 between
 * scale 0 and 1.2. The variance arrives through the channels rather than
 * around them.
 */
export const TEAM_STRENGTH_SCALE = 1.2;

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
export function strengthShift(off: number, def: number, channel: Channel): number {
  return (off - def) * PER_POINT[channel] * TEAM_STRENGTH_SCALE;
}
