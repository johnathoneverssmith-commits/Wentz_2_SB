import { describe, expect, it } from "vitest";

import type { LeagueState, TradeAsset } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { ensureDraftPicks, pickKey, picksOwnedBy } from "@/state/draftPicks.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { beginTradeDeadline, runCpuTurns as runDeadlineTurns } from "@/state/tradeDeadline.ts";
import { judgeTrade, tradeAccepts } from "@/state/tradeModel.ts";

import { clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";
import { decideProposeTrade } from "../src/decide.js";

/**
 * The CPU's trade decision, online. The league server answers a person's offer to a CPU team on the spot, the deadline answers for the
 * CPU teams in its sweep, and both ask the model in `state/tradeModel.ts`; they have to agree with it and with each other, and a league
 * written out and read back (as the server keeps it) has to trade the same way.
 */
const sim = new MockSimulationService();

function league(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  ensureDraftPicks(s, s.season);
  recomputeTeamRatings(s);
  return s;
}

const kc = { userId: "u", leagueId: "l", teamCode: "KC", gmId: "gm_kc" };

describe("a person's offer to a CPU team, online", () => {
  it("is answered as the model says, and as the deadline would answer it", () => {
    const base = league(4401);
    // a roster spot for the player they would take back: a 53-man team cannot add one for picks
    const spare = Object.values(base.players).filter((p) => p.nfl_team === "KC" && !p.retired && !p.free_agent).sort((a, b) => a.overall - b.overall)[0]!;
    spare.free_agent = true;
    spare.nfl_team = "FA";
    const theirs = Object.values(base.players).filter((p) => p.nfl_team === "GB" && !p.retired && !p.free_agent).sort((a, b) => b.overall - a.overall);
    const want: TradeAsset = { kind: "player", playerId: theirs[1]!.id };
    const picks = picksOwnedBy(base, "KC");
    const seen = { yes: 0, no: 0 };
    for (const n of [1, 2, 3, 5, 8, 12]) {
      if (n > picks.length) continue;
      const give: TradeAsset[] = picks.slice(0, n).map((pick) => ({ kind: "pick", pick }));
      const decided = tradeAccepts(judgeTrade(base, "KC", "GB", give, [want]).acceptLikelihood);

      // the league server
      const online = structuredClone(base);
      try {
        decideProposeTrade(online, kc, `t${n}`, "GB", give.map((a) => `pick:${pickKey(a.pick!.year, a.pick!.round, a.pick!.originalTeam)}`), [want.playerId!]);
      } catch (e) {
        void e;
        continue; // not a legal deal on this league (roster or cap): nothing to compare
      }
      const answered = online.trades.find((t) => t.id === `t${n}`)!;
      expect(answered.status === "accepted", `${n} picks`).toBe(decided);

      // the deadline, with the same offer in front of the same team
      const deadline = structuredClone(base);
      for (const g of deadline.gms) g.isHuman = false;
      for (const t of Object.values(deadline.teams)) t.controlledBy = { kind: "ai" };
      beginTradeDeadline(deadline);
      const d = deadline.tradeDeadline!;
      d.order = ["KC", ...d.order.filter((c) => c !== "KC")];
      d.active = { id: "probe", fromTeam: "KC", toTeam: "GB", fromAssets: give, toAssets: [want], awaiting: "recipient", modified: false, round: 1 };
      runDeadlineTurns(deadline);
      expect(d.resolved.find((r) => r.id === "probe")!.outcome === "accepted", `${n} picks at the deadline`).toBe(decided);
      if (decided) seen.yes++;
      else seen.no++;
    }
    expect(seen.yes + seen.no, "some offers were legal and compared").toBeGreaterThan(2);
  }, 300_000);
});

describe("CPU trades through the server's season", () => {
  it("come out the same for a league and its saved-and-reloaded copy", () => {
    const make = (): LeagueState => {
      const s = league(4402);
      // every team a CPU team: the deadline plays out in full, which a person on the clock would stop
      for (const g of s.gms) g.isHuman = false;
      for (const t of Object.values(s.teams)) t.controlledBy = { kind: "ai" };
      s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
      s.stage = "preseason";
      s.week = 1;
      clearReadinessOnline(s);
      return s;
    };
    const direct = make();
    const reloaded = JSON.parse(JSON.stringify(direct)) as LeagueState;
    const run = (s: LeagueState): string => {
      let guard = 0;
      while (s.stage !== "playoffs") {
        if (guard++ > 80) throw new Error("never reached the playoffs");
        finishPlayedWeek(s);
      }
      return JSON.stringify(s.tradeDeadline?.resolved.map((r) => [r.fromTeam, r.toTeam, r.outcome, r.fromAssets, r.toAssets]) ?? []);
    };
    const a = run(direct);
    const b = run(reloaded);
    expect(b).toBe(a);
    expect(JSON.parse(a).length, "the CPU teams traded").toBeGreaterThan(0);
  }, 600_000);
});
