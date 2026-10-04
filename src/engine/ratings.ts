/**
 * Rating layer (spec §12–§14) — turns lineups into logit / yardage modifiers.
 *
 * TS port of `analysis/engine/ratings.py`.
 *
 *   modifier(family) = Σ_attr  beta_per_z(attr) · clip(z(attr), -3, 3)
 *
 * z(attr) = (unit_mean_rating − ref_mean) / ref_sd over the participating
 * players who have that attribute. Signs are folded into `beta_per_z`.
 *
 * §12 centering: `ref_mean` is over the whole reference pool, but the engine
 * only fields starters (above that mean), so each `*Shift` subtracts the
 * family's league-mean modifier over its on-field slot (`offsets()`) — an
 * average real matchup then nets ≈0 and only matchup *differences* move the
 * outcome.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Player } from "../schema/player.js";
import { type Lineup, roster, teamList } from "./roster.js";

/** A "unit" is the set of participating players; nulls/undefined are ignored. */
type Unit = readonly (Player | null | undefined)[];

const CLIP = 3.0;

interface FamilyAttr {
  attribute: string;
  beta_per_z: number;
}
interface Family {
  attributes: FamilyAttr[];
}
interface RefStat {
  mean: number;
  sd: number;
}

function readArtifact<T>(rel: string): T {
  const url = new URL(`../../artifacts/ratings/${rel}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

const FAMILIES: Record<string, Family> = readArtifact<{ families: Record<string, Family> }>(
  "rating_effect_coefficients.json",
).families;

const REF: Record<string, RefStat> = readArtifact<{
  attribute_reference_stats: Record<string, RefStat>;
}>("attribute_reference_stats.json").attribute_reference_stats;

/**
 * One attribute as a clipped z-score against the reference pool, or null when
 * the attribute has no reference. The same standardisation `familyModifier`
 * applies to a unit mean, exposed per player for `synergy.ts`, which needs
 * each man's own score rather than his unit's average.
 */
export function attributeZ(attr: string, value: number): number | null {
  const r = REF[attr];
  if (!r || !r.sd) return null;
  return Math.max(-CLIP, Math.min(CLIP, (value - r.mean) / r.sd));
}

/** Mean of `attr` over players that have it, or null. */
function unitMean(players: Unit, attr: string): number | null {
  let sum = 0;
  let n = 0;
  for (const p of players) {
    const v = p?.attributes?.[attr as keyof Player["attributes"]];
    if (typeof v === "number") {
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

const _modCache = new Map<string, number>();

/** Σ beta·z over the family's attributes for this participating unit. */
export function familyModifier(famKey: string, players: Unit, scale = 1): number {
  const key = `${famKey}|${players.map((p) => p?.id ?? "").join(",")}`;
  const hit = _modCache.get(key);
  if (hit !== undefined) return hit * scale;

  const fam = FAMILIES[famKey];
  let total = 0;
  if (fam) {
    for (const a of fam.attributes) {
      const m = unitMean(players, a.attribute);
      const r = REF[a.attribute];
      if (m === null || !r || !r.sd) continue;
      let z = (m - r.mean) / r.sd;
      z = Math.max(-CLIP, Math.min(CLIP, z));
      total += a.beta_per_z * z;
    }
  }
  _modCache.set(key, total);
  return total * scale;
}

// ---- §12 league centering -------------------------------------------------

type Pick = (o: Lineup, d: Lineup) => Unit;

const SLOTS: Record<string, Pick> = {
  qb_accuracy: (o) => [o.QB1],
  qb_ball_security: (o) => [o.QB1],
  receiver_hands_routes: (o) => [o.WR1, o.WR2, o.WR3, o.TE1],
  yac_ballcarrier: (o) => [o.WR1],
  coverage: (_o, d) => [d.CB1, d.CB2, d.S1, d.S2],
  open_field_tackling: (_o, d) => [d.CB1, d.CB2, d.S1, d.S2, d.ILB1, d.ILB2],
  protection: (o) => [o.LT, o.LG, o.C, o.RG, o.RT],
  pass_rush: (_o, d) => [d.EDGE1, d.EDGE2, d.DT1, d.DT2],
  run_defense_front7: (_o, d) => [d.EDGE1, d.EDGE2, d.DT1, d.DT2, d.ILB1, d.ILB2],
  runner: (o) => [o.RB1],
};

let _offsets: Record<string, number> | null = null;

/** Per-family mean modifier over its on-field slot across all 32 depth charts. */
export function offsets(): Record<string, number> {
  if (_offsets) return _offsets;
  const teams = teamList();
  const off = new Map(teams.map((t) => [t, roster(t).offense()]));
  const def = new Map(teams.map((t) => [t, roster(t).defense()]));
  const out: Record<string, number> = {};
  for (const [fam, pick] of Object.entries(SLOTS)) {
    let s = 0;
    for (const t of teams) s += familyModifier(fam, pick(off.get(t)!, def.get(t)!));
    out[fam] = s / teams.length;
  }
  let sk = 0;
  for (const t of teams) sk += familyModifier("kicking", [roster(t).kicker()]);
  out.kicking = sk / teams.length;

  const PUNT_FAMILIES = [
    "punt_power",
    "punt_accuracy_touchback",
    "punt_accuracy_placement",
    "punt_coffin_corner_touchback",
    "punt_coffin_corner_placement",
    "punt_hang_time_return",
    "punt_hang_time_return_yards",
  ] as const;
  for (const fam of PUNT_FAMILIES) {
    let s = 0;
    for (const t of teams) s += familyModifier(fam, [roster(t).punter()]);
    out[fam] = s / teams.length;
  }

  _offsets = out;
  return out;
}

function centered(famKey: string, players: Unit): number {
  return familyModifier(famKey, players) - (offsets()[famKey] ?? 0);
}

// ---- resolver shift functions (spec §11 player-modifier lists) -----------

/** M09 COMPLETE: qb accuracy (+) + receiver hands/routes (+) + coverage (−). */
export function completionLogitShift(
  catchers: Unit,
  defenders: Unit,
  qb: Player | null | undefined,
): number {
  return (
    centered("qb_accuracy", [qb]) +
    centered("receiver_hands_routes", catchers) +
    centered("coverage", defenders)
  );
}

/** M09 INTERCEPTION: qb ball security (−). */
export function interceptionLogitShift(qb: Player | null | undefined): number {
  return centered("qb_ball_security", [qb]);
}

/** M04 SACK: protection (−) + pass rush (+). */
export function sackLogitShift(ol: Unit, rushers: Unit): number {
  return centered("protection", ol) + centered("pass_rush", rushers);
}

/**
 * How much of the fitted runner family is the runner's own.
 *
 * The family was fitted on real seasons, where good backs mostly run behind
 * good lines — and the fit had no line term to give that to, so the back took
 * the line's credit too. The line now has its own run-game channels (synergy's
 * `runBlockLinear`, the team-strength run index), so leaving the back the
 * whole coefficient counted the line twice: an elite back was worth nearly an
 * elite quarterback. Two thirds is the share the line-controlled literature
 * leaves the back (and what brought him to about two thirds of a
 * quarterback's value, `analysis/38_unit_links.ts`).
 */
export const RUNNER_OWN_SHARE = 0.65;

/** M14 yards: runner (+) + front seven (−). */
export function rushYardsShift(
  _ol: Unit,
  front7: Unit,
  runner: Player | null | undefined,
): number {
  return RUNNER_OWN_SHARE * centered("runner", [runner]) + centered("run_defense_front7", front7);
}

/** M10 yards: ball-carrier (+) + open-field tackling (−). */
export function yacYardsShift(receiver: Player | null | undefined, tacklers: Unit): number {
  return centered("yac_ballcarrier", [receiver]) + centered("open_field_tackling", tacklers);
}

/** M20 MADE: kicking (+). */
export function fgLogitShift(kicker: Player | null | undefined): number {
  return centered("kicking", [kicker]);
}

/** M21 distance: punt_power (+), added to the sampled gross punt distance. */
export function puntDistanceShift(punter: Player | null | undefined): number {
  return centered("punt_power", [punter]);
}

/**
 * M21 class logits: touchback (−) / useful downed-or-out-of-bounds (+) /
 * returned (−). `punt_accuracy` applies everywhere; `coffin_corner` is
 * weighted by proximity to the punting team's target end zone, so a
 * coffin-corner specialist gets no benefit on an ordinary midfield punt.
 */
export function puntPlacementLogitShift(
  punter: Player | null | undefined,
  yardline100: number,
): Record<string, number> {
  const ccWeight = Math.max(0, Math.min(1, (40 - yardline100) / 40));
  const touchback =
    centered("punt_accuracy_touchback", [punter]) + centered("punt_coffin_corner_touchback", [punter]) * ccWeight;
  const useful =
    centered("punt_accuracy_placement", [punter]) + centered("punt_coffin_corner_placement", [punter]) * ccWeight;
  return {
    TOUCHBACK: touchback,
    DOWNED: useful,
    OUT_OF_BOUNDS: useful,
    RETURNED: centered("punt_hang_time_return", [punter]),
  };
}

/** M21 return yards: hang_time (−), subtracted from the sampled return. */
export function puntReturnYardsShift(punter: Player | null | undefined): number {
  return centered("punt_hang_time_return_yards", [punter]);
}
