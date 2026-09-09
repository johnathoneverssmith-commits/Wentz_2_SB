/**
 * Deterministic player-ratings generator (v0).
 *
 * Given a few facts about a real player (position, age, experience, draft
 * capital, roster status) this produces a full schema-valid attribute set.
 * It is a heuristic stand-in for real ratings, meant to give Phase 1 a
 * plausible pool to develop against — NOT an accurate model of any player.
 *
 * Design goals:
 *  - deterministic: same input + seed -> same output, so pools are reproducible
 *  - position-shaped: corners run fast, guards are strong, elite QBs are rare
 *  - schema-correct: every record passes PlayerSchema
 *
 * How a rating is built:
 *  1. tier      = blend of snap-share (if the player has one), draft capital,
 *                 and years survived on a roster
 *  2. overall   = position prior + spread * tier + age/role/noise
 *  3. physicals = position body-type base, nudged by overall and age
 *  4. skills    = tracked to overall, with one strength and one weakness per player
 *  5. awareness = overall, minus a rookie penalty that experience pays back
 *
 * All magic numbers here are OQ-2 / OQ-4 territory (docs/decisions.md).
 */

import {
  POSITION_ATTRIBUTE_KEYS,
  type Player,
  type Position,
} from "../schema/player.js";
import {
  AGING_CURVES,
  JUMPING_POSITIONS,
  PHYSICAL_ATTRIBUTES,
  POSITION_OVERALL_PRIOR,
  POSITION_PHYSICAL_BASE,
} from "./positions.js";

