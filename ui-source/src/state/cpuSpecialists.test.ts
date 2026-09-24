import { describe, expect, it } from "vitest";

import { fillPositionalGaps, reconcileCpuTeam } from "./reconciliation.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * A CPU team never plays with an invented 0-rated kicker while real ones sit
 * unsigned.
 *
 * Reconciliation cut the cheapest player on a crowded roster — the only
 * kicker and the only punter, every time — and then filled the hole it had
 * made with a 0-overall "Replacement K", while free agents rated 72-78 went
 * unsigned. Found by watching Master-difficulty CPU teams, which carry no
 * specialist premium and so reach reconciliation more crowded: twelve teams
 * in one league were kicking with a placeholder.
 */
function league() {
  const s = createLeague(61, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  fillRosterGaps(s);
  return s;
}

describe("CPU specialists at reconciliation", () => {
  it("does not cut a team's only kicker or punter to get under the roster limit", () => {
    const s = league();
    const code = "DAL";
    // crowd the roster well past the limit with cheap free agents
    const extras = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.position === "WR").slice(0, 6);
    for (const p of extras) {
      p.free_agent = false;
      p.nfl_team = code;
      p.contract = { team_id: code, years_remaining: 1, total_value: 1, guaranteed: 0, cap_hit_by_year: [1], signing_bonus: 0 };
    }
    // and make the specialists the cheapest men on it, as they usually are
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === code && (p.position === "K" || p.position === "P") && p.contract) {
        p.contract.cap_hit_by_year = [0.5];
      }
    }
    reconcileCpuTeam(s, code);
    for (const pos of ["K", "P"]) {
      const at = Object.values(s.players).filter((p) => p.nfl_team === code && p.position === pos && !p.retired);
      expect(at.length, `${pos} count`).toBeGreaterThan(0);
      expect(Math.min(...at.map((p) => p.overall)), `${pos} rating`).toBeGreaterThan(0);
    }
  });

  it("fills a missing kicker from the free agents, not with a placeholder", () => {
    const s = league();
    const code = "DAL";
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === code && p.position === "K") {
        p.nfl_team = "FA";
        p.free_agent = true;
        p.contract = null;
      }
    }
    const bestFreeKicker = Math.max(
      ...Object.values(s.players).filter((p) => p.free_agent && p.position === "K").map((p) => p.overall),
    );
    fillPositionalGaps(s, code);
    const kicker = Object.values(s.players).find((p) => p.nfl_team === code && p.position === "K")!;
    expect(kicker.id.startsWith("emg_"), "invented a placeholder kicker").toBe(false);
    expect(kicker.overall).toBe(bestFreeKicker);
  });
});
