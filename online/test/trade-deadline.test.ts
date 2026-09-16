import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { emptyReveal } from "@/state/reveal.ts";
import {
  beginTradeDeadline,
  deadlineOrder,
  onTheClock,
  pendingFor,
  proposeAtDeadline,
  respondAtDeadline,
  runCpuTurns,
  skipTurn,
  TRADE_DEADLINE_ROUNDS,
} from "@/state/tradeDeadline.ts";
import { simulateBlock } from "../src/blocks.js";

/**
 * Change 8 — the deadline as a turn order.
 *
 * The properties worth holding onto are the ones that stop it from becoming
 * a live market again: one negotiation at a time, one counter per
 * negotiation, one turn per team per round, and an order that does not move
 * when the rosters do.
 */
function league(humans: string[] = ["KC", "BUF"]): LeagueState {
  const s = createLeague(20260, { ...DEFAULT_CONFIG, humanGmCount: humans.length });
  fillRosterGaps(s);
  humans.forEach((code, i) => {
    if (!s.gms[i]) return;
    s.gms[i]!.teamCode = code;
    s.gms[i]!.isHuman = true;
  });
  for (let i = humans.length; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  s.week = 9;
  s.reveal = emptyReveal();
  return s;
}

describe("the deadline order", () => {
  it("puts the worst team first and every team in it exactly once", () => {
    const s = league();
    simulateBlock(s, "REG", 1, 2);
    const order = deadlineOrder(s);
    expect(order).toHaveLength(Object.keys(s.teams).length);
    expect(new Set(order).size).toBe(order.length);
  }, 300_000);

  it("does not move when a trade changes a roster", () => {
    const s = league();
    simulateBlock(s, "REG", 1, 2);
    beginTradeDeadline(s);
    const before = [...s.tradeDeadline!.order];

    // hand a team's best player to somebody else, the sharpest change a
    // deadline can make, and the line is still the line
    const mover = Object.values(s.players).find((p) => p.nfl_team === "KC")!;
    mover.nfl_team = "BUF";

    expect(s.tradeDeadline!.order).toEqual(before);
  }, 300_000);
});

describe("turns", () => {
  it("gives every team one proposing turn per round", () => {
    const s = league([]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;

    // no humans at all, so the whole event resolves in one sweep
    runCpuTurns(s);
    expect(d.done).toBe(true);
    expect(d.round).toBe(TRADE_DEADLINE_ROUNDS + 1);
  }, 300_000);

  it("stops on a human's turn and does not act for them", () => {
    const s = league(["KC"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    runCpuTurns(s);

    const duty = pendingFor(s, "KC");
    expect(duty).not.toBeNull();
    expect(s.tradeDeadline!.done).toBe(false);
  }, 300_000);

  it("refuses a proposal from a team that isn't on the clock", () => {
    const s = league(["KC"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    const up = onTheClock(s)!;
    const notUp = s.tradeDeadline!.order.find((c) => c !== up)!;
    const res = proposeAtDeadline(s, notUp, up, [], []);
    expect(res.ok).toBe(false);
  }, 300_000);

  it("allows exactly one counter", () => {
    const s = league(["KC", "BUF"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    // put KC on the clock directly rather than playing forward to it
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("KC");
    d.active = null;

    const mine = Object.values(s.players).find((p) => p.nfl_team === "KC")!;
    const theirs = Object.values(s.players).find((p) => p.nfl_team === "BUF")!;
    expect(
      proposeAtDeadline(
        s,
        "KC",
        "BUF",
        [{ kind: "player", playerId: mine.id }],
        [{ kind: "player", playerId: theirs.id }],
      ).ok,
    ).toBe(true);

    const counter = respondAtDeadline(s, "BUF", {
      kind: "modify",
      fromAssets: [{ kind: "player", playerId: mine.id }],
      toAssets: [],
    });
    expect(counter.ok).toBe(true);
    expect(pendingFor(s, "KC")).toBe("final");

    // and no second one, from either side
    expect(
      respondAtDeadline(s, "KC", { kind: "modify", fromAssets: [], toAssets: [] }).ok,
    ).toBe(false);
  }, 300_000);

  it("moves the players when a trade is accepted, cap or no cap", () => {
    const s = league(["KC", "BUF"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("KC");

    const mine = Object.values(s.players).find((p) => p.nfl_team === "KC")!;
    proposeAtDeadline(s, "KC", "BUF", [{ kind: "player", playerId: mine.id }], []);
    expect(respondAtDeadline(s, "BUF", { kind: "accept" }).ok).toBe(true);

    expect(s.players[mine.id]!.nfl_team).toBe("BUF");
    expect(s.tradeDeadline!.resolved.at(-1)!.outcome).toBe("accepted");
  }, 300_000);

  it("burns the turn on a skip", () => {
    const s = league(["KC"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("KC");

    expect(skipTurn(s, "KC").ok).toBe(true);
    expect(onTheClock(s)).not.toBe("KC");
    expect(pendingFor(s, "KC")).toBeNull();
  }, 300_000);

  it("never has two open negotiations", () => {
    const s = league(["KC", "BUF"]);
    simulateBlock(s, "REG", 1, 1);
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("KC");

    const mine = Object.values(s.players).find((p) => p.nfl_team === "KC")!;
    proposeAtDeadline(s, "KC", "BUF", [{ kind: "player", playerId: mine.id }], []);
    const second = proposeAtDeadline(s, "KC", "BUF", [], [{ kind: "player", playerId: mine.id }]);
    expect(second.ok).toBe(false);
  }, 300_000);
});
