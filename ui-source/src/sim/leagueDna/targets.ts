import type { Position } from "@/domain";
import { neutralDna } from "./dna.ts";
import { TEAMS } from "@/data/teams";
import { ROSTER_TEMPLATE } from "../roster-template.ts";
import { dealToTeams, generateFictionalPool } from "./generate.ts";
import { topMeans } from "./profile.ts";

let cached: Partial<Record<Position, number>> | null = null;

/**
 * The long-run talent a position is steered towards in a DNA league: the
 * mean of its starters in a league with no character, averaged over a few
 * fixed pools so it does not depend on any one draw. A constant of the
 * generator version, not of any league, which is what lets a quarterback-rich
 * opening league drift back towards ordinary rather than be held there.
 */
export function neutralTop(): Partial<Record<Position, number>> {
  if (cached) return cached;
  const sums: Partial<Record<Position, number>> = {};
  const seeds = [101, 202, 303, 404, 505];
  for (const s of seeds) {
    const m = topMeans(generateFictionalPool({ ...neutralDna(), dnaSeed: s }));
    for (const [k, v] of Object.entries(m) as [Position, number][]) sums[k] = (sums[k] ?? 0) + v / seeds.length;
  }
  cached = sums;
  return sums;
}

let cachedStarters: Partial<Record<Position, number>> | null = null;

/**
 * The same long-run target, measured the way `starterMeans` (`draftSupply.ts`)
 * measures a league: each team's best `starters` at a position, averaged. A
 * neutral pool dealt onto the thirty-two teams, a few times over. This is the
 * baseline a DNA league's position balancing steers towards.
 */
export function neutralStarterMeans(): Partial<Record<Position, number>> {
  if (cachedStarters) return cachedStarters;
  const codes = TEAMS.map((t) => t.code);
  const sums: Partial<Record<Position, number>> = {};
  const seeds = [101, 202, 303, 404, 505];
  for (const s of seeds) {
    const pool = generateFictionalPool({ ...neutralDna(), dnaSeed: s });
    dealToTeams(pool, codes, s);
    for (const { pos, starters } of ROSTER_TEMPLATE) {
      if (starters === 0) continue;
      const vals: number[] = [];
      for (const code of codes) {
        vals.push(...pool.filter((p) => p.position === pos && p.nfl_team === code).map((p) => p.overall).sort((a, b) => b - a).slice(0, starters));
      }
      if (vals.length) sums[pos] = (sums[pos] ?? 0) + vals.reduce((a, b) => a + b, 0) / vals.length / seeds.length;
    }
  }
  cachedStarters = sums;
  return sums;
}
