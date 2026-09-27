import { describe, expect, it } from "vitest";

import type { GameResult, InjuryEvent } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { applyInjuries, healOneWeek, rewindInjuries, snapshotInjuries } from "./injuries.ts";

/**
 * A block applies every week's injuries up front. A GM who hasn't watched a
 * game must not see who got hurt in it.
 */
describe("injury ledger", () => {
  it("shows the injury report as of the watched week", () => {
    const s = createLeague(4, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const rb = Object.values(s.players).find((p) => p.position === "RB" && s.teams[p.nfl_team])!;
    const hurt = (): InjuryEvent =>
      ({
        team: rb.nfl_team,
        playerId: rb.id,
        player: rb.name,
        position: "RB",
        slot: "RB1",
        quarter: 2,
        clock: "8:00",
        bodyPart: "knee",
        suspectedType: "sprain",
        severity: "moderate",
        projectedWeeks: [3, 5],
      }) as InjuryEvent;
    const game = (week: number, injured: boolean): GameResult => ({
      id: `g${week}`,
      week,
      phase: "REG",
      homeTeam: rb.nfl_team,
      awayTeam: "LV",
      played: true,
      homeScore: 20,
      awayScore: 17,
      injuries: injured ? [hurt()] : [],
    });

    // the block, played the way blocks.ts plays it
    snapshotInjuries(s, "REG", 1);
    for (const [week, injured] of [[1, false], [2, true], [3, false]] as const) {
      const g = game(week, injured);
      s.games.push(g);
      applyInjuries(s, [g], s.season);
      healOneWeek(s);
    }
    expect(s.players[rb.id]!.injury_status).not.toBeNull();

    const before = structuredClone(s);
    rewindInjuries(before, 1);
    expect(before.players[rb.id]!.injury_status).toBeNull();
    expect(before.players[rb.id]!.injury_history ?? []).toHaveLength(0);

    const through2 = structuredClone(s);
    rewindInjuries(through2, 2);
    expect(through2.players[rb.id]!.injury_status).not.toBeNull();

    // watched the whole block: nothing to rewind
    const all = structuredClone(s);
    rewindInjuries(all, 3);
    expect(all.players[rb.id]!.injury_status).toEqual(s.players[rb.id]!.injury_status);
  });
});
