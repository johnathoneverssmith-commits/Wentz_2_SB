import { describe, expect, it } from "vitest";

import { takeNotes } from "../src/notes.js";
import { onStageEntered } from "../src/phases.js";

/**
 * Emergency roster repair at a progression checkpoint, as the league server runs it.
 * The staff chooses; the GM is told. No database needed.
 */
describe("emergency roster repair on the wire", () => {
  async function league() {
    const { createLeague } = await import("@/state/seed.ts");
    const s = createLeague(1);
    const gm = s.gms.find((g) => g.teamCode === "GB") ?? s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    return s;
  }
  const dropKickers = (s: Awaited<ReturnType<typeof league>>, team: string) => {
    for (const p of Object.values(s.players)) if (p.nfl_team === team && p.position === "K") delete s.players[p.id];
  };

  it("fills a human team's hole before the block is played and notifies that GM only", async () => {
    const s = await league();
    const { fillRosterGaps } = await import("@/state/seed.ts");
    fillRosterGaps(s);
    dropKickers(s, "GB");
    dropKickers(s, "KC"); // a CPU team has the same hole
    s.stage = "regularSeason";
    takeNotes(s);
    onStageEntered(s, "leagueDevelopments");
    const notes = takeNotes(s).filter((n) => n.kind === "roster.repair");
    expect(notes).toHaveLength(1); // the GM's team only: a CPU team's repair is not news
    expect(notes[0]!.teamCode).toBe("GB");
    expect(notes[0]!.summary).toMatch(/Your staff signed .+K \d+/);
    for (const team of ["GB", "KC"]) {
      const ks = Object.values(s.players).filter((p) => p.nfl_team === team && p.position === "K" && !p.free_agent);
      expect(ks.length, team).toBe(1);
      expect(ks[0]!.contract!.years_remaining).toBe(1);
    }
    expect((s.rosterRepairs ?? []).map((r) => r.team).sort()).toEqual(["GB", "KC"]);
  });

  it("does not run at a stage that is not a checkpoint, or while a market is open", async () => {
    const s = await league();
    const { fillRosterGaps } = await import("@/state/seed.ts");
    fillRosterGaps(s);
    dropKickers(s, "GB");
    s.stage = "trainingCampResults";
    takeNotes(s);
    onStageEntered(s, "trainingCamp");
    expect((s.rosterRepairs ?? []).length).toBe(0);
    expect(takeNotes(s).filter((n) => n.kind === "roster.repair")).toEqual([]);
  });
});
