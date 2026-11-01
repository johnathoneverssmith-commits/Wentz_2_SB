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
import { currentBlock } from "@/state/revealBlocks.ts";
import { revealedWeek } from "@/state/reveal.ts";
import { readFileSync } from "node:fs";
import { reconciliationIssues } from "@/state/reconciliation.ts";
import { applyRosterRepair, authorizeRosterRepair, isRepairAuthorization } from "../src/rosterRepair.js";
import { beginTradeDeadline } from "@/state/tradeDeadline.ts";
import { beginFreeAgencyEvent, onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { emptyReveal } from "@/state/reveal.ts";
import { freeAgencyWindowOpen, tradeWindowOpen } from "@/state/transactionWindows.ts";

import {
  decideCoachingPick,
  decideDeadlineTurn,
  decideReveal,
  decideFreeAgencyTurn,
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

describe("roster repair boundary (server-internal, both kinds of franchise)", () => {
  /** strip KC's kicker so there is a positional hole, and leave a street kicker */
  function holeFor(team: string) {
    const k = Object.values(s.players).find((p) => p.nfl_team === team && p.position === "K" && !p.free_agent)!;
    k.free_agent = true;
    k.nfl_team = "FA";
    k.contract = null;
    s.teams[team]!.cap.total = 400;
    return k;
  }

  it.each([["human-controlled", "KC"], ["CPU-controlled", "DEN"]])("repairs a %s roster at the checkpoint, choosing the player itself", (_n, team) => {
    s.stage = "freeAgencySummary";
    holeFor(team);
    expect(reconciliationIssues(s, team).length).toBeGreaterThan(0);
    const out = applyRosterRepair(s, authorizeRosterRepair(s, team, "freeAgencySummary"));
    expect(out.remaining).toBe(0);
    expect(Object.values(s.players).some((p) => p.nfl_team === team && p.position === "K" && !p.free_agent)).toBe(true);
  });

  it("is refused outside a repair checkpoint", () => {
    for (const stage of ["preseason", "regularSeason", "freeAgency", "tradeDeadline", "offseasonDraft"] as const) {
      s.stage = stage;
      expect(() => authorizeRosterRepair(s, "KC", "freeAgencySummary"), stage).toThrow(/only authorised around/i);
    }
    s.stage = "freeAgencySummary";
    expect(() => authorizeRosterRepair(s, "KC", "midseasonFreeAgencySummary")).toThrow(/only authorised/i);
  });

  it("cannot be forged from a request body, and does not outlive its checkpoint", () => {
    s.stage = "freeAgencySummary";
    holeFor("KC");
    const forged = JSON.parse(JSON.stringify({ teamCode: "KC", checkpoint: "freeAgencySummary" }));
    expect(isRepairAuthorization(forged)).toBe(false);
    expect(() => applyRosterRepair(s, forged)).toThrow(/Not an authorised/i);
    const real = authorizeRosterRepair(s, "KC", "freeAgencySummary");
    expect(isRepairAuthorization(JSON.parse(JSON.stringify(real)))).toBe(false);
    s.stage = "regularSeason";
    expect(() => applyRosterRepair(s, real)).toThrow(/window has closed/i);
  });

  it("is idempotent on a legal roster", () => {
    s.stage = "freeAgencySummary";
    const before = JSON.stringify(Object.values(s.players).filter((p) => p.nfl_team === "DEN").map((p) => p.id));
    s.teams.DEN!.cap.total = 400;
    applyRosterRepair(s, authorizeRosterRepair(s, "DEN", "freeAgencySummary"));
    applyRosterRepair(s, authorizeRosterRepair(s, "DEN", "freeAgencySummary"));
    expect(reconciliationIssues(s, "DEN")).toHaveLength(0);
    expect(typeof before).toBe("string");
  });

  it("no HTTP route reaches it", () => {
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/rosterRepair|authorizeRosterRepair|applyRosterRepair/);
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

/**
 * Replacement coverage for the legal mechanisms. The rulings the deleted
 * instant-trade tests pinned (ownership, stale assets, the CPU's answer, the
 * collusion guard, a repeated submission) still matter — they now have to hold
 * at the Trade Deadline, which is the only place a trade is proposed.
 */
describe("the Trade Deadline keeps the rulings the instant route used to have", () => {
  const roster = (team: string) =>
    Object.values(s.players)
      .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent)
      .sort((a, b) => b.overall - a.overall);
  function openDeadline(): void {
    s.stage = "regularSeason";
    s.week = 9;
    s.reveal = emptyReveal();
    beginTradeDeadline(s);
    s.stage = "tradeDeadline";
    // put KC on the clock, with nobody else's turn pending
    s.tradeDeadline!.index = s.tradeDeadline!.order.indexOf("KC");
    for (const t of Object.keys(s.teams)) s.teams[t]!.cap.total = 600;
  }
  const move = (kind: "propose", to: string, give: string[], get: string[]) =>
    ({ kind, toTeam: to, give, get }) as const;

  it("refuses a proposal from a team that is not on the clock, to any partner", () => {
    openDeadline();
    const give = roster("BUF")[0]!.id;
    expect(() => decideDeadlineTurn(s, bob, move("propose", "KC", [give], [roster("KC")[0]!.id]))).toThrow(/isn't your turn/i);
    expect(s.tradeDeadline!.active ?? null).toBeNull();
  });

  it("refuses to offer a player you do not own, or ask for one the partner does not own", () => {
    openDeadline();
    const theirs = roster("BUF")[0]!.id;
    const mine = roster("KC")[0]!.id;
    expect(() => decideDeadlineTurn(s, alice, move("propose", "BUF", [theirs], [theirs]))).toThrow(/already moved/i);
    expect(() => decideDeadlineTurn(s, alice, move("propose", "BUF", [mine], [roster("DEN")[0]!.id]))).toThrow(/already moved/i);
    expect(s.players[theirs]!.nfl_team).toBe("BUF");
  });

  it("a repeated submission is not a second negotiation", () => {
    openDeadline();
    const m = move("propose", "BUF", [roster("KC")[5]!.id], [roster("BUF")[5]!.id]);
    decideDeadlineTurn(s, alice, m);
    expect(() => decideDeadlineTurn(s, alice, m)).toThrow();
    expect(s.tradeDeadline!.active?.fromTeam).toBe("KC");
  });

  it("the league blocks a one-sided blockbuster between two GMs when the recipient accepts", () => {
    openDeadline();
    const star = roster("KC").find((p) => p.overall >= 90) ?? roster("KC")[0]!;
    star.overall = 95;
    const scrub = roster("BUF").at(-1)!;
    decideDeadlineTurn(s, alice, move("propose", "BUF", [star.id], [scrub.id]));
    expect(s.tradeDeadline!.active?.awaiting).toBe("recipient");
    decideDeadlineTurn(s, bob, { kind: "accept" });
    expect(s.players[star.id]!.nfl_team).toBe("KC");
    expect(s.players[scrub.id]!.nfl_team).toBe("BUF");
  });

  it("accepting a fair two-GM deal moves both sides exactly once", () => {
    openDeadline();
    const a = roster("KC")[8]!;
    const b = roster("BUF")[8]!;
    a.overall = b.overall;
    decideDeadlineTurn(s, alice, move("propose", "BUF", [a.id], [b.id]));
    decideDeadlineTurn(s, bob, { kind: "accept" });
    expect(s.players[a.id]!.nfl_team).toBe("BUF");
    expect(s.players[b.id]!.nfl_team).toBe("KC");
    // the negotiation is closed: answering again moves nobody a second time
    try {
      decideDeadlineTurn(s, bob, { kind: "accept" });
    } catch {
      /* refused is fine too */
    }
    expect(s.players[a.id]!.nfl_team).toBe("BUF");
    expect(s.players[b.id]!.nfl_team).toBe("KC");
    expect(s.tradeDeadline!.resolved.filter((r) => r.outcome === "accepted" && r.fromTeam === "KC" && r.toTeam === "BUF")).toHaveLength(1);
  });

  it("a CPU partner answers on its own, and nothing is left hanging for it", () => {
    openDeadline();
    const a = roster("KC")[8]!;
    const b = roster("DEN")[8]!;
    decideDeadlineTurn(s, alice, move("propose", "DEN", [a.id], [b.id]));
    expect(s.tradeDeadline!.active?.awaiting === "recipient" && s.tradeDeadline!.active.toTeam === "DEN").toBe(false);
    const moved = s.players[a.id]!.nfl_team === "DEN";
    expect(s.players[b.id]!.nfl_team).toBe(moved ? "KC" : "DEN");
  });
});

describe("free-agency rounds keep turn ownership", () => {
  it("refuses an offer from a team that is not on the clock and signs nobody mid-round", () => {
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s, "offseason");
    const up = faOnTheClock(s)!;
    const other = up === "KC" ? bob : alice;
    const fa = Object.values(s.players).find((p) => p.free_agent && !p.retired)!;
    expect(() => decideFreeAgencyTurn(s, other, { playerId: fa.id, salary: 1, years: 1 })).toThrow(/isn't your turn/i);
    expect(s.players[fa.id]!.free_agent).toBe(true);
  });
});

describe("online simulate shortcuts are per-GM reveals bounded by the block", () => {
  it("cannot reveal past the end of the block, or a non-week, or for anyone else", () => {
    s.stage = "regularSeason";
    s.week = 1;
    s.reveal = emptyReveal();
    const last = currentBlock(s)!.lastWeek;
    for (const bad of [last + 1, 99, 0, -1, 2.5]) {
      expect(() => decideReveal(s, alice, bad), String(bad)).toThrow(/isn't part of this stretch/i);
    }
    decideReveal(s, alice, last);
    // alice's marker moved; bob's did not
    expect(revealedWeek(s, alice.gmId, "REG")).toBe(last);
    expect(revealedWeek(s, bob.gmId, "REG")).toBe(0);
    expect(() => decideReveal(s, alice, last)).toThrow(/already seen/i);
    // it never moves the league: stage and week are untouched
    expect(s.stage).toBe("regularSeason");
    expect(s.week).toBe(1);
  });

  it("is unavailable outside a played block", () => {
    s.stage = "tradeDeadline";
    expect(() => decideReveal(s, alice, 3)).toThrow(/nothing to reveal/i);
  });
});
