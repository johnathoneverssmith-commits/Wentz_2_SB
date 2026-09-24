import type { LeagueState, Position } from "@/domain";
import { POSITIONS } from "@/domain";
import type { DraftClassTilt } from "@/sim/MockSimulationService";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";

/**
 * Keeps each position's talent where the league started it.
 *
 * Draft classes come off one position mix and one rookie curve, but
 * positions age and wash out at different rates, so over a decade some drift:
 * edge rushers and safeties lost four to five points of starter quality in
 * ten seasons while quarterbacks and tackles held. Real drafts respond to
 * scarcity — a thin position gets more attention and its best prospects go
 * higher. This does the same: a position whose starters have slipped below
 * the league's own baseline gets more prospects in the class and slightly
 * better ones, and one running above it gets fewer and weaker ones. The nudge is capped so a
 * class still looks like a draft class.
 *
 * The baseline is the league's own starters the first time a class is made,
 * saved so later seasons measure against it.
 */
export function draftClassTilt(s: LeagueState): DraftClassTilt {
  const now = starterMeans(s);
  s.positionBaseline ??= now;
  const tilt: DraftClassTilt = {};
  for (const pos of POSITIONS) {
    const base = s.positionBaseline[pos];
    const cur = now[pos];
    if (base === undefined || cur === undefined) continue;
    const gap = base - cur; // positive = the position has slipped
    // symmetric: a position running hot is cooled as firmly as a thin one is
    // refilled. The first cut only pushed up (to +4, down to -2) and gently,
    // and a decade still moved safeties -3 while quarterbacks and kickers
    // inflated +3.5 and +4.
    tilt[pos] = {
      supply: Math.min(1.8, Math.max(0.6, 1 + 0.12 * gap)),
      quality: Math.round(Math.min(5, Math.max(-5, gap))),
    };
  }
  return tilt;
}

/** Mean overall of each position's starters across the league. */
export function starterMeans(s: LeagueState): Partial<Record<Position, number>> {
  const byTeamPos = new Map<string, number[]>();
  for (const p of Object.values(s.players)) {
    if (p.retired || p.free_agent || !s.teams[p.nfl_team]) continue;
    const k = `${p.nfl_team}|${p.position}`;
    const l = byTeamPos.get(k);
    if (l) l.push(p.overall);
    else byTeamPos.set(k, [p.overall]);
  }
  const out: Partial<Record<Position, number>> = {};
  for (const { pos, starters } of ROSTER_TEMPLATE) {
    if (starters === 0) continue;
    const vals: number[] = [];
    for (const team of Object.keys(s.teams)) {
      const l = (byTeamPos.get(`${team}|${pos}`) ?? []).sort((a, b) => b - a);
      vals.push(...l.slice(0, starters));
    }
    if (vals.length) out[pos] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}

/**
 * The same balance, applied to development.
 *
 * Draft supply can refill a thin position but cannot cool a hot one: a
 * decade of runs still lifted starting quarterbacks ~4 points and kickers ~4
 * while the draft balancer cut both their classes, because the drift came
 * from how long those positions develop and how late they decline. So a
 * position whose starters run above the league's baseline grows a little
 * slower and declines a little faster in camp, and one running below does
 * the reverse — a gentle restoring force, at most ±40% of a year's move,
 * never a change of direction.
 *
 * Returns the multiplier for a player's development at `position`.
 */
export function agingBalance(s: LeagueState): (position: Position, delta: number) => number {
  const base = s.positionBaseline;
  if (!base) return (_p, d) => d;
  const now = starterMeans(s);
  return (position, delta) => {
    const b = base[position];
    const c = now[position];
    if (delta === 0 || b === undefined || c === undefined) return delta;
    const hot = c - b; // positive = running above where the league began
    const m = Math.min(1.4, Math.max(0.6, 1 - 0.1 * hot));
    const scaled = delta > 0 ? delta * m : delta * (2 - m);
    const r = Math.round(scaled);
    return r === 0 ? Math.sign(delta) : r;
  };
}
