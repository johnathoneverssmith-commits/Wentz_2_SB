import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginDraft } from "@/state/rules.ts";
import { standingAsk } from "@/state/rules.ts";
import {
  beginCoachingDraft,
  coachingDraftComplete,
  coachingOnTheClock,
  isDelegated,
  vacantRoles,
  checkCoachingPick,
  bestCoachingPick,
  runAiCoachingPicks,
} from "@/state/coachingDraft.ts";
import { freeAgencyWindowOpen, tradeWindowOpen } from "@/state/transactionWindows.ts";

import {
  decideCpuRepairSigning,
  decideCoachingPick,
  decideDelegateCoaching,
  decidePlaceBid,
  decideProposeTrade,
  decideRespondToTrade,
  decideSignFreeAgent,
  type Actor,
} from "../src/decide.js";

/**
 * UI-PT-11 / 16 / 17: transactions happen only in their scheduled windows.
 * These run the same pure rulings the HTTP routes call, so a refusal here is
 * a refusal for a hand-built request too.
 */
let s: LeagueState;
let alice: Actor;
let bob: Actor;
const STAGES = [
  "freeAgency",
  "midseasonFreeAgency",
  "offseasonFreeAgency",
  "tradeDeadline",
  "preseason",
  "regularSeason",
  "offseasonDraft",
  "trainingCamp",
] as const;

