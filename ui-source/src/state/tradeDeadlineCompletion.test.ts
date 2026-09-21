import { describe, expect, it } from "vitest";

import { beginTradeDeadline, pendingFor, runCpuTurns as runDeadlineTurns } from "./tradeDeadline.ts";
import { useStore } from "./store.ts";

/**
 * Deployed multiplayer playtest finding 16 (September 2026): the trade
 * deadline never transitioned out once round three finished — `d.done` was
 * set but nothing ever read it, and `beginTradeDeadline` was never even
 * called from the single-player store at all (the same "defined in the
 * rules module, never wired into store.ts" pattern this session already
 * found twice, in the fantasy and coaching drafts).
 */
describe("trade deadline completion (single-player store)", () => {
  it("runs to completion and advances the stage once round three finishes", () => {
    const s0 = useStore.getState();
    s0.pickTeam(s0.viewerGmId, "GB");
    useStore.setState((s) => {
      for (const g of s.gms) if (g.id !== s.viewerGmId) g.isHuman = false;
      s.stage = "tradeDeadline";
      beginTradeDeadline(s);
      runDeadlineTurns(s);
    });

    expect(useStore.getState().tradeDeadline).toBeTruthy();

    let guard = 0;
    while (guard++ < 200) {
      const s = useStore.getState();
      if (s.tradeDeadline?.done) break;
      const pending = pendingFor(s, "GB");
      if (!pending) throw new Error("nothing pending but the deadline isn't done");
      if (pending === "propose") {
        const res = useStore.getState().deadlineTurn({ kind: "skip" });
        expect(res.ok).toBe(true);
      } else {
        const res = useStore.getState().deadlineTurn({ kind: "deny" });
        expect(res.ok).toBe(true);
      }
    }

    const s = useStore.getState();
    expect(s.tradeDeadline?.done).toBe(true);
    expect(s.stage).toBe("tradeDeadlineSummary");
  });
});
