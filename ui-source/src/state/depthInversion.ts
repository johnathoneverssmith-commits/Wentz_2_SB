import type { Player, Position } from "@/domain";
import { startersAt } from "./leagueStarters";

/**
 * How far a reserve must out-rate a starter before the chart looks like a
 * mistake rather than a choice. Five points is a veteran, a scheme fit or a
 * hunch; ten is "the wrong end of the list" (a worst-first chart is 20-40).
 */
export const INVERSION_GAP = 10;

export interface DepthInversion {
  position: Position;
  /** The starter being out-rated (the weakest of the offenders). */
  starter: Player;
  /** The best reserve behind him. */
  reserve: Player;
  /** reserve.overall - starter.overall */
  gap: number;
}

/**
 * Does this position's active order look accidentally inverted?
 *
 * `line` is the chart in order (as `depthAt` returns it). Only the first
 * `startersAt(position)` slots start. Players who are out injured are ignored
 * on both sides, since benching one is correct. Nothing here changes the chart;
 * it only describes it.
 */
export function depthInversionAt(position: Position, line: readonly Player[]): DepthInversion | null {
  const n = startersAt(position);
  if (n <= 0) return null;
  const healthy = line.filter((p) => p.injury_status?.status !== "out");
  const starters = healthy.slice(0, n);
  const reserves = healthy.slice(n);
  if (starters.length === 0 || reserves.length === 0) return null;
  const reserve = reserves.reduce((a, b) => (b.overall > a.overall ? b : a));
  const starter = starters.reduce((a, b) => (b.overall < a.overall ? b : a));
  const gap = reserve.overall - starter.overall;
  return gap >= INVERSION_GAP ? { position, starter, reserve, gap } : null;
}
