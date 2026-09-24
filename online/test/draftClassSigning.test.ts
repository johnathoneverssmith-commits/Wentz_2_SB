import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { signAiDraftPicks, signUndraftedAsFreeAgents } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

/**
 * Leaving the draft summary for free agency, every CPU class is signed and
 * every undrafted prospect reaches the market. Both used to hang off the
 * retired `offseasonSignings` stage — 217 drafted rookies vanished a year.
 */
function drafted(): LeagueState {
  const s = createLeague(2027, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  const ids = s.draftClass.map((p) => p.id);
  const teams = Object.keys(s.teams);
  const n = Math.min(ids.length - 20, teams.length * 7);
  s.draft = {
    kind: "rookie",
    pickOrder: [],
    currentPickIndex: n,
    results: ids.slice(0, n).map((id, i) => ({ teamCode: teams[i % teams.length]!, selectedId: id, round: 1 + Math.floor(i / teams.length) })),
  } as unknown as LeagueState["draft"];
  return s;
}

describe("draft class signing", () => {
  it("CPU picks become players and the undrafted become free agents", () => {
    const s = drafted();
    signAiDraftPicks(s);
    const undrafted = signUndraftedAsFreeAgents(s);
    const human = s.gms.find((g) => g.isHuman)?.teamCode;
    for (const r of s.draft!.results) {
      if (r.teamCode === human) continue;
      expect(s.players[`p_rookie_${r.selectedId}`]?.nfl_team).toBe(r.teamCode);
    }
    expect(undrafted).toBeGreaterThan(0);
    const fa = Object.values(s.players).filter((p) => p.id.startsWith("p_rookie_") && p.free_agent);
    expect(fa.length).toBeGreaterThanOrEqual(undrafted);
    // real skill profiles, not just speed/strength/awareness
    expect(Object.keys(fa[0]!.attributes).length).toBeGreaterThan(3);
    // idempotent
    expect(signUndraftedAsFreeAgents(s)).toBe(0);
  });
});