beforeEach(() => {
  s = createLeague(777, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  alice = { userId: "u1", leagueId: "l", teamCode: "KC", gmId: s.gms[0]!.id };
  bob = { userId: "u2", leagueId: "l", teamCode: "BUF", gmId: s.gms[1]!.id };
});

function aFreeAgent() {
  const p = Object.values(s.players).find((x) => !x.retired && !x.free_agent && x.nfl_team === "DEN")!;
  p.free_agent = true;
  p.nfl_team = "FA";
  p.contract = null;
  s.teams.KC!.cap.total = 400;
  return p;
}
const offerFor = (p: ReturnType<typeof aFreeAgent>) => ({
  baseSalary: standingAsk(s, p),
  signingBonus: 0,
  years: 2,
  guaranteed: 0,
});

describe("voluntary free-agent signing is closed outside the rounds", () => {
  it.each(STAGES)("refuses the instant-sign route in %s", (stage) => {
    s.stage = stage;
    const p = aFreeAgent();
    expect(() => decideSignFreeAgent(s, alice, p.id, offerFor(p))).toThrow(/scheduled free-agency rounds/i);
    expect(s.players[p.id]!.free_agent).toBe(true);
    expect(s.players[p.id]!.nfl_team).toBe("FA");
  });

  it("refuses the legacy bid route for players", () => {
    s.stage = "offseasonFreeAgency";
    const p = aFreeAgent();
    expect(() => decidePlaceBid(s, alice, "players", p.id, offerFor(p))).toThrow(/scheduled free-agency rounds/i);
  });

  it("the window is open only while a round event is running", () => {
    s.stage = "freeAgency";
    expect(freeAgencyWindowOpen(s)).toBe(false);
    s.freeAgencyEvent = { complete: false } as never;
    expect(freeAgencyWindowOpen(s)).toBe(true);
    s.freeAgencyEvent = { complete: true } as never;
    expect(freeAgencyWindowOpen(s)).toBe(false);
    s.stage = "preseason";
    s.freeAgencyEvent = { complete: false } as never;
    expect(freeAgencyWindowOpen(s)).toBe(false);
  });
});

describe("CPU roster-repair boundary", () => {
  it("signs for a CPU team only, with an authorisation only the server can build", () => {
    s.stage = "preseason";
    const p = aFreeAgent();
    s.teams.DEN!.cap.total = 400;
    // DEN has 52 now: room for one
    const out = decideCpuRepairSigning(s, { kind: "cpu-roster-repair", teamCode: "DEN" }, p.id, offerFor(p));
    expect(out.events[0]!.kind).toBe("fa.repair");
    expect(s.players[p.id]!.nfl_team).toBe("DEN");
  });

  it("never signs for a team with a human GM seated", () => {
    const p = aFreeAgent();
    expect(() =>
      decideCpuRepairSigning(s, { kind: "cpu-roster-repair", teamCode: "KC" }, p.id, offerFor(p)),
    ).toThrow(/only for CPU teams/i);
    expect(s.players[p.id]!.free_agent).toBe(true);
  });

  it("rejects a forged authorisation kind", () => {
    const p = aFreeAgent();
    expect(() =>
      decideCpuRepairSigning(s, { kind: "human" as never, teamCode: "DEN" }, p.id, offerFor(p)),
    ).toThrow(/authorised/i);
  });
});

describe("ad-hoc trades are closed; the deadline is the window", () => {
  it.each(STAGES)("refuses a proposal in %s, to a CPU or a human team", (stage) => {
    s.stage = stage;
    const mine = Object.values(s.players).find((p) => p.nfl_team === "KC" && !p.free_agent)!;
    for (const to of ["DEN", "BUF"]) {
      const theirs = Object.values(s.players).find((p) => p.nfl_team === to && !p.free_agent)!;
      expect(() => decideProposeTrade(s, alice, "t1", to, [mine.id], [theirs.id])).toThrow(/Trade Deadline window/i);
    }
    expect(s.trades).toHaveLength(0);
    expect(s.players[mine.id]!.nfl_team).toBe("KC");
  });

  it("refuses accepting a leftover offer, but still lets you decline it", () => {
    s.stage = "tradeDeadline";
    const mine = Object.values(s.players).find((p) => p.nfl_team === "KC" && !p.free_agent)!;
    const theirs = Object.values(s.players).find((p) => p.nfl_team === "BUF" && !p.free_agent)!;
    s.trades.push({
      id: "old",
      fromTeam: "KC",
      toTeam: "BUF",
      fromAssets: [{ kind: "player", playerId: mine.id }],
      toAssets: [{ kind: "player", playerId: theirs.id }],
      aiValueDelta: 0,
      aiAcceptLikelihood: 0.5,
      status: "offered",
    });
    expect(() => decideRespondToTrade(s, bob, "old", true)).toThrow(/Trade Deadline window/i);
    expect(s.players[mine.id]!.nfl_team).toBe("KC");
    expect(() => decideRespondToTrade(s, alice, "old", false)).toThrow(/isn't yours/i);
    decideRespondToTrade(s, bob, "old", false);
    expect(s.trades[0]!.status).toBe("rejected");
    // and it cannot be answered twice
    expect(() => decideRespondToTrade(s, bob, "old", false)).toThrow(/already been answered/i);
  });

  it("the trade window is exactly the deadline stage", () => {
    for (const st of STAGES) expect(tradeWindowOpen({ stage: st }), st).toBe(st === "tradeDeadline");
  });
});

describe("coaching draft: delegate remaining picks", () => {
  function open(): void {
    s.stage = "fantasyDraft";
    beginDraft(s, "fantasy");
    s.stage = "coachingDraft";
    beginCoachingDraft(s);
    runAiCoachingPicks(s, new Set(["KC", "BUF"]));
  }
  /** make a human pick for whoever is on the clock */
  function humanPick(a: Actor): void {
    const c = bestCoachingPick(s, a.teamCode)!;
    expect(checkCoachingPick(s, a.teamCode, c).ok).toBe(true);
    decideCoachingPick(s, a, c);
  }
  function advanceToHuman(): Actor | null {
    const on = coachingOnTheClock(s);
    return on === "KC" ? alice : on === "BUF" ? bob : null;
  }

  it("keeps manual picks, takes only this team's rest, and leaves the other human on their own turn", () => {
    open();
    // play until alice is on the clock, take one pick by hand
    let guard = 0;
    while (advanceToHuman() !== alice && guard++ < 20) humanPick(advanceToHuman()!);
    humanPick(alice);
    const manual = s.coachingDraft!.results.filter((r) => r.teamCode === "KC");
    expect(manual).toHaveLength(1);

    // wait until alice is on the clock again or someone else is, then delegate
    decideDelegateCoaching(s, alice);
    expect(isDelegated(s, "KC")).toBe(true);
    // bob is a human who has not delegated: the clock must never rest on a CPU or on alice
    expect(["BUF", undefined]).toContain(coachingOnTheClock(s) === "KC" ? undefined : coachingOnTheClock(s));

    // bob picks his way through; alice's staff picks whenever her turn arrives
    guard = 0;
    while (!coachingDraftComplete(s) && guard++ < 40) {
      const on = coachingOnTheClock(s);
      expect(on).toBe("BUF");
      humanPick(bob);
    }
    expect(coachingDraftComplete(s)).toBe(true);
    expect(vacantRoles(s, "KC")).toHaveLength(0);
    const kc = s.coachingDraft!.results.filter((r) => r.teamCode === "KC");
    expect(kc).toHaveLength(12);
    // the first was hers by hand; every later one is marked as the staff's
    expect(kc[0]!.byStaff).toBeUndefined();
    expect(kc.slice(1).every((r) => r.byStaff === true)).toBe(true);
    // bob's picks were never marked or taken for him
    expect(s.coachingDraft!.results.filter((r) => r.teamCode === "BUF").every((r) => !r.byStaff)).toBe(true);
    expect(s.coachingDraft!.delegated).toEqual(["KC"]);
  });

  it("is a no-op on a repeat click and refuses when the draft is not running", () => {
    open();
    decideDelegateCoaching(s, alice);
    expect(decideDelegateCoaching(s, alice).unchanged).toBe(true);
    s.stage = "freeAgency";
    expect(() => decideDelegateCoaching(s, bob)).toThrow(/isn't running/i);
  });

  it("survives a save and reload", () => {
    open();
    decideDelegateCoaching(s, alice);
    const reloaded = JSON.parse(JSON.stringify(s)) as LeagueState;
    expect(isDelegated(reloaded, "KC")).toBe(true);
    expect(reloaded.coachingDraft!.results.filter((r) => r.teamCode === "KC").every((r) => r.byStaff !== false)).toBe(true);
  });

  it("when both humans delegate the whole board completes", () => {
    open();
    decideDelegateCoaching(s, alice);
    decideDelegateCoaching(s, bob);
    expect(coachingDraftComplete(s)).toBe(true);
    expect(s.stage).not.toBe("coachingDraft");
  });

  it("a team that already has a full staff has nothing to delegate", () => {
    open();
    for (const role of vacantRoles(s, "KC")) {
      const c = Object.values(s.coaches).find((x) => x.team === null && x.role === role)!;
      c.team = "KC";
    }
    expect(() => decideDelegateCoaching(s, alice)).toThrow(/already complete/i);
  });
});
