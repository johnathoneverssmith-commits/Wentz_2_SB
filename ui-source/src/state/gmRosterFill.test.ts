import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * The free-agency summary's roster fill on a GM's team.
 *
 * Entering the summary after a fantasy draft, the fill trimmed every roster
 * to a budget for its empty spots — and on a GM's team that released four of
 * the five free agents they had just signed, to sign minimum-salary depth in
 * their place, before they had seen the screen where fixing the roster is
 * their own job.
 */
function capped(): { s: LeagueState; kept: string[]; cap: number } {
  const s = createLeague(1, { ...DEFAULT_CONFIG, fantasyDraft: false });
  fillRosterGaps(s);
  s.teams.GB!.controlledBy = { kind: "human", gmId: s.gms[0]!.id } as never;
  const gb = Object.values(s.players)
    .filter((p) => p.nfl_team === "GB" && !p.retired)
    .sort((a, b) => b.overall - a.overall);
  // 25 left, as after a 20-round draft and five signings
  for (const p of gb.slice(25)) {
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
  }
  const kept = gb.slice(0, 25);
  const cap = s.teams.GB!.cap.total;
  // and nearly capped out: room for a handful of minimum deals, not 28
  const per = (cap - 8) / kept.length;
  for (const p of kept) {
    p.contract = {
      ...(p.contract ?? { team_id: "GB", guaranteed: 0, total_value: 0, signing_bonus: 0, years_remaining: 3 }),
      cap_hit_by_year: [per, per, per],
    } as never;
  }
  return { s, kept: kept.map((p) => p.id), cap };
}

const used = (s: LeagueState): number =>
  Object.values(s.players)
    .filter((p) => p.nfl_team === "GB" && !p.retired && !p.free_agent)
    .reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);

describe("the roster fill at a free-agency summary, on a GM's team", () => {
  it("releases none of the GM's players, and stays under the cap", () => {
    const { s, kept, cap } = capped();
    fillRosterGaps(s, { spareGmRosters: true });
    for (const id of kept) expect(s.players[id]!.nfl_team).toBe("GB");
    expect(used(s)).toBeLessThanOrEqual(cap);
    const size = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !p.retired && !p.free_agent).length;
    expect(size).toBeGreaterThan(25);
    expect(size).toBeLessThan(53);
  });

  it("the preseason fill still brings the roster to 53", () => {
    const { s } = capped();
    fillRosterGaps(s);
    const size = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !p.retired && !p.free_agent).length;
    expect(size).toBe(53);
  });
});
