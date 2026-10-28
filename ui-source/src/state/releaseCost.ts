/**
 * The cost of releasing a player, on its own so the trade valuation (`sim/MockSimulationService.ts`) and the roster rules
 * (`seed.ts`) share one function without importing each other.
 */
import type { Player } from "@/domain";

/**
 * What releasing a player costs against this year's cap.
 *
 * The lesser of twenty percent of the annual value for each year left, or
 * eighty percent of one year. The cap stops a long deal from being ruinous to
 * escape while still making it expensive — releasing somebody in year one of
 * five should hurt, but not more than paying him.
 */
export function releasePenalty(p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  const annual = c.cap_hit_by_year[0] ?? 0;
  // Free Agency + Contracts optimization pass (contracts.release_penalty).
  const byYears = annual * 0.22 * c.years_remaining;
  const capped = annual * 0.75;
  const base = Math.min(byYears, capped);
  // exploit audit (contracts §3, "restructure then release"): a restructure
  // converts base salary into bonus money prorated across the *later* years
  // (`prorated_per_year`) — this formula otherwise only looks at this year's
  // (now-shrunk) hit, so restructuring a contract down and releasing him
  // right after made the deferred money vanish instead of ever coming due.
  // `extendContract` already carries this money forward through an
  // extension; releasing has to accelerate the same remaining amount onto
  // the cap now, the way a real signing bonus's unamortized proration does.
  const acceleratedProration = (c.prorated_per_year ?? 0) * c.years_remaining;
  return Math.round(Math.max(base, acceleratedProration) * 10) / 10;
}
