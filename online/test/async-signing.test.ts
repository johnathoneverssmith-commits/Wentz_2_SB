import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { applyCoachHire, checkCoachHire, checkStandingSign } from "@/state/rules.ts";
import { resolveTransition } from "@/state/stageMachine.ts";

import { clearReadinessOnline, onStageEntered } from "../src/phases.js";

/**
 * Signing is asynchronous now, and the timed windows are gone.
 *
 * There used to be two five-day sealed-bid periods at fixed points in the
 * calendar — one for coaches, one for free agents — each running on a
 * twelve-minute-per-day clock. They are removed: teams start with the staff
 * they actually have, free agents are signable whenever, and neither has a
 * stage of its own to sit in.
 */
function league(): LeagueState {
  const s = createLeague(31, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  clearReadinessOnline(s);
  return s;
}

describe("the offseason calendar", () => {
  it("no longer routes through a hiring or free-agency stage", () => {
    const s = league();
    const seen = new Set<string>();
    let stage = "setup";
    // walk the whole loop once; neither window stage may appear
    for (let i = 0; i < 40 && !seen.has(stage); i++) {
      seen.add(stage);
      s.stage = stage as LeagueState["stage"];
      const t = resolveTransition(s, {});
      stage = t.stage;
      if (stage === "preseason") break;
    }
    expect([...seen]).not.toContain("coachingHiring");
    expect([...seen]).not.toContain("offseasonFreeAgency");
  });

  it("goes from the draft summary straight to the preseason", () => {
    const s = league();
    s.stage = "fantasyDraftSummary";
    expect(resolveTransition(s, {}).stage).toBe("preseason");
  });

  it("opens no bidding window when a stage begins", () => {
    const s = league();
    for (const stage of ["preseason", "offseasonSignings", "offseasonDepthChart"] as const) {
      s.stage = stage;
      onStageEntered(s);
      expect(s.coachingHire, stage).toBeNull();
      expect(s.freeAgency, stage).toBeNull();
    }
  }, 60_000);
});

describe("coaching, asynchronously", () => {
  it("starts every team with the staff it actually has", () => {
    const s = league();
    for (const code of Object.keys(s.teams)) {
      const staff = Object.values(s.coaches).filter((c) => c.team === code);
      expect(staff.map((c) => c.role).sort(), code).toEqual(["DC", "HC", "OC"]);
      for (const c of staff) expect(c.name, code).toBeTruthy();
    }
  });

  it("hires an out-of-work coach and lets the incumbent go", () => {
    const s = league();
    const open = Object.values(s.coaches).find((c) => c.team === null && c.role === "OC")!;
    const incumbent = Object.values(s.coaches).find((c) => c.team === "KC" && c.role === "OC")!;

    expect(checkCoachHire(s, open.id, "KC").ok).toBe(true);
    applyCoachHire(s, open.id, "KC");

    expect(s.coaches[open.id]!.team).toBe("KC");
    expect(s.coaches[incumbent.id]!.team).toBeNull();
    // exactly one OC, not two
    expect(Object.values(s.coaches).filter((c) => c.team === "KC" && c.role === "OC")).toHaveLength(1);
  });

  it("refuses a coach who already has a job", () => {
    const s = league();
    const employed = Object.values(s.coaches).find((c) => c.team === "BUF")!;
    const check = checkCoachHire(s, employed.id, "KC");
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/under contract/i);
  });
});

describe("free agency, asynchronously", () => {
  it("needs no window — only a free agent, room, and cap space", () => {
    const s = league();
    s.stage = "preseason";
    expect(s.freeAgency).toBeNull();
    const fa = Object.values(s.players).find((p) => p.free_agent && !p.retired)!;
    const check = checkStandingSign(s, fa.id, {
      teamCode: "KC",
      baseSalary: 1,
      years: 1,
      signingBonus: 0,
      guaranteed: 0,
    });
    // it may refuse on cap or roster size, but never for want of a window
    expect(check.reason ?? "").not.toMatch(/window|day/i);
  }, 60_000);
});
