import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { beginTradeDeadline, leagueVoteBlock, proposeAtDeadline, respondAtDeadline } from "./tradeDeadline.ts";

/**
 * Two GMs moved a 97-rated tackle for a seventh-round pick at the deadline,
 * and nothing stopped it: the league vote only guarded ordinary trades.
 */
describe("the league vote at the trade deadline", () => {
  it("blocks a fleecing between two GMs that involves a 90-plus player", () => {
    const s = createLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
    fillRosterGaps(s);
    const [a, b] = s.gms;
    a!.isHuman = true;
    a!.teamCode = "GB";
    b!.isHuman = true;
    b!.teamCode = "KC";
    for (const g of s.gms.slice(2)) g.isHuman = false;
    s.stage = "tradeDeadline";
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;
    d.index = d.order.indexOf("GB");

    const star = Object.values(s.players)
      .filter((p) => p.nfl_team === "KC" && !p.retired)
      .sort((x, y) => y.overall - x.overall)[0]!;
    expect(star.overall).toBeGreaterThanOrEqual(90);
    const pick = Object.values(s.draftPicks ?? {}).find((p) => p.ownedBy === "GB" && p.round === 7)!;
    const give = [{ kind: "pick" as const, pick }];
    const get = [{ kind: "player" as const, playerId: star.id }];
    expect(leagueVoteBlock(s, "GB", "KC", give, get)).toMatch(/collusion/);

    expect(proposeAtDeadline(s, "GB", "KC", give, get).ok).toBe(true);
    const res = respondAtDeadline(s, "KC", { kind: "accept" });
    expect(res.ok).toBe(true);
    expect(res.blocked).toMatch(/collusion/);
    expect(s.players[star.id]!.nfl_team).toBe("KC");
    expect(d.resolved.at(-1)?.outcome).toBe("denied");
  });
});
