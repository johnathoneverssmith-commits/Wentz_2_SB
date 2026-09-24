import type { LeagueConfig } from "@/domain";

/**
 * Talent impact — how hard the players' ratings swing a game.
 *
 * The engine is validated at 1.0: rating gaps move games exactly as much as
 * real NFL rating gaps do, so a much better team wins about two times in
 * three. A franchise game is more fun when the roster you build decides more
 * than that, so a league can turn it up. It multiplies every shift that comes
 * from the players (the rating families, team strength and synergy) and
 * nothing else — home field and coaching keep their fitted size — so scoring
 * levels barely move while the better team wins more often and by more.
 *
 * It applies to everyone equally. Nobody gets an edge; every roster decision
 * — a GM's, and a CPU's — simply matters more.
 *
 * Measured on the 32 reference rosters (`analysis/33_synergy.ts --talent`),
 * against a real NFL favourite rate of ~67% and margin sd 14.3:
 *
 * | setting | scale | favourite wins | margin sd | points / team |
 * |---|---:|---:|---:|---:|
 * | Realistic | 1.0 | 67.2% | 15.1 | 20.4 |
 * | Amplified | 1.5 | 72.1% | 17.9 | 20.1 |
 * | Extreme   | 2.0 | 78.5% | 21.0 | 20.2 |
 *
 * Past 2.0 it mostly adds blowouts (2.5: 80.1%, margin sd 24.2).
 */
export type TalentImpact = NonNullable<LeagueConfig["talentImpact"]>;

export const TALENT_SCALE: Record<TalentImpact, number> = {
  realistic: 1,
  amplified: 1.5,
  extreme: 2,
};

export const TALENT_IMPACT_LABEL: Record<TalentImpact, string> = {
  realistic: "Realistic",
  amplified: "Amplified",
  extreme: "Extreme",
};

export const TALENT_IMPACT_HINT: Record<TalentImpact, string> = {
  realistic: "Rating gaps move games exactly as much as real NFL ones — the favourite wins about two in three.",
  amplified: "Better rosters win more often and by more (favourite ~72%). Every roster move matters more.",
  extreme: "Talent dominates (favourite ~79%). Build well and you win; build badly and you get blown out.",
};

export function talentScaleOf(config: Pick<LeagueConfig, "talentImpact">): number {
  return TALENT_SCALE[config.talentImpact ?? "realistic"];
}
