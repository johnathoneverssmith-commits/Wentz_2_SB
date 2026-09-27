import { describe, expect, it } from "vitest";

import type { LeagueState, TradeProposal } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { decideRespondToTrade } from "../src/decide.js";

/**
 * The league vote, online. Single-player fills in the other GMs' ballots and
 * blocks a lopsided blockbuster; online there was no vote at all, so two GMs
 * could hand a 90-plus player over for nothing.
 */
function league(): LeagueState {
  const s = createLeague(515, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  for (let i = 2; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  return s;
}

const roster = (s: LeagueState, team: string) =>
  Object.values(s.players)
    .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent)
    .sort((a, b) => b.overall - a.overall);

function offer(s: LeagueState, give: string[], get: string[]): TradeProposal {
  const t: TradeProposal = {
    id: `t_${give.join("_")}`,
    fromTeam: "KC",
    toTeam: "BUF",
    fromAssets: give.map((playerId) => ({ kind: "player", playerId })),
    toAssets: get.map((playerId) => ({ kind: "player", playerId })),
    aiValueDelta: 0,
    aiAcceptLikelihood: 0.5,
    status: "offered",
  };
  s.trades.push(t);
  return t;
}

const buf = { userId: "u", leagueId: "l", teamCode: "BUF", gmId: "gm_buf" };

describe("a blockbuster between two GMs", () => {
  it("is blocked when it's a giveaway", () => {
    const s = league();
    const star = roster(s, "KC").find((p) => p.overall >= 90);
    expect(star, "fixture needs a 90+ player").toBeTruthy();
    const scrub = roster(s, "BUF").at(-1)!;
    const t = offer(s, [star!.id], [scrub.id]);
    decideRespondToTrade(s, buf, t.id, true);
    expect(t.status).toBe("blocked");
    expect(s.players[star!.id]!.nfl_team).toBe("KC");
  });
});
