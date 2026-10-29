import type { DraftProspect, LeagueProfile, Position } from "@/domain";
import { POSITIONS } from "@/domain";
import { MockSimulationService } from "../MockSimulationService.ts";
import { GROUP_OF, type GroupId } from "./dna.ts";
import { GROUPS, bandOf, tendenciesOf, tendencySentence } from "./profile.ts";

const TOP = 12;
const UNIT = 3;
let ref: { top: Partial<Record<Position, number>>; quality: number; stars: number } | null = null;

function measure(c: readonly DraftProspect[]) {
  const top: Partial<Record<Position, number>> = {};
  for (const pos of POSITIONS) {
    const l = c.filter((p) => p.position === pos).map((p) => p.trueOverall).sort((a, b) => b - a).slice(0, TOP);
    if (l.length) top[pos] = l.reduce((a, b) => a + b, 0) / l.length;
  }
  const best = c.map((p) => p.trueOverall).sort((a, b) => b - a);
  return { top, quality: best.slice(0, 64).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(64, best.length)), stars: best.filter((v) => v >= 80).length };
}

/** What an ordinary class looks like: the mean over a dozen classes made with no class character. */
function reference() {
  if (ref) return ref;
  const sim = new MockSimulationService();
  const acc = { top: {} as Partial<Record<Position, number>>, quality: 0, stars: 0 };
  const n = 12;
  for (let i = 0; i < n; i++) {
    const m = measure(sim.generateDraftClass(9000 + i * 17, 2040 + i));
    for (const [k, v] of Object.entries(m.top) as [Position, number][]) acc.top[k] = (acc.top[k] ?? 0) + v / n;
    acc.quality += m.quality / n;
    acc.stars += m.stars / n;
  }
  ref = acc;
  return acc;
}

/**
 * The public scouting read on a draft class, from its actual distribution and
 * in bands only: how the class compares as a whole, what it is deep or thin
 * in, whether it has standout prospects. No era label: a class is not an
 * era, and nothing here is inherited from the opening league. Computed where
 * the true ratings are visible (the server, or a local game) and stored on
 * the league, so a client that cannot see them still shows it.
 */
export function classProfile(c: readonly DraftProspect[], year: number): LeagueProfile {
  const r = reference();
  const m = measure(c);
  const acc: Record<string, number[]> = {};
  for (const [pos, v] of Object.entries(m.top) as [Position, number][]) {
    const base = r.top[pos];
    if (base !== undefined) (acc[GROUP_OF[pos]] ??= []).push((v - base) / UNIT);
  }
  const g = Object.fromEntries(GROUPS.map((id) => [id, acc[id] ? acc[id]!.reduce((a, b) => a + b, 0) / acc[id]!.length : 0])) as Record<GroupId, number>;
  const q = (m.quality - r.quality) / UNIT;
  const overall = q >= 0.5 ? "a strong class" : q <= -0.5 ? "a thin class" : "a fairly ordinary class";
  const stars = m.stars - r.stars;
  const standouts = stars >= 4 ? " with an unusual number of standout prospects" : stars <= -4 ? " with few standouts" : "";
  const lean = tendencySentence(g, `The ${year} class`);
  return {
    eraId: null,
    title: `${year} Draft Class`,
    blurb: `The ${year} draft is ${overall}${standouts}. ${lean}`,
    tendencies: { ...tendenciesOf(g), overall: bandOf(q) },
  };
}
