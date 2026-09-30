import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { beginTradeDeadline, pendingFor, respondAtDeadline, runCpuTurns, skipTurn } from "./tradeDeadline.ts";

/**
 * A GM who turned a team down for a player was asked for him again by the
 * same team a round later — the same offer, word for word (Tennessee,
 * Bowers, rounds 1 and 3).
 */
describe("CPU offers at the deadline", () => {
  it("never re-ask a GM for a player they already refused that team", () => {
    const s = createLeague(21, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
    fillRosterGaps(s);
    const gm = s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    for (const g of s.gms.slice(1)) g.isHuman = false;
    Object.keys(s.teams).forEach((c, i) => {
      const [w, l] = i % 2 === 0 ? [6, 3] : [3, 6];
      s.teams[c]!.wins = w;
      s.teams[c]!.losses = l;
    });
    s.stage = "tradeDeadline";
    beginTradeDeadline(s);
    runCpuTurns(s);
    const d = s.tradeDeadline!;
    for (let guard = 0; guard < 200 && pendingFor(s, "GB") === "propose"; guard++) {
      skipTurn(s, "GB");
      runCpuTurns(s);
    }
    expect(pendingFor(s, "GB")).toBe("respond");
    const refused = structuredClone(d.active!);
    const { round, index } = d;
    respondAtDeadline(s, "GB", { kind: "deny" });

    // the same team, the same turn, the same everything — the one thing
    // that's changed is that GB has said no
    d.round = round;
    d.index = index;
    d.active = null;
    const before = d.resolved.length;
    runCpuTurns(s);

    const again = [...d.resolved.slice(before), ...(d.active ? [d.active] : [])].filter(
      (o) => o.fromTeam === refused.fromTeam && o.toTeam === "GB",
    );
    const asked = new Set(refused.toAssets.map((a) => a.playerId ?? JSON.stringify(a.pick)));
    for (const o of again) {
      expect(o.toAssets.some((a) => asked.has(a.playerId ?? JSON.stringify(a.pick)))).toBe(false);
    }
  });
});
