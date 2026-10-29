import type { Position } from "@/domain";

/**
 * A player type, defined only by what it changes in his attributes.
 *
 * `boost` raises attributes the type is good at, `cost` lowers the ones it
 * gives up, both in rating points at full strength. Every attribute named
 * here is one the engine reads (rating-effect families, synergy skills, the
 * quarterback-mobility and kicker-leg terms); `archetypes.test.ts` fails
 * if a type touches none. Overall is unchanged by design: a pocket passer and
 * a mobile quarterback of the same overall are different players, not
 * different grades.
 */
export interface Archetype {
  id: string;
  position: Position;
  label: string;
  boost: Readonly<Record<string, number>>;
  cost: Readonly<Record<string, number>>;
}

const A = (id: string, position: Position, label: string, boost: Record<string, number>, cost: Record<string, number>): Archetype => ({
  id, position, label, boost, cost,
});

export const ARCHETYPES: readonly Archetype[] = [
  A("qb_pocket", "QB", "Pocket passer", { throw_accuracy_short: 6, throw_accuracy_mid: 6, awareness: 4 }, { speed: 10, scrambling: 14, agility: 6 }),
  A("qb_mobile", "QB", "Dual-threat", { speed: 12, scrambling: 16, agility: 8, acceleration: 6, break_sack: 8 }, { throw_accuracy_mid: 5, throw_accuracy_deep: 4 }),
  A("qb_gunslinger", "QB", "Gunslinger", { throw_power: 10, throw_accuracy_deep: 7 }, { awareness: 6, throw_accuracy_short: 3 }),
  A("rb_power", "RB", "Power back", { break_tackle: 8, stiff_arm: 6, strength: 8 }, { speed: 6, acceleration: 6, juke_move: 6 }),
  A("rb_speed", "RB", "Speed back", { speed: 8, acceleration: 8, agility: 6, juke_move: 5 }, { break_tackle: 7, strength: 8 }),
  A("rb_receiving", "RB", "Receiving back", { catching: 12, yac: 6 }, { break_tackle: 5, carrying: 6 }),
  A("wr_deep", "WR", "Deep threat", { speed: 7, acceleration: 6, route_running_deep: 7 }, { catch_in_traffic: 6, route_running_short: 5 }),
  A("wr_possession", "WR", "Possession receiver", { catching: 6, route_running_short: 7, route_running_mid: 6, catch_in_traffic: 6 }, { speed: 6, route_running_deep: 5 }),
  A("wr_yac", "WR", "After-catch weapon", { yac: 8, break_tackle: 8, agility: 6 }, { route_running_deep: 5, catching: 3 }),
  A("te_receiver", "TE", "Move tight end", { catching: 6, route_running_mid: 7, yac: 5 }, { run_block: 12, pass_block: 8 }),
  A("te_blocker", "TE", "In-line tight end", { run_block: 14, pass_block: 10 }, { catching: 6, route_running_mid: 7 }),
  A("ot_pass", "OT", "Pass protector", { pass_block: 4, pass_block_finesse: 6, anchor: 3 }, { run_block: 6, pass_block_power: 2 }),
  A("ot_run", "OT", "Road grader", { run_block: 6, pass_block_power: 4, anchor: 4 }, { pass_block_finesse: 6, pass_block: 2 }),
  A("og_pass", "OG", "Pass-set guard", { pass_block: 4, pass_block_finesse: 5, line_calls: 3 }, { run_block: 6 }),
  A("og_run", "OG", "Mauler", { run_block: 6, pass_block_power: 4, anchor: 4 }, { pass_block_finesse: 6, pass_block: 2 }),
  A("c_calls", "C", "Field general", { line_calls: 8, pass_block: 3, awareness: 4 }, { run_block: 4 }),
  A("c_anchor", "C", "Anchor", { run_block: 5, anchor: 6, pass_block_power: 4 }, { line_calls: 5, pass_block_finesse: 4 }),
  A("edge_speed", "EDGE", "Speed rusher", { finesse_moves: 9, speed: 7, acceleration: 7 }, { power_moves: 7, run_defense: 6, block_shedding: 4 }),
  A("edge_power", "EDGE", "Power rusher", { power_moves: 9, block_shedding: 6, run_defense: 6 }, { finesse_moves: 8, speed: 5, acceleration: 5 }),
  A("dt_rusher", "DT", "Interior rusher", { finesse_moves: 8, power_moves: 6, play_recognition: 4 }, { run_defense: 8, block_shedding: 4 }),
  A("dt_stuffer", "DT", "Run stuffer", { run_defense: 9, block_shedding: 7, tackle: 4 }, { finesse_moves: 8, power_moves: 5 }),
  A("ilb_cover", "ILB", "Coverage linebacker", { zone_coverage: 8, man_coverage: 7, speed: 5 }, { tackle: 6, block_shedding: 6, hit_power: 5 }),
  A("ilb_thumper", "ILB", "Run-stopping linebacker", { tackle: 7, block_shedding: 7, pursuit: 5 }, { zone_coverage: 7, man_coverage: 6 }),
  A("cb_man", "CB", "Man-press corner", { man_coverage: 6, press: 9 }, { zone_coverage: 5, play_recognition: 3 }),
  A("cb_zone", "CB", "Zone corner", { zone_coverage: 6, play_recognition: 6 }, { press: 8, man_coverage: 3 }),
  A("s_box", "S", "Box safety", { tackle: 7, hit_power: 8, pursuit: 4 }, { zone_coverage: 6, man_coverage: 5 }),
  A("s_post", "S", "Center fielder", { zone_coverage: 6, play_recognition: 6, speed: 4 }, { tackle: 6, hit_power: 7 }),
  A("k_power", "K", "Big-leg kicker", { kick_power: 12 }, { kick_accuracy: 6 }),
  A("k_accurate", "K", "Accurate kicker", { kick_accuracy: 8 }, { kick_power: 8 }),
  A("p_hang", "P", "Directional punter", { hang_time: 8, coffin_corner: 8, punt_accuracy: 6 }, { punt_power: 8 }),
  A("p_boomer", "P", "Boomer", { punt_power: 12 }, { punt_accuracy: 6, coffin_corner: 6 }),
];

export const ARCHETYPES_BY_POSITION: Readonly<Record<string, readonly Archetype[]>> = (() => {
  const m: Record<string, Archetype[]> = {};
  for (const a of ARCHETYPES) (m[a.position] ??= []).push(a);
  return m;
})();

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
export const archetypeById = (id: string | undefined): Archetype | undefined => (id ? BY_ID.get(id) : undefined);

/** Apply a type to a set of attributes, in place, at `strength` (1 = the table's numbers). */
export function applyArchetype(attributes: Record<string, number>, a: Archetype, strength: number): void {
  const bump = (k: string, d: number) => {
    const v = attributes[k];
    if (v === undefined) return;
    attributes[k] = Math.max(20, Math.min(99, Math.round(v + d * strength)));
  };
  for (const [k, d] of Object.entries(a.boost)) bump(k, d);
  for (const [k, d] of Object.entries(a.cost)) bump(k, -d);
}
