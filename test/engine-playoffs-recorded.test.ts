import { describe, expect, it } from "vitest";

import { playPlayoffRound, startPlayoffs, type PlayoffGame, type RecordedPlayoffGame } from "../src/engine/playoffs.js";
import type { ConferenceSeeding } from "../src/engine/standings.js";

/**
 * GAP-011: the adapter replays earlier rounds on every call. If anything the
 * replay depends on has moved (injuries change rosters between rounds), the
 * replay decides earlier games differently. Recorded games must be applied,
 * not re-simulated. A different base seed below stands in for "inputs moved".
 */
const mk = (t: string[]): ConferenceSeeding => ({ seeds: t, divisionWinners: t.slice(0, 4), wildCards: t.slice(4) });
const SEEDING = {
  AFC: mk(["KC", "BUF", "BAL", "HOU", "LAC", "PIT", "DEN"]),
  NFC: mk(["DET", "PHI", "TB", "LA", "MIN", "GB", "SEA"]),
};
const asRecorded = (g: PlayoffGame): RecordedPlayoffGame => g;

describe("recorded playoff games are authoritative", () => {
  for (const seed of [4001, 47547, 11, 202, 3003, 9, 77]) {
    it(`seed ${seed}: five seasons of rounds, replayed on drifted inputs, never contradict the record`, () => {
      for (let season = 0; season < 5; season++) {
        const base = seed + season * 1000;
        // the record: what the UI saw, round by round
        let truth = startPlayoffs(base, SEEDING);
        const record: PlayoffGame[] = [];
        const history: PlayoffGame[][] = [];
        while (truth.nextRound !== "done") {
          const r = playPlayoffRound(truth);
          truth = r.progress;
          record.push(...r.games);
          history.push(r.games);
        }
        // each later call: replay from a *drifted* seed, but pass the record
        let drift = startPlayoffs(base + 7919, SEEDING);
        const seen = new Set<string>();
        for (let i = 0; i < history.length; i++) {
          const prior = history.slice(0, i).flat().map(asRecorded);
          for (let j = 0; j < i; j++) drift = playPlayoffRound(drift, prior).progress;
          const r = playPlayoffRound(drift, prior);
          // this round's pairings and results equal the record's (matchups come from recorded winners)
          const want = history[i]!;
          expect(r.games.map((g) => [g.round, g.home, g.away]).sort()).toEqual(want.map((g) => [g.round, g.home, g.away]).sort());
          // eliminated teams never appear
          const losers = new Set(history.slice(0, i).flat().map((g) => (g.winner === g.home ? g.away : g.home)));
          for (const g of r.games) {
            expect(losers.has(g.home) || losers.has(g.away)).toBe(false);
            const k = `${g.round}|${g.home}|${g.away}`;
            expect(seen.has(k)).toBe(false);
            seen.add(k);
          }
          drift = startPlayoffs(base + 7919, SEEDING);
        }
      }
    });
  }

  it("without a record the replay is unchanged", () => {
    const a = playPlayoffRound(startPlayoffs(5, SEEDING));
    const b = playPlayoffRound(startPlayoffs(5, SEEDING), []);
    expect(b.games).toEqual(a.games);
  });
});
