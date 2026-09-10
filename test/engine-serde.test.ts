import { describe, expect, it } from "vitest";

import { startPlayoffs } from "../src/engine/playoffs.js";
import { playThroughWeek, startSeason } from "../src/engine/season.js";
import {
  SAVE_VERSION,
  deserializePlayoffs,
  deserializeSeason,
  priorRankFromObj,
  priorRankToObj,
  serializePlayoffs,
  serializeSeason,
} from "../src/engine/serde.js";
import type { ConferenceSeeding } from "../src/engine/standings.js";

/**
 * Phase A1: save/load for the engine loops. The states are plain JSON, so the
 * job here is a clean round-trip plus loud failure on stale / corrupt / mixed-up
 * saves. `playThroughWeek(0)` = a no-op (no sim), so these stay pool-free.
 */

const mkSeeding = (teams: string[]): ConferenceSeeding => ({
  seeds: teams,
  divisionWinners: teams.slice(0, 4),
  wildCards: teams.slice(4),
});

describe("serde — season", () => {
  const p = startSeason(7, { year: 2026 });

  it("round-trips a fresh SeasonProgress", () => {
    expect(deserializeSeason(serializeSeason(p))).toEqual(p);
  });

  it("stamps the current save version", () => {
    expect(JSON.parse(serializeSeason(p)).v).toBe(SAVE_VERSION);
  });

  it("rejects a stale version", () => {
    const bad = JSON.stringify({ v: SAVE_VERSION + 1, kind: "season", data: p });
    expect(() => deserializeSeason(bad)).toThrow(/save version/);
  });

  it("rejects a playoffs save fed to the season loader", () => {
    const po = serializePlayoffs(startPlayoffs(1, { AFC: mkSeeding(["A", "B", "C", "D", "E", "F", "G"]), NFC: mkSeeding(["H", "I", "J", "K", "L", "M", "N"]) }));
    expect(() => deserializeSeason(po)).toThrow(/expected a season save/);
  });

  it("rejects a results/nextWeek mismatch", () => {
    const tampered = { ...p, nextWeek: 5 }; // still 0 results
    const bad = JSON.stringify({ v: SAVE_VERSION, kind: "season", data: tampered });
    expect(() => deserializeSeason(bad)).toThrow(/results but weeks/);
  });

  it("rejects non-JSON and a truncated schedule", () => {
    expect(() => deserializeSeason("{not json")).toThrow(/not valid JSON/);
    const bad = JSON.stringify({
      v: SAVE_VERSION,
      kind: "season",
      data: { ...p, schedule: p.schedule.slice(0, 100) },
    });
    expect(() => deserializeSeason(bad)).toThrow(/272/);
  });

  it("survives a save mid-schedule (pointer only, no sim)", () => {
    const advanced = playThroughWeek(p, 0); // nextWeek stays 1, results empty
    expect(deserializeSeason(serializeSeason(advanced))).toEqual(advanced);
  });
});

describe("serde — playoffs", () => {
  const pp = startPlayoffs(3, {
    AFC: mkSeeding(["KC", "BUF", "BAL", "HOU", "LAC", "PIT", "DEN"]),
    NFC: mkSeeding(["DET", "PHI", "TB", "LA", "MIN", "GB", "SEA"]),
  });

  it("round-trips a fresh PlayoffProgress", () => {
    expect(deserializePlayoffs(serializePlayoffs(pp))).toEqual(pp);
  });

  it("rejects a season save fed to the playoff loader", () => {
    expect(() => deserializePlayoffs(serializeSeason(startSeason(1, { year: 2026 })))).toThrow(
      /expected a playoffs save/,
    );
  });
});

describe("serde — priorRank bridge", () => {
  it("round-trips through a plain object", () => {
    const m = new Map([
      ["BUF", 1],
      ["MIA", 3],
      ["NE", 2],
      ["NYJ", 4],
    ]);
    expect(priorRankFromObj(priorRankToObj(m))).toEqual(m);
    expect(JSON.parse(JSON.stringify(priorRankToObj(m)))).toEqual({ BUF: 1, MIA: 3, NE: 2, NYJ: 4 });
  });
});
