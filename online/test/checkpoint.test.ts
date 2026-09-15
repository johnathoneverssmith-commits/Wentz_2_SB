import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { humanGate } from "@/state/rules.ts";

import { autopilotAbsent, clearReadinessOnline, readyUpLocal } from "../src/phases.js";

/**
 * Change 2 — a checkpoint waits for everybody, and has no clock.
 *
 * Committing is the one thing a single-player section owes the league, and it
 * must mean the league cannot move without you. That rules out the deadline
 * sweeper standing in for an absent GM, which is what it used to do. The
 * consequence is accepted rather than worked around: a GM who never comes
 * back ends that league. These pin both halves — that the last commitment is
 * what advances, and that nothing else can.
 */
function league(humans: number): LeagueState {
  const s = createLeague(1357, { ...DEFAULT_CONFIG, humanGmCount: humans });
  fillRosterGaps(s);
  const codes = ["KC", "BUF", "GB"];
  for (let i = 0; i < humans; i++) {
    s.gms[i]!.teamCode = codes[i]!;
    s.gms[i]!.isHuman = true;
  }
  s.stage = "fantasyDraftSummary";
  clearReadinessOnline(s);
  return s;
}

describe("the checkpoint", () => {
  it("does not advance on one GM committing", () => {
    const s = league(3);
    s.readiness[s.gms[0]!.id] = true;
    expect(humanGate(s)).toBe(false);
    expect(readyUpLocal(s)).toBe(false);
    expect(s.stage).toBe("fantasyDraftSummary");
  });

  it("advances on the last one", () => {
    const s = league(3);
    for (const g of s.gms.filter((x) => x.isHuman && x.teamCode)) {
      s.readiness[g.id] = true;
    }
    expect(humanGate(s)).toBe(true);
    expect(readyUpLocal(s)).toBe(true);
    expect(s.stage).not.toBe("fantasyDraftSummary");
  });

  it("keeps a committed GM committed — the deadline cannot undo it", () => {
    const s = league(3);
    const first = s.gms[0]!.id;
    s.readiness[first] = true;
    autopilotAbsent(s);
    expect(s.readiness[first]).toBe(true);
  });

  it("never commits on an absent GM's behalf, however long it waits", () => {
    const s = league(3);
    s.readiness[s.gms[0]!.id] = true;
    // the sweeper runs; the two who have not committed must stay uncommitted
    autopilotAbsent(s);
    autopilotAbsent(s);
    autopilotAbsent(s);
    expect(s.readiness[s.gms[1]!.id]).toBeFalsy();
    expect(s.readiness[s.gms[2]!.id]).toBeFalsy();
    expect(humanGate(s)).toBe(false);
    // and so the league is still exactly where it was
    expect(s.stage).toBe("fantasyDraftSummary");
  });

  it("does not wait on teams nobody is running", () => {
    const s = league(2);
    for (const g of s.gms.filter((x) => x.isHuman && x.teamCode)) {
      s.readiness[g.id] = true;
    }
    // the other thirty teams are AI and are not part of the count
    expect(humanGate(s)).toBe(true);
  });
});
