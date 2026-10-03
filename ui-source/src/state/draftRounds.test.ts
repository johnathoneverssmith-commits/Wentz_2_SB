import { describe, expect, it } from "vitest";

import { ROSTER_TEMPLATE } from "@/sim/roster-template";

import { DRAFT_ROUNDS } from "./draftPicks.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * The fantasy draft has no length setting: the GMs make their manual picks
 * and the draft then carries on until every team holds a full 53-man roster,
 * built to the roster template.
 */
const s = () => useStore.getState();
const ROSTER = ROSTER_TEMPLATE.reduce((n, r) => n + r.count, 0);

describe("the fantasy draft fills every roster", () => {
  it("runs a round per roster spot and ends with 53-man, template-shaped rosters", async () => {
    await useStore.getState().newLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("fantasy");
    const teams = Object.keys(s().teams).length;
    expect(s().draft!.pickOrder.length).toBe(teams * ROSTER);

    const t0 = Date.now();
    useStore.getState().autopickRemaining();
    const ms = Date.now() - t0;
    expect(s().draft!.currentPickIndex).toBe(teams * ROSTER);

    const byTeam = new Map<string, Map<string, number>>();
    for (const p of Object.values(s().players)) {
      if (p.retired || p.free_agent || !p.nfl_team) continue;
      const m = byTeam.get(p.nfl_team) ?? new Map<string, number>();
      m.set(p.position, (m.get(p.position) ?? 0) + 1);
      byTeam.set(p.nfl_team, m);
    }
    for (const [team, m] of byTeam) {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      expect(total, `${team} roster size`).toBe(ROSTER);
      for (const r of ROSTER_TEMPLATE) expect(m.get(r.pos) ?? 0, `${team} ${r.pos}`).toBe(r.count);
    }
    // the whole board in one pass has to stay quick enough for a free-tier server
    expect(ms, "auto-completing the board").toBeLessThan(60_000);
  }, 180_000);

  it("takes manual picks first, then completes the board by itself", async () => {
    await useStore.getState().newLeague(11, { ...DEFAULT_CONFIG, humanGmCount: 1, draftSimulateAfterPicks: 3 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("fantasy");
    for (let i = 0; i < 3; i++) {
      const next = s().draft!.pickOrder[s().draft!.currentPickIndex];
      expect(next, "GB owes its manual picks first").toBe("GB");
      const id = Object.values(s().players).find((p) => !s().draft!.results.some((r) => r.selectedId === p.id) && !p.retired)!.id;
      useStore.getState().makePick(id);
    }
    expect(s().draft!.currentPickIndex, "the draft carried on to the end after the manual picks").toBe(
      s().draft!.pickOrder.length,
    );
  }, 180_000);

  it("leaves the rookie draft at its seven NFL rounds", async () => {
    await useStore.getState().newLeague(6, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("rookie");
    const teams = Object.keys(s().teams).length;
    expect(s().draft!.pickOrder.length).toBe(teams * DRAFT_ROUNDS);
  }, 120_000);
});
