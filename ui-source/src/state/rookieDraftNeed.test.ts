import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A rookie draft fills needs, it doesn't repeat one.
 *
 * Drafted prospects stay in the draft class until signing, so need read from
 * rosters alone never moved during a draft and every team kept taking the
 * same position — four running backs, five receivers, five outside
 * linebackers in seven rounds. `draftedThisDraft` counts a team's own picks.
 */
const s = () => useStore.getState();

describe("rookie draft need", () => {
  it("never has a team take one position more than three times in seven rounds", async () => {
    await useStore.getState().newLeague(12, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("rookie");
    useStore.getState().autopickRemaining();

    const pos = new Map(s().draftClass.map((p) => [p.id, p.position]));
    const worst: string[] = [];
    const byTeam = new Map<string, Map<string, number>>();
    for (const r of s().draft!.results) {
      const p = pos.get(r.selectedId ?? "");
      if (!p) continue;
      const m = byTeam.get(r.teamCode) ?? new Map<string, number>();
      m.set(p, (m.get(p) ?? 0) + 1);
      byTeam.set(r.teamCode, m);
    }
    for (const [team, m] of byTeam) for (const [p, n] of m) if (n > 3) worst.push(`${team} ${n}x ${p}`);
    expect(worst).toEqual([]);
  }, 180_000);
});
