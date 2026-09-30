import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { takeNotes } from "../src/notes.js";
import { onStageEntered } from "../src/phases.js";

/**
 * The preseason roster fill tops a GM's team up to 53 — and used to do it
 * without a word, so a GM found eight strangers on the depth chart.
 */
describe("staff roster moves on the wire", () => {
  it("names who the staff signed for a GM's team", async () => {
    const { createLeague } = await import("@/state/seed.ts");
    const s = createLeague(1);
    const gm = s.gms.find((g) => g.teamCode === "GB") ?? s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    // leave GB short so the fill has to act
    const gb = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !p.retired);
    for (const p of gb.slice(0, 6)) {
      p.free_agent = true;
      p.nfl_team = null as unknown as string;
    }
    s.stage = "preseason";
    onStageEntered(s, "offseasonDepthChart");
    const notes = takeNotes(s).filter((n) => n.kind === "roster.staff");
    expect(notes.some((n) => n.teamCode === "GB" && /Green Bay's staff signed .+ before the preseason\./.test(n.summary))).toBe(true);
    expect(takeNotes(s)).toEqual([]);
  });
});
