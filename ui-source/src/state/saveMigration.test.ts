import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { CURRENT_SAVE_VERSION, migrateLeagueSave, upgradeLeagueState } from "./saveMigration.ts";

/**
 * `migrateLeagueSave` backfills `depthChart` and `draftPicks`, added after
 * leagues could already be under way — a save written before either existed
 * has neither, and nothing else would ever grow them for a league already
 * mid-season. The save/load spec's migration tests ask for exactly this:
 * load a fixture from an old version, migrate it, and check the invariant
 * that migration promises holds afterward.
 */
describe("migrateLeagueSave", () => {
  it("backfills a missing depth chart and draft picks from a pre-version-3 save", () => {
    const s = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    // simulate an old save: strip what version 3 introduced
    const old = { ...s, depthChart: undefined, draftPicks: {} };

    const migrated = migrateLeagueSave(old, 2);

    expect(migrated.depthChart).toEqual({});
    expect(Object.keys(migrated.draftPicks).length).toBeGreaterThan(0);
  });

  it("does not touch draftPicks a current-version save already has", () => {
    const s = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    const before = s.draftPicks;

    const migrated = migrateLeagueSave(s, CURRENT_SAVE_VERSION);

    expect(migrated.draftPicks).toBe(before);
  });

  it("is idempotent — migrating an already-migrated save changes nothing further", () => {
    const s = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    const old = { ...s, depthChart: undefined, draftPicks: {} };

    const once = migrateLeagueSave(old, 2);
    const pickCountAfterOnce = Object.keys(once.draftPicks).length;
    const twice = migrateLeagueSave(once, 2);

    expect(Object.keys(twice.draftPicks).length).toBe(pickCountAfterOnce);
  });

  it("round-trips something that plainly isn't a league save without throwing", () => {
    expect(migrateLeagueSave(undefined, 0)).toBeUndefined();
    expect(migrateLeagueSave(null, 0)).toBeNull();
    expect(migrateLeagueSave({}, 0)).toEqual({});
  });
});

/**
 * Loading a save never regenerates its schedule. Schedules are generated when a league is created and at each season
 * rollover (for the next season only); `migrateLeagueSave` and `upgradeLeagueState` (also what the league server runs
 * on every read) do not touch `schedule`. The week solver's tie-break changed (docs/decisions.md), so a save made
 * before the change stores a layout the current solver cannot produce — and must keep playing it.
 */
describe("loading a save keeps its stored schedule", () => {
  const legacy = JSON.parse(readFileSync(new URL("../../../test/fixtures/legacy-schedule-2026.json", import.meta.url), "utf8")) as {
    games: [number, string, string][];
  };
  const fromEngine = (c: string) => (c === "LA" ? "LAR" : c);
  const stored = legacy.games.map(([week, home, away]) => ({ week, phase: "REG" as const, homeTeam: fromEngine(home), awayTeam: fromEngine(away) }));

  it("is a layout a freshly created league does not get", () => {
    const fresh = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 }).schedule.filter((g) => g.phase === "REG");
    expect(fresh).toHaveLength(stored.length);
    expect(JSON.stringify(fresh)).not.toBe(JSON.stringify(stored));
  });

  it.each([1, 2, 3, CURRENT_SAVE_VERSION])("survives migration from save version %i, through the JSON the save is stored as", (version) => {
    const s = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    s.schedule = structuredClone(stored);
    const persisted = JSON.parse(JSON.stringify(s));
    const loaded = migrateLeagueSave(persisted, version);
    expect(loaded.schedule).toEqual(stored);
  });

  it("survives the upgrade the league server runs on every read, however many times", () => {
    const s = createLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(s);
    s.schedule = structuredClone(stored);
    upgradeLeagueState(s);
    upgradeLeagueState(s);
    expect(s.schedule).toEqual(stored);
  });
});
