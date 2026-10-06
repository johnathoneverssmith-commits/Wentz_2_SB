import type { LeagueState } from "@/domain";

/** A plan preview's answer (`src/engine/plan-preview.ts`), with the game it was measured on. */
export interface PlanPreviewAnswer {
  standard: number;
  withPlan: number;
  marginDelta: number;
  plusMinus: number;
  tooClose: boolean;
  games: number;
  opponent: string;
  /** "Preseason Week 2", "Week 1" */
  game: string;
}

/**
 * The game a preseason preview is measured on: this GM's next preseason game
 * they have not watched, or, with the preseason watched, Week 1.
 */
export function previewOpponent(
  state: Pick<LeagueState, "schedule">,
  team: string,
  watchedPre: number,
): { opponent: string; home: boolean; phase: "PRE" | "REG"; week: number; label: string } | null {
  const mine = (g: { homeTeam: string; awayTeam: string }) => g.homeTeam === team || g.awayTeam === team;
  const pick =
    state.schedule.filter((g) => g.phase === "PRE" && g.week > watchedPre && mine(g)).sort((a, b) => a.week - b.week)[0] ??
    state.schedule.filter((g) => g.phase === "REG" && mine(g)).sort((a, b) => a.week - b.week)[0];
  if (!pick) return null;
  const home = pick.homeTeam === team;
  const phase = pick.phase as "PRE" | "REG";
  return {
    opponent: home ? pick.awayTeam : pick.homeTeam,
    home,
    phase,
    week: pick.week,
    label: phase === "PRE" ? `Preseason Week ${pick.week}` : `Week ${pick.week}`,
  };
}

/**
 * Ask for a preview: the league server online, the engine adapter in
 * single-player. Null when there is no game to measure against; throws
 * with a message a screen can show when the preview couldn't be run.
 */
export async function requestPlanPreview(plan: import("../../../src/engine/gameplan.js").GamePlan): Promise<PlanPreviewAnswer | null> {
  const { onlineSession } = await import("./online.ts");
  const online = onlineSession();
  if (online) return (await online.client.previewPlan(online.leagueId, plan)).preview;
  const [{ useStore }, { HybridSimulationService }] = await Promise.all([import("./store.ts"), import("../sim/HybridSimulationService.ts")]);
  return new HybridSimulationService().previewPlan(useStore.getState(), plan);
}
