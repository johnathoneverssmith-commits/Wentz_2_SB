import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { decideProposeTrade } from "../src/decide.js";

/**
 * A trade offered to a CPU team, online. Nothing answered for the CPU: the
 * offer sat as "offered" for ever. It now answers on the spot, as it does in
 * the single-player game.
 */
function league(): LeagueState {
  const s = createLeague(616, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  for (let i = 1; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  s.stage = "offseasonDepthChart";
  // room on both sides, so it's the CPU's judgement being tested, not the cap
  s.teams.KC!.cap.total = 400;
  s.teams.BUF!.cap.total = 400;
  return s;
}

const kc = { userId: "u", leagueId: "l", teamCode: "KC", gmId: "gm_kc" };
const roster = (s: LeagueState, team: string) =>
  Object.values(s.players)
    .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent)
    .sort((a, b) => b.overall - a.overall);

describe("an offer to a CPU team", () => {
  it("is refused on the spot when it's a fleecing", () => {
    const s = league();
    const scrub = roster(s, "KC").at(-1)!;
    const star = roster(s, "BUF")[0]!;
    decideProposeTrade(s, kc, "t1", "BUF", [scrub.id], [star.id]);
    const t = s.trades.find((x) => x.id === "t1")!;
    expect(t.status).toBe("rejected");
    expect(s.players[star.id]!.nfl_team).toBe("BUF");
  });

  it("is accepted on the spot when the CPU comes out ahead, and the players move", () => {
    const s = league();
    const star = roster(s, "KC")[1]!;
    const scrub = roster(s, "BUF").at(-1)!;
    decideProposeTrade(s, kc, "t2", "BUF", [star.id], [scrub.id]);
    const t = s.trades.find((x) => x.id === "t2")!;
    expect(t.status).toBe("accepted");
    expect(s.players[star.id]!.nfl_team).toBe("BUF");
    expect(s.players[scrub.id]!.nfl_team).toBe("KC");
  });

  it("can't be made while a block of games is already played", () => {
    const s = league();
    s.stage = "regularSeason";
    const a = roster(s, "KC").at(-1)!;
    const b = roster(s, "BUF").at(-1)!;
    expect(() => decideProposeTrade(s, kc, "t3", "BUF", [a.id], [b.id])).toThrow(/locked/);
  });
});
