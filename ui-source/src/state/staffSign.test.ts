import { describe, expect, it } from "vitest";

import { chooseGmStrategy } from "./aiGms";
import { identityGroups, unitAverages } from "./draftIdentity";
import { beginFreeAgencyEvent, chooseFaMove, cpuTurn, onTheClock, unsignedPool } from "./freeAgencyEvent";
import { beginTradeDeadline, pendingFor, staffDeadlineMove } from "./tradeDeadline";
import { createLeague, fillRosterGaps } from "./seed";
import { beginDraft, planAutopicks } from "./rules";
import type { LeagueState } from "@/domain";

function leagueWithHuman(code = "KC"): LeagueState {
  const s = createLeague(5);
  fillRosterGaps(s);
  s.gms[0]!.teamCode = code;
  s.gms[0]!.isHuman = true;
  s.teams[code]!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  return s;
}

describe("the draft summary by GM identity", () => {
  it("groups teams by what their GM prioritizes, ranks inside each group, and keeps people private", () => {
    const s = leagueWithHuman();
    const groups = identityGroups(s);
    const humans = groups.find((g) => g.key === "human")!;
    expect(humans.teams.map((t) => t.code)).toEqual(["KC"]);
    // every team is in exactly one group
    const codes = groups.flatMap((g) => g.teams.map((t) => t.code));
    expect(new Set(codes).size).toBe(Object.keys(s.teams).length);
    // ranks run 1..n inside a group, best first
    for (const g of groups) {
      expect(g.teams.map((t) => t.groupRank)).toEqual(g.teams.map((_, i) => i + 1));
      for (let i = 1; i < g.teams.length; i++) expect(g.teams[i - 1]!.overall).toBeGreaterThanOrEqual(g.teams[i]!.overall);
    }
    // the human's chosen identity never shows up as a group
    chooseGmStrategy(s, s.gms[0]!.id, "trenches_first");
    const after = identityGroups(s);
    expect(after.find((g) => g.key === "human")!.teams[0]!.code).toBe("KC");
  });

  it("measures units by their starters", () => {
    const s = leagueWithHuman();
    const u = unitAverages(Object.values(s.players), "KC");
    for (const v of Object.values(u)) expect(v).toBeGreaterThan(30);
  });
});

describe("a staff taking a GM's turn", () => {
  it("proposes a free-agency move the human could have made, and the same every time", () => {
    const s = leagueWithHuman();
    beginFreeAgencyEvent(s);
    expect(unsignedPool(s).length).toBeGreaterThan(0);
    const a = chooseFaMove(s, "KC");
    const b = chooseFaMove(s, "KC");
    expect(a).toEqual(b);
    if (a.kind === "offer") {
      expect(s.players[a.playerId]).toBeDefined();
      expect(a.salary).toBeGreaterThan(0);
      expect(a.years).toBeGreaterThanOrEqual(2);
    }
    // choosing changes nothing
    const before = JSON.stringify(s.freeAgencyEvent);
    chooseFaMove(s, "KC");
    expect(JSON.stringify(s.freeAgencyEvent)).toBe(before);
  });

  it("a CPU team's turn is its staff's choice, applied", () => {
    const s = leagueWithHuman();
    beginFreeAgencyEvent(s);
    const clock = onTheClock(s)!;
    const planned = chooseFaMove(s, clock);
    cpuTurn(s, clock);
    const offered = Object.values(s.freeAgencyEvent!.offers ?? {}).flat().some((o: { teamCode: string }) => o.teamCode === clock);
    expect(offered).toBe(planned.kind === "offer");
  });

  it("a different GM identity leans a different way on the same board (a preference, so across the league, not every team)", () => {
    const s = leagueWithHuman("DAL");
    beginFreeAgencyEvent(s);
    const teams = Object.keys(s.teams).filter((c) => c !== "DAL");
    const choose = (strategy: "pass_heavy" | "defense_heavy") =>
      teams.map((c) => {
        s.aiGms!.find((g) => g.teamCode === c)!.strategy = strategy;
        const m = chooseFaMove(s, c);
        return m.kind === "offer" ? m.playerId : "pass";
      });
    const a = choose("pass_heavy");
    const b = choose("defense_heavy");
    const differ = a.filter((x, i) => x !== b[i]).length;
    expect(differ).toBeGreaterThan(0);
    // ... but it is a tie-breaker: most teams still want the same man
    expect(differ).toBeLessThan(teams.length * 0.8);
  });

  it("at the deadline, proposes or answers by the same read of the trade a CPU team uses", () => {
    const s = leagueWithHuman("BUF");
    s.stage = "tradeDeadline";
    beginTradeDeadline(s);
    // put the human on the clock and give them an offer to answer
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("BUF");
    expect(pendingFor(s, "BUF")).toBe("propose");
    const move = staffDeadlineMove(s, "BUF")!;
    expect(["propose", "skip"]).toContain(move.kind);
    expect(move.summary.length).toBeGreaterThan(5);
  });
});

describe("a person's identity steers their fantasy-draft auto-picks", () => {
  it("a trenches-first GM's auto-picks take more linemen than a pass-heavy GM's, on the same board", () => {
    const trench = new Set(["OT", "OG", "C", "EDGE", "DT"]);
    const skill = new Set(["QB", "WR", "TE", "RB"]);
    const picksFor = (strategy: "trenches_first" | "pass_heavy") => {
      const s = leagueWithHuman("KC");
      s.gms[0]!.strategy = strategy;
      beginDraft(s, "fantasy");
      const d = s.draft!;
      const ids = planAutopicks(s);
      const start = d.currentPickIndex;
      const mine = ids.filter((_, i) => d.pickOrder[start + i] === "KC");
      // the rounds where he's choosing, not filling the roster's holes
      return mine.slice(0, 14).map((id) => s.players[id]?.position ?? s.draftClass.find((p) => p.id === id)?.position);
    };
    const a = picksFor("trenches_first");
    const b = picksFor("pass_heavy");
    const share = (xs: (string | undefined)[], set: Set<string>) => xs.filter((p) => p && set.has(p)).length / Math.max(1, xs.length);
    expect(a.length).toBe(14);
    expect(share(a, trench)).toBeGreaterThan(share(b, trench));
    expect(share(b, skill)).toBeGreaterThan(share(a, skill));
  }, 120000);
});
