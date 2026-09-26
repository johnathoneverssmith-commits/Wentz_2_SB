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
  // once a season (this runs at each rollover): bank every position's offset
  // from its baseline for the aging controller's integral term
  if (s.agingIntegralSeason !== s.season) {
    s.agingIntegralSeason = s.season;
    const acc: Partial<Record<Position, number>> = { ...(s.agingIntegral ?? {}) };
    for (const pos of POSITIONS) {
      const b = s.positionBaseline[pos];
      const c = now[pos];
      if (b === undefined || c === undefined) continue;
      acc[pos] = Math.max(-12, Math.min(12, (acc[pos] ?? 0) + (c - b)));
    }
    s.agingIntegral = acc;
  }
  const tilt: DraftClassTilt = {};
  const short = shortage(s);
  for (const pos of POSITIONS) {
    const base = s.positionBaseline[pos];
    const cur = now[pos];
    if (base === undefined || cur === undefined) continue;
    const gap = base - cur; // positive = the position has slipped
    // symmetric: a position running hot is cooled as firmly as a thin one is
    // refilled. The first cut only pushed up (to +4, down to -2) and gently,
    // and a decade still moved safeties -3 while quarterbacks and kickers
    // inflated +3.5 and +4.
    // the integral (banked offsets, `agingIntegral`) steers the class too: a
    // position that has run hot for years gets weaker prospects even when
    // this season's offset is small — quarterbacks sat ~3 points high while
    // a proportional-only tilt called them nearly balanced
    const integral = s.agingIntegral?.[pos] ?? 0;
    tilt[pos] = {
      supply: Math.min(3, Math.max(0.5, (1 + 0.12 * gap) * (short.get(pos) ?? 1))),
      // ±8: tight ends sat at the old ±6 cap for years and still slid
      quality: Math.round(Math.min(8, Math.max(-8, gap - 0.3 * integral))),
    };
  }
  return tilt;
}

/**
 * How short the league is of real players at each position, as a supply
 * multiplier: the roster template's demand across every team, against the
 * real (not invented) players rostered or on the market. Quality alone
 * missed it — a decade in, the class still skimped on inside linebackers
 * and interior linemen while safeties and tight ends went unsigned, and
 * every team's backups at those spots were invented camp bodies.
 */
function shortage(s: LeagueState): Map<string, number> {
  const have = new Map<string, number>();
  for (const p of Object.values(s.players)) {
    if (p.retired || p.id.startsWith("p_depth_") || p.id.startsWith("emg_")) continue;
    if (!p.free_agent && !s.teams[p.nfl_team]) continue;
    if (p.free_agent && p.overall < 60) continue;
    have.set(p.position, (have.get(p.position) ?? 0) + 1);
  }
  const teams = Object.keys(s.teams).length;
  const out = new Map<string, number>();
  for (const { pos, count } of ROSTER_TEMPLATE) {
    if (count === 0) continue;
    const ratio = (count * teams * 1.15) / Math.max(1, have.get(pos) ?? 0);
    // steeper and higher: at a 2x cap inside linebackers still ran short
    out.set(pos, Math.min(3, Math.max(0.7, Math.pow(ratio, 1.5))));
  }
  return out;
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
 * the reverse — a gentle restoring force, at most ±50% of a year's move,
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
    // Proportional and integral. A proportional term alone settles with a
    // standing offset — ten-season runs still left quarterbacks ~3 points
    // high and safeties and tight ends ~2.5 low. The integral term (each
    // season's offset, banked at rollover) keeps pushing until the offset is
    // gone.
    const integral = s.agingIntegral?.[position] ?? 0;
    const m = Math.min(1.7, Math.max(0.3, 1 - 0.2 * hot - 0.08 * integral));
    const scaled = delta > 0 ? delta * m : delta * (2 - m);
    const r = Math.round(scaled);
    return r === 0 ? Math.sign(delta) : r;
  };
}