/* --- seeded RNG --------------------------------------------------- */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;

  constructor(seedStr: string) {
    const seed = xmur3(seedStr);
    this.next = mulberry32(seed());
  }

  unit(): number {
    return this.next();
  }

  gauss(mean = 0, sd = 1): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  pick<T>(arr: readonly T[]): T {
    const v = arr[Math.floor(this.next() * arr.length)];
    if (v === undefined) throw new Error("Rng.pick on empty array");
    return v;
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const r = Math.round;

/* --- input ------------------------------------------------------------ */

export interface PlayerSeed {
  /** Stable key (e.g. gsis id) used to seed this player's RNG stream. */
  key: string;
  name: string;
  position: Position;
  age: number;
  yearsExp: number;
  /** Overall draft pick (1..262), or null when undrafted. */
  draftNumber: number | null;
  team: string;
  onIR: boolean;
  practiceSquad: boolean;
  /**
   * Season role signal in [0,1] from snap share (1 = every-down starter),
   * or null when the player has no snap data (rookies, deep bench). When
   * present it is the dominant input to `overall`.
   */
  perf: number | null;
}

export interface GenerateOptions {
  /** Perturbs every player's RNG stream; change it to reroll a whole pool. */
  seed?: string;
}

/* --- generation ----------------------------------------------------- */

/** Draft capital as [0,1]: pick 1 -> ~1, pick 262 -> ~0, undrafted -> low. */
function draftCapitalOf(seed: PlayerSeed, rng: Rng): number {
  return seed.draftNumber !== null
    ? clamp(1 - (seed.draftNumber - 1) / 261, 0, 1)
    : 0.1 + 0.16 * rng.unit(); // undrafted: low, with a thin upside tail
}

const survivorshipOf = (seed: PlayerSeed): number => clamp(seed.yearsExp, 0, 10) / 10;

/**
 * Talent tier in ~[0,1]. Snap share dominates when we have it; otherwise the
 * player is priced on draft capital + years survived (this is the rookie /
 * deep-bench path, and the reason unproven former high picks can rate high).
 */
function tierOf(seed: PlayerSeed, rng: Rng): number {
  const draft = draftCapitalOf(seed, rng);
  const surv = survivorshipOf(seed);
  const t =
    seed.perf !== null
      ? 0.55 * seed.perf + 0.3 * draft + 0.15 * surv
      : 0.72 * draft + 0.28 * surv;
  return clamp(t + 0.06 * rng.unit(), 0, 1.05);
}

function ageAdjustment(position: Position, age: number): number {
  const { dev, decline } = AGING_CURVES[position];
  if (age < dev) return Math.max(-6, -0.8 * (dev - age)); // not at ceiling yet
  if (age > decline) return Math.max(-16, -1.6 * (age - decline)); // past prime
  return 0;
}

function overallOf(seed: PlayerSeed, tier: number, rng: Rng): number {
  const prior = POSITION_OVERALL_PRIOR[seed.position];
  let ovr =
    prior.base +
    prior.spread * tier +
    ageAdjustment(seed.position, seed.age) +
    rng.gauss(0, 4.2);
  if (seed.onIR) ovr -= 1;
  if (seed.practiceSquad) ovr -= 12;
  return seed.practiceSquad ? clamp(r(ovr), 42, 73) : clamp(r(ovr), 42, 99);
}

function physicalsOf(
  seed: PlayerSeed,
  overall: number,
  rng: Rng,
): Partial<Record<(typeof PHYSICAL_ATTRIBUTES)[number], number>> {
  const bases = POSITION_PHYSICAL_BASE[seed.position];
  const { decline } = AGING_CURVES[seed.position];
  const pastPrime = Math.max(0, seed.age - decline);
  const ovrInfluence = 0.22 * (overall - 72);

  const out: Partial<Record<(typeof PHYSICAL_ATTRIBUTES)[number], number>> = {};
  for (const attr of PHYSICAL_ATTRIBUTES) {
    if (attr === "jumping" && !JUMPING_POSITIONS.has(seed.position)) continue;
    const ageHit =
      attr === "strength" ? -0.3 * pastPrime : -0.7 * pastPrime; // legs go before power
    out[attr] = clamp(r(bases[attr] + ovrInfluence + ageHit + rng.gauss(0, 4.5)), 28, 99);
  }
  return out;
}

function skillsOf(
  position: Position,
  overall: number,
  rng: Rng,
): Record<string, number> {
  const keys = POSITION_ATTRIBUTE_KEYS[position];
  const out: Record<string, number> = {};
  if (keys.length === 0) return out;

  const strength = rng.pick(keys);
  const weakness = rng.pick(keys);
  for (const k of keys) {
    let v = overall + rng.gauss(0, 4.5);
    if (k === strength) v += 6;
    if (k === weakness) v -= 5;
    out[k] = clamp(r(v), 30, 99);
  }
  return out;
}

function schemeTagsFor(
  position: Position,
  attrs: Record<string, number>,
  rng: Rng,
): string[] {
  const a = (k: string): number => attrs[k] ?? 0;
  switch (position) {
    case "QB":
      if (a("speed") >= 85) return ["rpo", "play_action"];
      if (a("throw_power") >= 90) return ["vertical", "play_action"];
      return ["west_coast"];
    case "RB":
      return a("break_tackle") >= 85 || a("strength") >= 80
        ? ["power_run", "gap_scheme"]
        : ["outside_zone", "zone_run"];
    case "WR":
      if (a("speed") >= 93) return ["vertical", "spread"];
      if (a("route_running_short") >= 82) return ["west_coast", "spread"];
      return ["west_coast"];
    case "TE":
      return a("run_block") >= 74 ? ["inline", "play_action"] : ["move_te", "spread"];
    case "OT":
    case "OG":
    case "C":
      return a("agility") >= 68 ? ["outside_zone"] : ["gap_scheme", "power_run"];
    case "EDGE":
      return a("finesse_moves") >= a("power_moves")
        ? ["wide_9", "attack"]
        : ["two_gap", "contain"];
    case "DT":
      return a("power_moves") >= 78 ? ["one_gap", "penetrate"] : ["two_gap", "nose"];
    case "ILB":
    case "OLB":
      if (a("man_coverage") >= 76) return ["nickel", "cover_man"];
      return rng.unit() < 0.5 ? ["base_4_3", "cover_2"] : ["base_3_4", "cover_3"];
    case "CB":
      return a("press") >= 80 ? ["man_press", "cover_1"] : ["zone", "cover_3"];
    case "S":
      return a("man_coverage") >= 78 ? ["single_high", "robber"] : ["split_safety", "cover_2"];
    default:
      return [];
  }
}

/** Build one schema-valid player (without an `id`) from a seed. */
export function buildPlayer(seed: PlayerSeed, opts: GenerateOptions = {}): Omit<Player, "id"> {
  const rng = new Rng(`${opts.seed ?? "v0"}::${seed.key}`);

  const tier = tierOf(seed, rng);
  const overall = overallOf(seed, tier, rng);

  const { dev, decline } = AGING_CURVES[seed.position];
  const pastPrime = Math.max(0, seed.age - decline);

  const attributes: Record<string, number> = {
    ...physicalsOf(seed, overall, rng),
    ...skillsOf(seed.position, overall, rng),
    awareness: clamp(
      r(overall - 8 + 1.6 * clamp(seed.yearsExp, 0, 9) + rng.gauss(0, 4)),
      30,
      99,
    ),
    injury: clamp(r(83 - 0.6 * pastPrime + rng.gauss(0, 7)), 40, 99),
    stamina: clamp(r(82 + rng.gauss(0, 6)), 50, 99),
    toughness: clamp(r(80 + rng.gauss(0, 7)), 45, 99),
  };

  return {
    name: seed.name,
    position: seed.position,
    age: seed.age,
    nfl_team: seed.team,
    years_pro: Math.max(0, seed.yearsExp),
    overall,
    attributes,
    scheme_tags: schemeTagsFor(seed.position, attributes, rng),
    dev_age_threshold: dev,
    decline_age_threshold: decline,
    injury_history: [],
    contract: null,
    free_agent: true, // the whole league is the fantasy-draft pool
    injury_status: null,
    retired: false,
  };
}
