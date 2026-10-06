/**
 * The rookie playing-time policy, as pure functions on ratings and ids: no
 * data loading, so the franchise UI's training camp and the engine's roster
 * can both use it (`roster.ts` applies it to a game's depth chart).
 */
import { ROOKIE_MARGIN } from "./gameplan.js";

/** How many of each position start (the lineup the engine fields). */
export const STARTERS_AT: Readonly<Record<string, number>> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, CB: 3, S: 2, K: 1, P: 1,
};

interface Rated {
  id: string;
  overall?: number | undefined;
  years_pro?: number | undefined;
}

/**
 * One position's depth order under the rookie policy: with a positive dial a
 * rookie moves up past the veterans who are no more than a few overall points
 * better than he is (`ROOKIE_MARGIN` at the full dial); with a negative one he
 * drops below the veterans he is within that margin of. A veteran who is
 * clearly better is never passed, so what the policy costs now is bounded.
 */
export function policyOrder<T extends Rated>(list: readonly T[], dial: number): T[] {
  const next = [...list];
  if (!dial) return next;
  const margin = (Math.abs(dial) / 100) * ROOKIE_MARGIN;
  const rookie = (p: Rated): boolean => p.years_pro === 0;
  if (dial > 0) {
    for (let i = 1; i < next.length; i++) {
      if (!rookie(next[i]!)) continue;
      for (let j = i; j > 0; j--) {
        const up = next[j - 1]!;
        if (rookie(up) || (up.overall ?? 0) > (next[j]!.overall ?? 0) + margin) break;
        [next[j - 1], next[j]] = [next[j]!, up];
      }
    }
  } else {
    for (let i = next.length - 2; i >= 0; i--) {
      if (!rookie(next[i]!)) continue;
      for (let j = i; j < next.length - 1; j++) {
        const down = next[j + 1]!;
        if (rookie(down) || (down.overall ?? 0) < (next[j]!.overall ?? 0) - margin) break;
        [next[j + 1], next[j]] = [next[j]!, down];
      }
    }
  }
  return next;
}

/**
 * Which rookies the policy puts on the field, and why (`RookieRole`), for a
 * team's players. `chart` is the GM's own depth order if they set one; the
 * rest follow overall, as the engine's roster does.
 */
export function rookieRoles<T extends Rated & { position: string }>(
  players: readonly T[],
  dial: number,
  chart?: Readonly<Record<string, readonly string[]>>,
): Map<string, "promoted" | "merit" | "benched"> {
  const out = new Map<string, "promoted" | "merit" | "benched">();
  if (!dial) return out;
  const byPos = new Map<string, T[]>();
  for (const p of players) byPos.set(p.position, [...(byPos.get(p.position) ?? []), p]);
  for (const [pos, all] of byPos) {
    const n = STARTERS_AT[pos] ?? 0;
    if (n === 0) continue;
    const named = chart?.[pos] ?? [];
    const base = [...all].sort((a, b) => {
      const ia = named.indexOf(a.id);
      const ib = named.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      return (b.overall ?? 0) - (a.overall ?? 0);
    });
    const before = new Set(base.slice(0, n).map((p) => p.id));
    const after = new Set(policyOrder(base, dial).slice(0, n).map((p) => p.id));
    for (const p of base) {
      if (p.years_pro !== 0) continue;
      const was = before.has(p.id);
      const is = after.has(p.id);
      if (is && !was) out.set(p.id, "promoted");
      else if (is && was) out.set(p.id, "merit");
      else if (was && !is) out.set(p.id, "benched");
    }
  }
  return out;
}

