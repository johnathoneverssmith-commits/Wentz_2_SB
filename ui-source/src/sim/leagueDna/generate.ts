import type { Player, Position } from "@/domain";
import { POSITIONS } from "@/domain";
import { ATTRIBUTE_FIT } from "../attributeFit.ts";
import { AGE_BY_POSITION } from "../draft-history.ts";
import { Rng } from "../rng.ts";
import { ROOKIE_DECLINE_BACKOFF } from "../careerShape.ts";
import { RETIREMENT_AGE, ROSTER_TEMPLATE } from "../roster-template.ts";
import { ARCHETYPES_BY_POSITION, applyArchetype, type Archetype } from "./archetypes.ts";
import { type LeagueDna, REFERENCE } from "./dna.ts";
import { UniqueNames, composeName } from "./identity.ts";
import { stream } from "./streams.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Strength and weakness are drawn from these only: not durability, not stamina. */
const NOT_A_SPECIALTY = new Set(["injury", "stamina", "toughness"]);

/** The tail of the rating curve above one sd, as extra sds. Calibrated so a neutral league has the reference number of 85+ players. */
export const TAIL_K = 0.45;

/** Analysis only: scales on how much a type and a personal strength/weakness move attributes (1 = as shipped). */
export const ATTRIBUTE_TUNING = { archetype: 1, specialty: 1 };

export function playersAt(pos: Position, dna: LeagueDna): number {
  const slot = ROSTER_TEMPLATE.find((r) => r.pos === pos);
  if (!slot || slot.count === 0) return 0;
  return Math.ceil(slot.count * 32 * dna.positions[pos].depth);
}

export function pickArchetype(pos: Position, weights: Record<string, number>, rng: Rng): Archetype | undefined {
  const list = ARCHETYPES_BY_POSITION[pos];
  if (!list || list.length === 0) return undefined;
  return rng.weighted(list, list.map((a) => weights[a.id] ?? 1));
}

/**
 * The attributes of a player of this overall and type: the position's fitted
 * relationship to overall (`attributeFit.ts`), his type's offsets, and one
 * strength and one weakness of his own.
 */
export function attributesFor(pos: Position, overall: number, arch: Archetype | undefined, strength: number, rng: Rng): Record<string, number> {
  const fit = ATTRIBUTE_FIT[pos] ?? {};
  const out: Record<string, number> = {};
  for (const [key, [a, b, sd]] of Object.entries(fit)) {
    out[key] = clamp(Math.round(a + b * overall + rng.normal() * sd * 1.15), 20, 99);
  }
  if (arch && ATTRIBUTE_TUNING.archetype > 0) applyArchetype(out, arch, strength * ATTRIBUTE_TUNING.archetype);
  const keys = Object.keys(out).filter((k) => !NOT_A_SPECIALTY.has(k));
  if (keys.length > 3) {
    const up = rng.pick(keys);
    let down = rng.pick(keys);
    if (down === up) down = keys[(keys.indexOf(up) + 1) % keys.length]!;
    const k = ATTRIBUTE_TUNING.specialty;
    out[up] = clamp(out[up]! + Math.round(rng.int(3, 6) * k), 20, 99);
    out[down] = clamp(out[down]! - Math.round(rng.int(3, 6) * k), 20, 99);
  }
  return out;
}

export function overallFromZ(pos: Position, z: number, dna: LeagueDna): number {
  const ref = REFERENCE[pos];
  const p = dna.positions[pos];
  const sd = ref.sd * p.spread;
  let v = ref.mean + dna.level + p.shift + sd * z;
  if (z > 1) v += sd * TAIL_K * p.tail * dna.tail * (z - 1) ** 1.5;
  return clamp(Math.round(v), 42, 99);
}

/**
 * How far above his current overall a player's development can still take
 * him, from his age and the league's upside. The same shape the rookie
 * ceiling uses (`rules.ts`): more room the younger he is, none once he has
 * passed his developing years.
 */
