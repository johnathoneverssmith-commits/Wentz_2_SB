import { describe, expect, it } from "vitest";

import { DRAFT_ROUNDS } from "./draftPicks.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * The fantasy draft runs the number of rounds the league asked for.
 *
 * It used to be hard-coded to twenty in `beginDraft`, and separately
 * hard-coded to twenty again in the Draft Room's "Round X of 20" header, with
 * no setting behind either. A commissioner picking a shorter draft is picking
 * how much of the roster they build by hand, so the board has to match.
 */
const s = () => useStore.getState();

function boardFor(rounds: number): { picks: number; teams: number } {
  const teams = Object.keys(s().teams).length;
  useStore.setState((d) => {
    d.config.fantasyDraftRounds = rounds;
    d.draft = null;
  });
  useStore.getState().startDraft("fantasy");
  return { picks: s().draft!.pickOrder.length, teams };
}

describe("fantasy draft length follows the setting", () => {
  it("builds exactly as many rounds as the league selected", async () => {
    await useStore.getState().newLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");

    for (const rounds of [5, 12, 20, 30]) {
      const { picks, teams } = boardFor(rounds);
      expect(picks, `${rounds}-round board`).toBe(teams * rounds);
      // every team picks the same number of times, whatever the length
      const counts = new Map<string, number>();
      for (const code of s().draft!.pickOrder) counts.set(code, (counts.get(code) ?? 0) + 1);
      expect(new Set(counts.values()), `${rounds}-round per-team counts`).toEqual(new Set([rounds]));
    }
  }, 120_000);

  it("actually drafts that many players per team, not just plans to", async () => {
    // The board length is one thing; what the draft *does* is another. A
    // five-round draft has to end after five rounds and leave every team
    // holding five new men, or the setting is decorative.
    await useStore.getState().newLeague(11, {
      ...DEFAULT_CONFIG,
      humanGmCount: 1,
      fantasyDraftRounds: 5,
    });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("fantasy");
    useStore.getState().autopickRemaining();

    const teams = Object.keys(s().teams).length;
    expect(s().draft!.currentPickIndex, "a five-round draft never finished").toBe(teams * 5);
    expect(s().draft!.results.length).toBe(teams * 5);

    const rostered = new Map<string, number>();
    for (const p of Object.values(s().players)) {
      if (p.retired || p.free_agent || !p.nfl_team) continue;
      rostered.set(p.nfl_team, (rostered.get(p.nfl_team) ?? 0) + 1);
    }
    expect(new Set(rostered.values()), "per-team roster after a 5-round draft").toEqual(
      new Set([5]),
    );
  }, 120_000);

  it("leaves the rookie draft at its seven NFL rounds regardless", async () => {
    await useStore.getState().newLeague(6, {
      ...DEFAULT_CONFIG,
      humanGmCount: 1,
      fantasyDraftRounds: 30,
    });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      d.draft = null;
    });
    useStore.getState().startDraft("rookie");
    const teams = Object.keys(s().teams).length;
    expect(s().draft!.pickOrder.length).toBe(teams * DRAFT_ROUNDS);
  }, 120_000);

  it("falls back to twenty for a save written before the setting existed", async () => {
    await useStore.getState().newLeague(7, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.setState((d) => {
      // exactly what an older save rehydrates as
      delete (d.config as Partial<typeof d.config>).fantasyDraftRounds;
      d.draft = null;
    });
    useStore.getState().startDraft("fantasy");
    const teams = Object.keys(s().teams).length;
    expect(s().draft!.pickOrder.length).toBe(teams * 20);
  }, 120_000);
});
