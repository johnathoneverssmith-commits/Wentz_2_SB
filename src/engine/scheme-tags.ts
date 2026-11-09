/**
 * Derived scheme tags — what a player's attributes say about the schemes he
 * suits, for a player who carries no `scheme_tags` of his own.
 *
 * Rookies, a Seeded-League-DNA league's whole player pool, signed free agents
 * and reconciliation fill all have `scheme_tags = []`. The legacy fit counted
 * such a unit as "fits nothing", so every specialised coordinator scheme was
 * charged for a mismatch nobody could have avoided (docs/decisions.md ->
 * Phase 0 scheme fit). With `Staff.schemeFit = "derived"` the fit reads
 * `effectiveSchemeTags` instead: stored tags when there are any, else these.
 *
 * Same thresholds as the heuristic that tags the generated pool
 * (`src/model/ratings.ts` `schemeTagsFor`), except the two linebacker
 * positions, which used a coin flip there; here they are decided by their own
 * coverage vs run-fit attributes so the answer is a pure function of the
 * player. Mirrored by `analysis/engine/scheme_tags.py` and
 * `ui-source/src/state/schemeTags.ts`; keep the three identical.
 */

export interface TaggablePlayer {
  position: string;
  attributes: Readonly<Record<string, number>>;
  scheme_tags?: readonly string[] | undefined;
}

/** Tags implied by position + attributes. Empty for K/P and unknown positions. */
export function derivedSchemeTags(p: Pick<TaggablePlayer, "position" | "attributes">): string[] {
  const a = (k: string): number => p.attributes[k] ?? 0;
  switch (p.position) {
    case "QB":
      if (a("speed") >= 85) return ["rpo", "play_action"];
      if (a("throw_power") >= 90) return ["vertical", "play_action"];
      return ["west_coast"];
    case "RB":
      return a("break_tackle") >= 85 || a("strength") >= 80
        ? ["power_run", "gap_scheme"]
        : ["outside_zone", "zone_run"];
    case "WR":
      if (a("speed") >= 93) return ["vertical", "spread"];
      if (a("route_running_short") >= 82) return ["west_coast", "spread"];
      return ["west_coast"];
    case "TE":
      return a("run_block") >= 74 ? ["inline", "play_action"] : ["move_te", "spread"];
    case "OT":
    case "OG":
    case "C":
      return a("agility") >= 68 ? ["outside_zone"] : ["gap_scheme", "power_run"];
    case "EDGE":
      return a("finesse_moves") >= a("power_moves") ? ["wide_9", "attack"] : ["two_gap", "contain"];
    case "DT":
      return a("power_moves") >= 78 ? ["one_gap", "penetrate"] : ["two_gap", "nose"];
    case "ILB":
    case "OLB":
      if (a("man_coverage") >= 76) return ["nickel", "cover_man"];
      return a("zone_coverage") >= a("block_shedding")
        ? ["base_4_3", "cover_2"]
        : ["base_3_4", "cover_3"];
    case "CB":
      return a("press") >= 80 ? ["man_press", "cover_1"] : ["zone", "cover_3"];
    case "S":
      return a("man_coverage") >= 78 ? ["single_high", "robber"] : ["split_safety", "cover_2"];
    default:
      return [];
  }
}

/** Stored tags when the player has any, else the derived ones. */
export function effectiveSchemeTags(p: TaggablePlayer | null | undefined): readonly string[] | undefined {
  if (!p) return undefined;
  if (p.scheme_tags && p.scheme_tags.length > 0) return p.scheme_tags;
  return derivedSchemeTags(p);
}
