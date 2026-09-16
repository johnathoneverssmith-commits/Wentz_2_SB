import { describe, expect, it } from "vitest";

import {
  applyCoachToDelta,
  developmentMultiplier,
  NEUTRAL_COACH_OVERALL,
  recoveryMultiplier,
  regressionMultiplier,
} from "@/state/coachEffects.ts";
import { coachRoleForPosition } from "@/domain";

/**
 * Change 3 — what the nine development coaches are worth.
 *
 * 72 is neutral and every point either side moves the relevant rate by one
 * percent, applied in opposite directions to development and regression. The
 * symmetry is the substance: the same distance from neutral has to be worth
 * the same amount whichever way it runs, or a good hire and a bad one are not
 * the same decision reversed.
 */
describe("coach effect scale", () => {
  it("changes nothing at 72", () => {
    expect(developmentMultiplier(72)).toBe(1);
    expect(regressionMultiplier(72)).toBe(1);
    expect(recoveryMultiplier(72)).toBe(1);
    expect(NEUTRAL_COACH_OVERALL).toBe(72);
  });

  it("moves one percent per point", () => {
    expect(developmentMultiplier(82)).toBeCloseTo(1.1, 10);
    expect(developmentMultiplier(62)).toBeCloseTo(0.9, 10);
    expect(regressionMultiplier(82)).toBeCloseTo(0.9, 10);
    expect(regressionMultiplier(62)).toBeCloseTo(1.1, 10);
  });

  it("is symmetric — a bad hire costs what a good one gains", () => {
    for (const d of [5, 12, 27]) {
      const good = developmentMultiplier(72 + d) - 1;
      const bad = 1 - developmentMultiplier(72 - d);
      expect(good).toBeCloseTo(bad, 10);
    }
  });

  it("applies development and regression in opposite directions", () => {
    const good = 90;
    expect(developmentMultiplier(good)).toBeGreaterThan(1);
    expect(regressionMultiplier(good)).toBeLessThan(1);
    const bad = 45;
    expect(developmentMultiplier(bad)).toBeLessThan(1);
    expect(regressionMultiplier(bad)).toBeGreaterThan(1);
  });

  it("shortens recovery for a good training room and lengthens it for a poor one", () => {
    expect(recoveryMultiplier(92)).toBeCloseTo(0.8, 10);
    expect(recoveryMultiplier(52)).toBeCloseTo(1.2, 10);
    // never negative, however bad the coach
    expect(recoveryMultiplier(35)).toBeGreaterThan(0);
    expect(recoveryMultiplier(99)).toBeGreaterThan(0);
  });

  it("never turns a gain into a loss, or a loss into a gain", () => {
    for (const ovr of [35, 50, 72, 85, 99]) {
      const mods = {
        development: developmentMultiplier(ovr),
        regression: regressionMultiplier(ovr),
      };
      expect(applyCoachToDelta(3, mods)).toBeGreaterThan(0);
      expect(applyCoachToDelta(-3, mods)).toBeLessThan(0);
    }
  });

  it("never rounds a real change away to nothing", () => {
    // a +1 under a poor coach still has to be an improvement, not a zero
    const poor = { development: developmentMultiplier(40), regression: regressionMultiplier(40) };
    expect(applyCoachToDelta(1, poor)).toBe(1);
    const great = { development: developmentMultiplier(99), regression: regressionMultiplier(99) };
    expect(applyCoachToDelta(-1, great)).toBe(-1);
  });

  it("leaves an unchanged player unchanged", () => {
    const mods = { development: developmentMultiplier(99), regression: regressionMultiplier(99) };
    expect(applyCoachToDelta(0, mods)).toBe(0);
  });
});

