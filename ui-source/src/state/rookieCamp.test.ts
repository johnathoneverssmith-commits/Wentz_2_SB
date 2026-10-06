import { describe, expect, it } from "vitest";

import { applyDraftSetting, createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed";
import { runTrainingCamp } from "./trainingCamp";

function fixture() {
  const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
  applyDraftSetting(s);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  s.gms[0]!.teamCode = "GB";
  s.teams.GB!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  // a rookie wide receiver just behind the three starters, and one nowhere near them
  const wrs = Object.values(s.players).filter((p) => p.nfl_team === "GB" && p.position === "WR").sort((a, b) => b.overall - a.overall);
  const third = wrs[2]!;
  const close = wrs[3]!;
  close.years_pro = 0;
  close.overall = third.overall - 2;
  const far = wrs[4]!;
  far.years_pro = 0;
  far.overall = third.overall - 15;
  for (const p of [close, far]) delete (p as { potential?: number }).potential;
  return { s, close, far };
}

const growth = (s: ReturnType<typeof fixture>["s"], id: string): number => {
  const r = s.trainingCamp!.results.GB!.find((x) => x.playerId === id)!;
  return r.delta;
};

describe("rookie playing time at training camp", () => {
  it("grows the rookie the policy puts on the field, and nobody who sits either way", () => {
    const camp = { offensiveFocus: "QB", defensiveFocus: "DL", submitted: true } as never;
    const base = fixture();
    runTrainingCamp(base.s, "GB", camp);
    const playing = fixture();
    playing.s.gamePlans = { GB: { rookies: 100 } as never };
    runTrainingCamp(playing.s, "GB", camp);
    // promoted ahead of a better veteran: more than the same camp with no policy
    expect(growth(playing.s, playing.close.id)).toBeGreaterThan(growth(base.s, base.close.id));
    // a rookie 15 points behind never gets near the field: unchanged
    expect(growth(playing.s, playing.far.id)).toBe(growth(base.s, base.far.id));
  }, 120000);
});
