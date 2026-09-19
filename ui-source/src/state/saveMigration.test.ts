import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { CURRENT_SAVE_VERSION, migrateLeagueSave } from "./saveMigration.ts";

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
