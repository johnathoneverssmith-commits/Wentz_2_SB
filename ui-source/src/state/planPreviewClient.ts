import type { PlanPreviewAnswer } from "./planPreview.ts";

/**
 * Ask for a preview: the league server online, the engine adapter in
 * single-player. Null when there is no game to measure against; throws
 * with a message a screen can show when the preview couldn't be run.
 */
export async function requestPlanPreview(plan: import("../../../src/engine/gameplan.js").GamePlan): Promise<PlanPreviewAnswer | null> {
  const { onlineSession } = await import("./online.ts");
  const online = onlineSession();
  if (online) {
    const expected = online.version;
    const preview = (await online.client.previewPlan(online.leagueId, plan)).preview;
    if (preview.snapshot !== expected) throw new Error("The league changed. Refresh its view before retrying the projection.");
    return preview;
  }
  const [{ useStore }, { HybridSimulationService }] = await Promise.all([import("./store.ts"), import("../sim/HybridSimulationService.ts")]);
  return new HybridSimulationService().previewPlan(useStore.getState(), plan);
}
