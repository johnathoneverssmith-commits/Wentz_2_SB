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

import { loadDerivedFitBaseline } from "./loaders.js";
import { onReferencePoolChange, roster, teamList } from "./roster.js";
import { effectiveSchemeTags, type TaggablePlayer } from "./scheme-tags.js";
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

export const OFF_SLOTS = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT"] as const;
export const DEF_SLOTS = ["EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2"] as const;
const offUnit = (o: Lineupish): Tags => OFF_SLOTS.map((s) => o[s]?.scheme_tags);
const defUnit = (d: Lineupish): Tags => DEF_SLOTS.map((s) => d[s]?.scheme_tags);

interface Baseline {
  off: Record<OffScheme, number>;
  def: Record<DefScheme, number>;
}
let _baseline: Baseline | null = null;
onReferencePoolChange(() => {
  _baseline = null;
  _slot = null;
});

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

// ---- derived mode (Staff.schemeFit = "derived") -----------------------------
//
// Each starter contributes the tags he has, else tags derived from his
// attributes. A starter is judged against the league's expectation *for that
// kind of tag at his slot*: authored tags against the authored baseline,
// derived tags against the baseline of the same derivation over the same 32
// reference depth charts. Without that, a unit of derived players inherits the
// gap between the two tag vocabularies (measured: man_press -0.06..-0.08
// yd/carry in a fictional league). A unit with no derived player uses the
// legacy baseline, so tagged rosters get the identical shift; a unit with no
// readable tags at all is neutral.

type Slotted = readonly (TaggablePlayer | null | undefined)[];
interface SlotBaseline {
  auth: number[]; // per slot: share of reference starters whose stored tags match
  derived: number[]; // per slot: share whose derived tags match
}
let _slot: { off: Record<OffScheme, SlotBaseline>; def: Record<DefScheme, SlotBaseline> } | null = null;

/**
 * Per-slot expected match shares. `auth`: the 32 reference depth charts' stored
 * tags. `derived`: attribute-derived tags in a default fictional league
 * (`artifacts/models/derived_fit_baseline.json` via `loaders.ts`, 20 leagues x 32 teams; the
 * derivation was tuned on the reference pool's attribute scale, which a
 * fictional league does not share, so each needs its own centring).
 */
/** The per-slot centring tables (exported for the TS/Python parity fixture). */
export function schemeFitSlotBaselines() {
  return slotBaseline();
}

function slotBaseline() {
  if (_slot) return _slot;
  const teams = teamList();
  const derivedTable = loadDerivedFitBaseline() as {
    off: Record<OffScheme, number[]>;
    def: Record<DefScheme, number[]>;
  };
  const auth = (slots: readonly string[], unitOf: (t: string) => Lineupish, want: readonly string[]): number[] => {
    const w = new Set(want);
    return slots.map((slot) => {
      let a = 0, an = 0;
      for (const t of teams) {
        const p = unitOf(t)[slot];
        if (p?.scheme_tags && p.scheme_tags.length > 0) {
          an += 1;
          if (p.scheme_tags.some((x) => w.has(x))) a += 1;
        }
      }
      return an ? a / an : 0;
    });
  };
  const off = {} as Record<OffScheme, SlotBaseline>;
  for (const s of Object.keys(OFF_SCHEME_TAGS) as OffScheme[]) {
    off[s] = { auth: auth(OFF_SLOTS, (t) => roster(t).offense() as Lineupish, OFF_SCHEME_TAGS[s]), derived: derivedTable.off[s] };
  }
  const def = {} as Record<DefScheme, SlotBaseline>;
  for (const s of Object.keys(DEF_SCHEME_TAGS) as DefScheme[]) {
    def[s] = { auth: auth(DEF_SLOTS, (t) => roster(t).defense() as Lineupish, DEF_SCHEME_TAGS[s]), derived: derivedTable.def[s] };
  }
  _slot = { off, def };
  return _slot;
}

/** Fit deviation of a unit (players in slot order), or null if nothing is readable. */
function derivedDeviation(players: Slotted, want: readonly string[], legacyBaseline: number, b: SlotBaseline): number | null {
  const w = new Set(want);
  let fit = 0, n = 0, base = 0, anyDerived = false;
  players.forEach((p, i) => {
    const eff = effectiveSchemeTags(p);
    if (!eff || eff.length === 0) return;
    const stored = !!p!.scheme_tags && p!.scheme_tags.length > 0;
    n += 1;
    if (eff.some((x) => w.has(x))) fit += 1;
    if (!stored) anyDerived = true;
    base += stored ? b.auth[i]! : b.derived[i]!;
  });
  if (n === 0) return null;
  return fit / n - (anyDerived ? base / n : legacyBaseline);
}

/** `offSchemeFitShift` for a `schemeFit: "derived"` staff. `starters` is in `OFF_SLOTS` order. */
export function offSchemeFitShiftDerived(scheme: OffScheme, starters: Slotted): { complete: number; rush: number } {
  if (scheme === NEUTRAL_OFF) return { complete: 0, rush: 0 };
  const dev = derivedDeviation(starters, OFF_SCHEME_TAGS[scheme], schemeFitBaseline().off[scheme], slotBaseline().off[scheme]);
  return dev === null ? { complete: 0, rush: 0 } : { complete: FIT_COMPLETE * dev, rush: FIT_RUSH * dev };
}

/** `defSchemeFitShift` for a `schemeFit: "derived"` staff. `starters` is in `DEF_SLOTS` order. */
export function defSchemeFitShiftDerived(scheme: DefScheme, starters: Slotted): { complete: number; rush: number } {
  if (scheme === NEUTRAL_DEF) return { complete: 0, rush: 0 };
  const dev = derivedDeviation(starters, DEF_SCHEME_TAGS[scheme], schemeFitBaseline().def[scheme], slotBaseline().def[scheme]);
  return dev === null ? { complete: 0, rush: 0 } : { complete: 0 - FIT_COMPLETE * dev, rush: 0 - FIT_RUSH * dev };
}
