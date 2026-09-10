/**
 * Scheme fit (OQ-3) — the "does this roster suit the coordinator's scheme"
 * bonus, on top of the coordinator's flat `rating` effect in `staff-shift.ts`.
 *
 * A unit's fit = the fraction of its starters whose `scheme_tags` overlap the
 * scheme's tag list. That fraction is *centred* on the league-mean fit for the
 * same scheme (computed once over all 32 depth charts, the `ratings.ts`
 * `offsets()` pattern) so only an unusually good / bad match moves the outcome.
 *
 * `pro_style` (offense) and `multiple` (defense) are treated as
 * scheme-agnostic: they ask less of specific personnel, so they contribute no
 * fit term at all — which is also what keeps `leagueAverageStaff` an exact
 * no-op.
 *
 * Kept behaviourally identical to `analysis/engine/staff_fit.py`.
 */

import { roster, teamList } from "./roster.js";
import {
  DEF_SCHEME_TAGS,
  type DefScheme,
  OFF_SCHEME_TAGS,
  type OffScheme,
  schemeFitFraction,
} from "./staff.js";

const NEUTRAL_OFF: OffScheme = "pro_style";
const NEUTRAL_DEF: DefScheme = "multiple";

// how much a full unit of (fit − league-mean-fit) is worth
const FIT_COMPLETE = 0.08; // M09 COMPLETE logit
const FIT_RUSH = 0.4; // M14 yards/carry

type Tags = readonly (readonly string[] | undefined)[];
type Lineupish = Record<string, { scheme_tags?: readonly string[] } | null | undefined>;

const OFF_SLOTS = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT"] as const;
const DEF_SLOTS = ["EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2"] as const;
const offUnit = (o: Lineupish): Tags => OFF_SLOTS.map((s) => o[s]?.scheme_tags);
const defUnit = (d: Lineupish): Tags => DEF_SLOTS.map((s) => d[s]?.scheme_tags);

interface Baseline {
  off: Record<OffScheme, number>;
  def: Record<DefScheme, number>;
}
let _baseline: Baseline | null = null;

/** League-mean fit fraction per scheme, over all 32 current depth charts. */
export function schemeFitBaseline(): Baseline {
  if (_baseline) return _baseline;
  const teams = teamList();
  const offs = teams.map((t) => offUnit(roster(t).offense()));
  const defs = teams.map((t) => defUnit(roster(t).defense()));
  const off = {} as Record<OffScheme, number>;
  for (const s of Object.keys(OFF_SCHEME_TAGS) as OffScheme[]) {
    off[s] = offs.reduce((a, u) => a + schemeFitFraction(u, OFF_SCHEME_TAGS[s]), 0) / teams.length;
  }
  const def = {} as Record<DefScheme, number>;
  for (const s of Object.keys(DEF_SCHEME_TAGS) as DefScheme[]) {
    def[s] = defs.reduce((a, u) => a + schemeFitFraction(u, DEF_SCHEME_TAGS[s]), 0) / teams.length;
  }
  _baseline = { off, def };
  return _baseline;
}

/** Offense's scheme-fit contribution for its OC scheme. Zero for `pro_style`. */
export function offSchemeFitShift(
  scheme: OffScheme,
  offenseTags: Tags,
): { complete: number; rush: number } {
  if (scheme === NEUTRAL_OFF) return { complete: 0, rush: 0 };
  const dev = schemeFitFraction(offenseTags, OFF_SCHEME_TAGS[scheme]) - schemeFitBaseline().off[scheme];
  return { complete: FIT_COMPLETE * dev, rush: FIT_RUSH * dev };
}

/** Defense's scheme-fit contribution (deltas to the *offense's* shifts). Zero for `multiple`. */
export function defSchemeFitShift(
  scheme: DefScheme,
  defenseTags: Tags,
): { complete: number; rush: number } {
  if (scheme === NEUTRAL_DEF) return { complete: 0, rush: 0 };
  const dev = schemeFitFraction(defenseTags, DEF_SCHEME_TAGS[scheme]) - schemeFitBaseline().def[scheme];
  return { complete: 0 - FIT_COMPLETE * dev, rush: 0 - FIT_RUSH * dev };
}
