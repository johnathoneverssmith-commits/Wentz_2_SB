import { describe, expect, it } from "vitest";

import { onInjuredReserve } from "./injuries.ts";
import { reconciliationIssues } from "./reconciliation.ts";
import { rosterCountOf } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

describe("injured reserve", () => {
  it("a long-term injury frees a roster spot in season, and not in the offseason", () => {
    const s = createLeague(4, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const team = "DAL";
    const p = Object.values(s.players).find((x) => x.nfl_team === team && x.position === "WR")!;
    s.stage = "regularSeason";
    const before = rosterCountOf(s, team);
    p.injury_status = { status: "out", weeks_out_est: [6, 9], description: "knee" };
    expect(onInjuredReserve(p, s.stage)).toBe(true);
    expect(rosterCountOf(s, team)).toBe(before - 1);

    // a short injury stays on the active roster
    p.injury_status = { status: "out", weeks_out_est: [2, 3], description: "ankle" };
    expect(rosterCountOf(s, team)).toBe(before);

    // IR is a season rule
    p.injury_status = { status: "out", weeks_out_est: [6, 9], description: "knee" };
    s.stage = "offseasonDepthChart";
    expect(onInjuredReserve(p, s.stage)).toBe(false);
  });

  it("the roster limit ignores IR, the cap does not", () => {
    const s = createLeague(4, { ...DEFAULT_CONFIG, fantasyDraft: false });
    s.stage = "regularSeason";
    const team = "DAL";
    const roster = Object.values(s.players).filter((x) => x.nfl_team === team && !x.retired);
    // put a 54th man on the roster, then hurt someone long-term
    const extra = Object.values(s.players).find((x) => x.free_agent && !x.retired)!;
    extra.free_agent = false;
    extra.nfl_team = team;
    extra.contract = { team_id: team, years_remaining: 1, total_value: 1, guaranteed: 0, cap_hit_by_year: [1], signing_bonus: 0 };
    expect(roster.length + 1).toBeGreaterThan(53);
    const hurt = roster.find((x) => x.position === "WR")!;
    hurt.injury_status = { status: "out", weeks_out_est: [8, 12], description: "ACL" };
    const issues = reconciliationIssues(s, team);
    expect(issues.some((i) => i.kind === "roster")).toBe(roster.length + 1 - 1 > 53);
  });
});
