import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { decideWithdrawTrade } from "../src/decide.js";

/**
 * An offer to another GM used to stay binding until they answered it —
 * sometimes days after the proposer's plans had changed.
 */
const league = (status: string) =>
  ({
    trades: [{ id: "t1", fromTeam: "GB", toTeam: "KC", status, fromAssets: [], toAssets: [] }],
  }) as unknown as LeagueState;
const gb = { userId: "u", leagueId: "l", teamCode: "GB", gmId: "g1" };
const kc = { userId: "u2", leagueId: "l", teamCode: "KC", gmId: "g2" };

describe("withdrawing a trade offer", () => {
  it("takes back your own unanswered offer", () => {
    const s = league("offered");
    decideWithdrawTrade(s, gb, "t1");
    expect(s.trades[0]!.status).toBe("withdrawn");
  });

  it("is only the proposer's to do, and only before it's answered", () => {
    expect(() => decideWithdrawTrade(league("offered"), kc, "t1")).toThrow(/isn't yours/);
    expect(() => decideWithdrawTrade(league("accepted"), gb, "t1")).toThrow(/already been answered/);
    expect(() => decideWithdrawTrade(league("offered"), gb, "nope")).toThrow(/No such offer/);
  });
});
