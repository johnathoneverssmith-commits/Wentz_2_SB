/**
 * Derived scheme tags — the franchise layer's copy of
 * `src/engine/scheme-tags.ts` (the franchise layer does not import the engine
 * at runtime). Keep the two identical; `schemeTags.test.ts` pins the table.
 */
import type { LeagueConfig, Player } from "@/domain";

export type SchemeFitMode = NonNullable<LeagueConfig["schemeFit"]>;

/** Absent = legacy: a save from before the flag plays exactly as it always did. */
export const schemeFitModeOf = (config: Pick<LeagueConfig, "schemeFit">): SchemeFitMode =>
  config.schemeFit ?? "legacy";

export function derivedSchemeTags(p: Pick<Player, "position" | "attributes">): string[] {
  const a = (k: string): number => (p.attributes as Record<string, number | undefined>)[k] ?? 0;
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
      return a("zone_coverage") >= a("block_shedding") ? ["base_4_3", "cover_2"] : ["base_3_4", "cover_3"];
    case "CB":
      return a("press") >= 80 ? ["man_press", "cover_1"] : ["zone", "cover_3"];
    case "S":
      return a("man_coverage") >= 78 ? ["single_high", "robber"] : ["split_safety", "cover_2"];
    default:
      return [];
  }
}

/** Stored tags when there are any, else the derived ones. */
export const effectiveSchemeTags = (p: Pick<Player, "position" | "attributes" | "scheme_tags">): readonly string[] =>
  p.scheme_tags.length > 0 ? p.scheme_tags : derivedSchemeTags(p);
