import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { useStore } from "./store.ts";
import { openTrainingCamp, runTrainingCamp } from "./trainingCamp.ts";

/**
 * Training camp opens every season, for every team.
 *
 * It used to open once per league: the state was never cleared, so in year
 * two the viewer was told "You already ran camp this season" over last
 * year's results and every CPU team was skipped as already submitted — no
 * team in the league developed through camp again. And locally the CPU camps
 * never ran even in year one: only online's stage entry called them.
 */
describe("training camp across seasons", () => {
  it("gives a new season a fresh camp, with every CPU team trained", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    s.gms[0]!.teamCode = "GB";
    const humans = new Set(["GB"]);

    s.stage = "trainingCamp";
    openTrainingCamp(s, humans);
    runTrainingCamp(s, "GB", { offensiveFocus: "QB", defensiveFocus: "DL", submitted: true });
    const firstYearCpu = Object.keys(s.trainingCamp!.results).filter((c) => c !== "GB").length;
    expect(firstYearCpu, "CPU camps in year one").toBe(Object.keys(s.teams).length - 1);

    // a year later
    s.season += 1;
    openTrainingCamp(s, humans);
    expect(s.trainingCamp!.season).toBe(s.season);
    expect(s.trainingCamp!.plans.GB?.submitted ?? false, "the viewer's camp is open again").toBe(false);
    const secondYearCpu = Object.values(s.trainingCamp!.plans).filter((p) => p.submitted).length;
    expect(secondYearCpu, "every CPU team trained again").toBe(Object.keys(s.teams).length - 1);
  });

  it("runs the CPU camps when a local league enters the stage", async () => {
    await useStore.getState().newLeague(8, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const st = useStore.getState();
    useStore.setState((d) => {
      d.gms[0]!.teamCode = "GB";
      d.stage = "freeAgencySummary";
      fillRosterGaps(d as never);
    });
    st.autoReadyNonViewers();
    useStore.getState().setReady(useStore.getState().viewerGmId, true);
    await useStore.getState().tryAdvance();
    const s = useStore.getState();
    expect(s.stage).toBe("trainingCamp");
    const cpuTrained = Object.values(s.trainingCamp?.plans ?? {}).filter((p) => p.submitted).length;
    expect(cpuTrained, "local CPU teams ran camp as the stage opened").toBe(Object.keys(s.teams).length - 1);
  }, 120_000);
});