export function developmentRoom(age: number, devAge: number, upside: number, rng: Rng): number {
  if (age >= devAge) return 0;
  return clamp(Math.round((devAge - age) * 1.9 * upside + rng.normal(0, 2.2)), 0, 18);
}

export function idFor(dna: LeagueDna, pos: Position, idx: number): string {
  return `p_g${dna.version}_${dna.dnaSeed.toString(16).padStart(8, "0").slice(0, 6)}_${pos}${String(idx + 1).padStart(3, "0")}`;
}

function makePlayer(dna: LeagueDna, pos: Position, idx: number, names: UniqueNames): Player {
  const r = stream(dna.dnaSeed, "player", pos, idx);
  const ref = REFERENCE[pos];
  const posDna = dna.positions[pos];
  const z = r.normal();
  const overall = overallFromZ(pos, z, dna);
  const age = clamp(Math.round(r.normal(ref.age + dna.ageTilt, ref.ageSd)), 21, pos === "K" || pos === "P" ? 41 : 37);
  // the same career frame a drafted rookie gets (`rules.ts`), so aging treats every player alike
  const entryAge = Math.round(AGE_BY_POSITION[pos].mean) + r.int(-1, 1);
  const yearsPro = Math.max(1, age - entryAge);
  const dev = entryAge + 4;
  const decline = Math.max(entryAge + 7, RETIREMENT_AGE[pos] - r.int(...ROOKIE_DECLINE_BACKOFF));
  const arch = pickArchetype(pos, posDna.archetypes, r);
  const strength = 0.75 + r.float(0, 0.5);
  const attributes = attributesFor(pos, overall, arch, strength, r);
  const room = developmentRoom(age, dev, dna.upside, r);
  const name = names.take((attempt) => composeName(stream(dna.dnaSeed, "name", pos, idx, attempt)));
  return {
    id: idFor(dna, pos, idx),
    name,
    position: pos,
    age,
    nfl_team: "FA",
    years_pro: yearsPro,
    overall,
    potential: Math.min(99, overall + room),
    ...(arch ? { archetype: arch.id } : {}),
    attributes,
    scheme_tags: [],
    dev_age_threshold: dev,
    decline_age_threshold: Math.max(dev + 1, decline),
    injury_history: [],
    contract: null,
    free_agent: true,
    injury_status: null,
    retired: false,
    retirement_status: "active",
    season_stats: { gamesPlayed: 0 },
  };
}

/**
 * The league's opening players, from its DNA alone. Every player is a pure
 * function of (dnaSeed, position, index) except the name, which is also
 * checked for uniqueness in a fixed order (positions in `POSITIONS` order,
 * index ascending) against `reserved` — the real names this league must not
 * reuse.
 */
export function generateFictionalPool(dna: LeagueDna, reserved: Iterable<string> = []): Player[] {
  const names = new UniqueNames(reserved);
  const out: Player[] = [];
  for (const pos of POSITIONS) {
    const n = playersAt(pos, dna);
    for (let i = 0; i < n; i++) out.push(makePlayer(dna, pos, i, names));
  }
  return out;
}

/**
 * Deal the pool onto teams, best players first, in a snake whose order is
 * random per position, so no team is handed the league's stars. Players past
 * a team's template stay free agents.
 */
export function dealToTeams(players: Player[], teams: readonly string[], dnaSeed: number): void {
  for (const slot of ROSTER_TEMPLATE) {
    if (slot.count === 0) continue;
    const r = stream(dnaSeed, "deal", slot.pos);
    const pool = players.filter((p) => p.position === slot.pos).sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    for (let round = 0; round < slot.count; round++) {
      const order = r.shuffle([...teams]);
      if (round % 2 === 1) order.reverse();
      order.forEach((team, i) => {
        const p = pool[round * teams.length + i];
        if (p) {
          p.nfl_team = team;
          p.free_agent = false;
        }
      });
    }
  }
}
