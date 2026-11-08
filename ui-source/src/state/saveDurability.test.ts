import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeIDBFactory, quotaStorage } from "./fakeIndexedDb.testutil";

/**
 * GAP-008 at the store level: the real store module, against a browser-shaped `window` (an
 * IndexedDB fake and a 5 MiB localStorage). Each "page load" is a fresh module graph over the same
 * device storage, which is what a reload is.
 */
const SAVE_KEY = "nfl-sim-ui.league";
const BUDGET = 120_000;

type StoreModule = typeof import("./store.ts");
type Device = { idb: FakeIDBFactory; ls: ReturnType<typeof quotaStorage> };

async function pageLoad(dev: Device): Promise<StoreModule> {
  vi.resetModules();
  globalThis.window = { localStorage: dev.ls, indexedDB: dev.idb } as unknown as typeof globalThis.window;
  const m = await import("./store.ts");
  await vi.waitFor(() => {
    let h = false;
    m.onStoreHydrated((x) => (h = x))();
    expect(h).toBe(true);
  });
  return m;
}

describe("durable solo save", () => {
  let originalWindow: typeof globalThis.window;
  let dev: Device;
  beforeEach(() => {
    originalWindow = globalThis.window;
    dev = { idb: new FakeIDBFactory(), ls: quotaStorage() };
  });
  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("a new dynasty is saved to IndexedDB, not localStorage, and survives a reload", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(11);
    const before = a.useStore.getState();
    expect(await a.flushSave()).toBe(true);
    expect(dev.ls.getItem(SAVE_KEY)).toBeNull();
    expect(dev.idb.raw().has(SAVE_KEY)).toBe(true);

    const b = await pageLoad(dev);
    const after = b.useStore.getState();
    expect(after.season).toBe(before.season);
    expect(after.stage).toBe(before.stage);
    expect(Object.keys(after.players)).toHaveLength(Object.keys(before.players).length);
    expect(after.teams).toEqual(before.teams);
  }, BUDGET);

  it("loads a pre-fix localStorage save, migrates it, and keeps playing from it", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(12);
    const league = a.useStore.getState();
    // what the old build wrote: one plain JSON string under the key
    const legacy = JSON.stringify({ state: a.useStore.persist.getOptions().partialize!(league), version: a.useStore.persist.getOptions().version });
    const dev2: Device = { idb: new FakeIDBFactory(), ls: quotaStorage(5_242_875, { [SAVE_KEY]: legacy }) };

    const b = await pageLoad(dev2);
    expect(b.useStore.getState().season).toBe(league.season);
    expect(Object.keys(b.useStore.getState().players)).toHaveLength(Object.keys(league.players).length);
    expect(dev2.ls.getItem(SAVE_KEY)).toBeNull(); // moved, not copied
    expect(dev2.idb.raw().has(SAVE_KEY)).toBe(true);

    // a change after migration is saved and reloads
    b.useStore.setState({ season: league.season + 1 } as never);
    expect(await b.flushSave()).toBe(true);
    const c = await pageLoad(dev2);
    expect(c.useStore.getState().season).toBe(league.season + 1);
  }, BUDGET);

  it("a save too big for localStorage (the reported failure) saves and reloads with no warning", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(13);
    let broken = false;
    a.onSaveStateChange((b) => (broken = b));
    // ~6.5 M characters of extra history, as the real engine produces by season 2, week 16
    const filler = Array.from({ length: 1300 }, (_, i) => ({ id: `g${i}`, blob: `${i}`.repeat(1) + "x".repeat(0) + Math.random().toString(36).repeat(450) }));
    a.useStore.setState({ qaFiller: filler } as never);
    expect(await a.flushSave()).toBe(true);
    expect(broken).toBe(false);
    const stored = JSON.stringify(a.useStore.persist.getOptions().partialize!(a.useStore.getState()));
    expect(stored.length).toBeGreaterThan(5_242_875);

    const b = await pageLoad(dev);
    expect((b.useStore.getState() as unknown as { qaFiller: unknown[] }).qaFiller).toHaveLength(1300);
  }, BUDGET);

  it("storage failure: warning raised, last good save intact, a reload shows it, recovery clears it", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(14);
    const goodSeason = a.useStore.getState().season;
    await a.flushSave();

    let broken = false;
    a.onSaveStateChange((b) => (broken = b));
    dev.idb.faults.quota = true;
    a.useStore.setState({ season: goodSeason + 1 } as never);
    expect(await a.flushSave()).toBe(false);
    expect(broken).toBe(true);
    expect(a.lastSaveError()).toBeTruthy();

    // reload while storage is still failing: the last good save is what loads, and the player is told
    dev.idb.faults.quota = false;
    const b = await pageLoad(dev);
    expect(b.useStore.getState().season).toBe(goodSeason);
    let prior: unknown = null;
    b.onPriorSaveFailure((s) => (prior = s))();
    expect(prior).toMatchObject({ broken: true, okSeason: goodSeason });

    // the next write lands and the flag clears
    b.useStore.setState({ season: goodSeason + 1 } as never);
    expect(await b.flushSave()).toBe(true);
    expect(b.saveStatus().broken).toBe(false);
  }, BUDGET);

  it("restoring an oversized backup works while storage is failing, and reports whether it was saved", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(15);
    const bk = await import("./saveBackup.ts");
    const filler = Array.from({ length: 1300 }, () => ({ blob: Math.random().toString(36).repeat(450) }));
    a.useStore.setState({ qaFiller: filler } as never);
    const { text } = bk.backupJson();
    expect(text.length).toBeGreaterThan(5_242_875);

    // a fresh browser profile whose storage refuses writes
    const dev2: Device = { idb: new FakeIDBFactory(), ls: quotaStorage() };
    const c = await pageLoad(dev2);
    const bk2 = await import("./saveBackup.ts");
    dev2.idb.faults.quota = true;
    const failed = await bk2.restoreFromText(text);
    expect(failed).toMatchObject({ ok: true, saved: false });
    expect(c.useStore.getState().season).toBeGreaterThan(2000); // in memory, playable, and flagged as unsaved

    dev2.idb.faults.quota = false;
    const retry = await bk2.restoreFromText(text);
    expect(retry).toMatchObject({ ok: true, saved: true });
    const d = await pageLoad(dev2);
    expect((d.useStore.getState() as unknown as { qaFiller: unknown[] }).qaFiller).toHaveLength(1300);
  }, BUDGET);

  it("rejects a file that isn't a backup without touching the dynasty", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(16);
    const season = a.useStore.getState().season;
    const bk = await import("./saveBackup.ts");
    expect(await bk.restoreFromText("{\"hello\":1}")).toEqual({ ok: false, reason: "notABackup" });
    expect(await bk.restoreFromText("not json")).toEqual({ ok: false, reason: "unreadable" });
    expect(a.useStore.getState().season).toBe(season);
  }, BUDGET);

  it("a damaged newest save loads the previous one and says so", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(17);
    const base = a.useStore.getState().season;
    await a.flushSave();
    a.useStore.setState({ season: base + 1 } as never);
    await a.flushSave();
    const rec = dev.idb.raw().get(SAVE_KEY) as { sum: number };
    dev.idb.raw().set(SAVE_KEY, { ...rec, sum: rec.sum ^ 1 });

    const b = await pageLoad(dev);
    expect(b.useStore.getState().season).toBe(base);
    let at: unknown = "unset";
    b.onSaveRecovered((x) => (at = x))();
    expect(at).not.toBe("unset");
    expect(dev.idb.raw().has(`${SAVE_KEY}#damaged`)).toBe(true);
  }, BUDGET);

  it("never reports a change as saved before its write has completed", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(18);
    await a.flushSave();
    const bk = await import("./saveBackup.ts");
    const { text } = bk.backupJson();

    // a slow disk: the transaction holds for 400 ms before it commits
    dev.idb.faults.commitDelayMs = 400;
    let resolved = false;
    const restoring = bk.restoreFromText(text).then((r) => {
      resolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(resolved, "restore must not report success while the write is still in flight").toBe(false);
    const r = await restoring;
    expect(r).toMatchObject({ ok: true, saved: true });
    const rec = dev.idb.raw().get(SAVE_KEY) as { savedAt: number };
    expect(rec, "…and by then the record is really there").toBeTruthy();

    // a change made while a write is in flight: flushSave waits for it too, and the save equals the live state
    dev.idb.faults.commitDelayMs = 300;
    a.useStore.setState({ season: 2090 } as never);
    a.useStore.setState({ season: 2091 } as never);
    expect(await a.flushSave()).toBe(true);
    const b = await pageLoad(dev);
    expect(b.useStore.getState().season).toBe(2091);
  }, BUDGET);

  it("reports unsaved (not saved) when the write fails, and keeps saying so until one lands", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(19);
    await a.flushSave();
    const bk = await import("./saveBackup.ts");
    const { text } = bk.backupJson();
    dev.idb.faults.quota = true;
    expect(await bk.restoreFromText(text)).toMatchObject({ ok: true, saved: false });
    expect(await a.flushSave()).toBe(false);
    expect(a.saveStatus().broken).toBe(true);
    dev.idb.faults.quota = false;
    a.useStore.setState({ season: 2092 } as never);
    expect(await a.flushSave()).toBe(true);
    expect(a.saveStatus().broken).toBe(false);
  }, BUDGET);
});