describe("who coaches whom", () => {
  it("maps every position group to exactly one coach", () => {
    expect(coachRoleForPosition("QB")).toBe("QB");
    expect(coachRoleForPosition("RB")).toBe("RB");
    expect(coachRoleForPosition("C")).toBe("OL");
    expect(coachRoleForPosition("OG")).toBe("OL");
    expect(coachRoleForPosition("OT")).toBe("OL");
    expect(coachRoleForPosition("WR")).toBe("WR");
    expect(coachRoleForPosition("TE")).toBe("WR");
    expect(coachRoleForPosition("DT")).toBe("DL");
    expect(coachRoleForPosition("EDGE")).toBe("DL");
    expect(coachRoleForPosition("ILB")).toBe("LB");
    expect(coachRoleForPosition("OLB")).toBe("LB");
    expect(coachRoleForPosition("CB")).toBe("DB");
    expect(coachRoleForPosition("S")).toBe("DB");
    expect(coachRoleForPosition("K")).toBe("ST");
    expect(coachRoleForPosition("P")).toBe("ST");
  });

  it("has nobody coaching a position that does not exist here", () => {
    // long snappers are not in this league and must not map to a staff job
    expect(coachRoleForPosition("LS")).toBeNull();
  });
});

describe("coaches reaching the actual game", () => {
  it("makes a good staff develop a roster faster than a poor one", async () => {
    const { createLeague, DEFAULT_CONFIG, fillRosterGaps, applySeasonAging } = await import(
      "@/state/seed.ts"
    );
    const { beginDraft } = await import("@/state/rules.ts");
    const { beginCoachingDraft, runAiCoachingPicks } = await import("@/state/coachingDraft.ts");

    /** A league whose staffs are all set to one rating. */
    const leagueWithStaffAt = (rating: number) => {
      const s = createLeague(9090, { ...DEFAULT_CONFIG, humanGmCount: 1 });
      fillRosterGaps(s);
      s.gms[0]!.teamCode = "KC";
      s.gms[0]!.isHuman = true;
      s.stage = "fantasyDraft";
      beginDraft(s, "fantasy");
      s.stage = "coachingDraft";
      beginCoachingDraft(s);
      runAiCoachingPicks(s, new Set());
      for (const c of Object.values(s.coaches)) if (c.team) c.overall = rating;
      return s;
    };

    const young = (s: ReturnType<typeof leagueWithStaffAt>) =>
      Object.values(s.players).filter(
        (p) => !p.retired && p.nfl_team && p.age < p.dev_age_threshold,
      );

    const great = leagueWithStaffAt(99);
    const poor = leagueWithStaffAt(35);
    const beforeGreat = new Map(young(great).map((p) => [p.id, p.overall]));
    const beforePoor = new Map(young(poor).map((p) => [p.id, p.overall]));

    applySeasonAging(great, great.season);
    applySeasonAging(poor, poor.season);

    const gained = (s: typeof great, before: Map<string, number>) =>
      [...before].reduce((n, [id, was]) => n + Math.max(0, (s.players[id]?.overall ?? was) - was), 0);

    // the same players, the same aging seed — only the staff differs
    expect(gained(great, beforeGreat)).toBeGreaterThan(gained(poor, beforePoor));
  }, 180_000);

  it("makes a good training room shorten injuries", async () => {
    const { createLeague, DEFAULT_CONFIG, fillRosterGaps } = await import("@/state/seed.ts");
    const { applyInjuries } = await import("@/state/injuries.ts");

    const leagueWithMedicalAt = (rating: number) => {
      const s = createLeague(5151, { ...DEFAULT_CONFIG, humanGmCount: 1 });
      fillRosterGaps(s);
      const someone = Object.values(s.players).find((p) => p.nfl_team === "KC" && !p.retired)!;
      // one trainer, one rating
      const med = Object.values(s.coaches)[0]!;
      med.role = "MED";
      med.team = "KC";
      med.overall = rating;
      return { s, someone };
    };

    const hurt = (rating: number): number => {
      const { s, someone } = leagueWithMedicalAt(rating);
      applyInjuries(
        s,
        [
          {
            id: "g1",
            week: 1,
            phase: "REG",
            homeTeam: "KC",
            awayTeam: "BUF",
            played: true,
            homeScore: 20,
            awayScore: 17,
            injuries: [
              {
                playerId: someone.id,
                player: someone.name,
                position: someone.position,
                team: "KC",
                severity: "moderate",
                bodyPart: "knee",
                projectedWeeks: [4, 6],
              },
            ],
          } as never,
        ],
        s.season,
      );
      return s.players[someone.id]!.injury_status?.weeks_out_est?.[1] ?? 0;
    };

    expect(hurt(99)).toBeLessThan(hurt(35));
  }, 180_000);
});
