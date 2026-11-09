import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonOutcome } from "@/domain";

import { decodeRecord, undoKey, type SaveRecord } from "./durableSave";
import { FakeIDBFactory, quotaStorage } from "./fakeIndexedDb.testutil";

/**
 * ADV-001 (QA PR #106): "New solo dynasty" overwrote the live save and `#prev` within 300 ms, so a five-season
 * dynasty could not be recovered. The dynasty being replaced is now kept in `<slot>#undo`, which no autosave touches.
 * Browser restarts are modelled as in saveDurability.test.ts: a fresh module graph over the same device storage.
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
const outcome = (season: number): SeasonOutcome => ({
  season, gmId: "g", teamCode: "BAL", madePlayoffs: season % 2 === 0, seed: 2, furthestRound: "WC", wonSuperBowl: false,
  regularSeasonRecord: { wins: 10, losses: 7, ties: 0 }, eliminationMargin: null, pointDifferential: 40, rivalsEliminated: [],
});
/** A dynasty five seasons in: past setup, five seasons of history. */
async function playFiveSeasons(m: StoreModule, seed: number): Promise<void> {
  await m.useStore.getState().newLeague(seed);
  m.useStore.getState().pickTeam(m.useStore.getState().viewerGmId, "BAL");
  m.useStore.setState({ stage: "offseasonHotSeat", season: 2031, history: [2027, 2028, 2029, 2030, 2031].map(outcome) } as never);
  expect(await m.flushSave()).toBe(true);
}
const undoOf = async (dev: Device) => JSON.parse(await decodeRecord(dev.idb.raw().get(undoKey(SAVE_KEY)) as SaveRecord)).state;

describe("recoverable dynasty reset", () => {
  let originalWindow: typeof globalThis.window;
  let dev: Device;
  beforeEach(() => {
    originalWindow = globalThis.window;
    dev = { idb: new FakeIDBFactory(), ls: quotaStorage() };
  });
  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("resetting keeps the multi-season dynasty, and the new league's autosaves cannot overwrite it", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 31);
    const players = Object.keys(a.useStore.getState().players).length;
    expect(await a.keepCurrentDynasty()).toBe("kept");
    await a.useStore.getState().newLeague(77); // the reset
    expect(a.useStore.getState().history).toHaveLength(0);
    // the exact ADV-001 sequence: several saves in quick succession after the reset
    for (let i = 0; i < 6; i++) {
      a.useStore.setState({ week: i } as never);
      await a.flushSave();
    }
    const kept = await undoOf(dev);
    expect(kept.history).toHaveLength(5);
    expect(kept.season).toBe(2031);
    expect(Object.keys(kept.players)).toHaveLength(players);
    // and #prev is, as before, the previous generation of the *live* slot — the undo copy does not depend on it
    expect(dev.idb.raw().has(undoKey(SAVE_KEY))).toBe(true);
  }, BUDGET);

  it("newLeague itself keeps the dynasty (the Setup screen's 'Create league' path), and a second reset does not replace it with an empty league", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 32);
    await a.useStore.getState().newLeague(78);
    await a.flushSave();
    await a.useStore.getState().newLeague(79); // an empty league replaced by another empty one
    await a.flushSave();
    const kept = await undoOf(dev);
    expect(kept.history).toHaveLength(5);
  }, BUDGET);

  it("survives a browser restart, can be previewed, and restoring brings back the whole dynasty", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 33);
    const original = a.useStore.getState();
    const snapshot = { teams: original.teams, season: original.season, stage: original.stage, picks: Object.keys(original.draftPicks).length, hist: original.history };
    await a.useStore.getState().newLeague(80);
    await a.flushSave();

    const b = await pageLoad(dev); // restart
    expect(b.useStore.getState().history).toHaveLength(0);
    const bk = await import("./saveBackup.ts");
    const peek = await bk.peekKeptDynasty();
    expect(peek).toMatchObject({ season: 2031, seasonsPlayed: 5, team: "BAL", stage: "offseasonHotSeat" });
    const r = await bk.restoreKeptDynasty();
    expect(r).toEqual({ ok: true, season: 2031, saved: true, swapped: false });
    const restored = b.useStore.getState();
    expect(restored.teams).toEqual(snapshot.teams);
    expect(restored.stage).toBe(snapshot.stage);
    expect(Object.keys(restored.draftPicks)).toHaveLength(snapshot.picks);
    expect(restored.history).toEqual(snapshot.hist);

    const c = await pageLoad(dev); // and the restored dynasty is what the next load shows
    expect(c.useStore.getState().history).toHaveLength(5);
  }, BUDGET);

  it("restoring swaps: the dynasty on screen is kept in its place", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 34);
    await a.useStore.getState().newLeague(81);
    a.useStore.setState({ stage: "regularSeason", season: 2030, history: [outcome(2029)] } as never); // a second, shorter dynasty in progress
    await a.flushSave();
    const bk = await import("./saveBackup.ts");
    await bk.restoreKeptDynasty();
    expect(a.useStore.getState().history).toHaveLength(5);
    const kept = await undoOf(dev);
    expect(kept.history).toHaveLength(1);
    expect(kept.season).toBe(2030);
  }, BUDGET);

  it("an empty league never takes the kept slot; nothing worth keeping reports so", async () => {
    const a = await pageLoad(dev);
    await a.useStore.getState().newLeague(35);
    expect(await a.keepCurrentDynasty()).toBe("nothing");
    expect(dev.idb.raw().has(undoKey(SAVE_KEY))).toBe(false);
  }, BUDGET);

  it("reports a failed copy instead of pretending (so the confirmation can stop the reset)", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 36);
    dev.idb.faults.quota = true;
    expect(await a.keepCurrentDynasty()).toBe("failed");
    expect(dev.idb.raw().has(undoKey(SAVE_KEY))).toBe(false);
  }, BUDGET);

  it("does not disturb corruption recovery: a damaged newest save still loads #prev, and the kept dynasty is untouched", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 37);
    await a.keepCurrentDynasty();
    await a.useStore.getState().newLeague(82);
    await a.flushSave();
    a.useStore.setState({ season: 3000 } as never);
    await a.flushSave();
    const rec = dev.idb.raw().get(SAVE_KEY) as { sum: number };
    dev.idb.raw().set(SAVE_KEY, { ...rec, sum: rec.sum ^ 1 });
    const b = await pageLoad(dev);
    expect(b.useStore.getState().season).not.toBe(3000);
    expect(dev.idb.raw().has(`${SAVE_KEY}#damaged`)).toBe(true);
    expect((await undoOf(dev)).history).toHaveLength(5);
  }, BUDGET);

  it("legacy localStorage migration is unchanged and leaves no undo copy", async () => {
    const a = await pageLoad(dev);
    await playFiveSeasons(a, 38);
    const json = a.leagueSnapshotJson();
    const fresh: Device = { idb: new FakeIDBFactory(), ls: quotaStorage() };
    fresh.ls.setItem(SAVE_KEY, json);
    const b = await pageLoad(fresh);
    expect(b.useStore.getState().history).toHaveLength(5);
    expect(fresh.ls.getItem(SAVE_KEY)).toBeNull();
    expect(fresh.idb.raw().has(undoKey(SAVE_KEY))).toBe(false);
  }, BUDGET);

  it("without IndexedDB the compressed localStorage fallback keeps and restores the dynasty too", async () => {
    const noIdb: Device = { idb: undefined as never, ls: quotaStorage() };
    vi.resetModules();
    globalThis.window = { localStorage: noIdb.ls } as unknown as typeof globalThis.window;
    const a = await import("./store.ts");
    await vi.waitFor(() => {
      let h = false;
      a.onStoreHydrated((x) => (h = x))();
      expect(h).toBe(true);
    });
    await playFiveSeasons(a, 39);
    expect(await a.keepCurrentDynasty()).toBe("kept");
    await a.useStore.getState().newLeague(83);
    await a.flushSave();
    const bk = await import("./saveBackup.ts");
    expect(await bk.peekKeptDynasty()).toMatchObject({ seasonsPlayed: 5 });
    expect(await bk.restoreKeptDynasty()).toMatchObject({ ok: true, season: 2031 });
  }, BUDGET);

  describe("failure safety", () => {
    const live = async (dev: Device) => JSON.parse(await decodeRecord(dev.idb.raw().get(SAVE_KEY) as SaveRecord)).state;

    it("a restore that cannot complete changes nothing: the live and kept dynasties are both still there", async () => {
      const a = await pageLoad(dev);
      await playFiveSeasons(a, 41);
      await a.useStore.getState().newLeague(90);
      a.useStore.setState({ stage: "regularSeason", season: 2030, history: [outcome(2029), outcome(2030)] } as never); // dynasty B, 2 seasons
      await a.flushSave();
      dev.idb.faults.quota = true; // storage refuses writes
      const bk = await import("./saveBackup.ts");
      expect(await bk.restoreKeptDynasty()).toEqual({ ok: false, reason: "couldNotSwap" });
      dev.idb.faults.quota = false;
      expect(a.useStore.getState().history).toHaveLength(2); // screen untouched
      expect((await live(dev)).history).toHaveLength(2); // live save untouched
      expect((await undoOf(dev)).history).toHaveLength(5); // kept dynasty untouched
    }, BUDGET);

    it("an aborted swap (power cut before commit) leaves both dynasties intact", async () => {
      const a = await pageLoad(dev);
      await playFiveSeasons(a, 42);
      await a.useStore.getState().newLeague(91);
      a.useStore.setState({ stage: "regularSeason", season: 2030, history: [outcome(2030)] } as never);
      await a.flushSave();
      dev.idb.faults.abortBeforeCommit = true;
      const bk = await import("./saveBackup.ts");
      expect((await bk.restoreKeptDynasty()).ok).toBe(false);
      expect((await live(dev)).history).toHaveLength(1);
      expect((await undoOf(dev)).history).toHaveLength(5);
    }, BUDGET);

    it("a successful restore swaps the two saves, and both survive a restart (and swap back)", async () => {
      const a = await pageLoad(dev);
      await playFiveSeasons(a, 43);
      await a.useStore.getState().newLeague(92);
      a.useStore.setState({ stage: "regularSeason", season: 2030, history: [outcome(2030)] } as never);
      await a.flushSave();
      const bk = await import("./saveBackup.ts");
      expect(await bk.restoreKeptDynasty()).toEqual({ ok: true, season: 2031, saved: true, swapped: true });
      const b = await pageLoad(dev); // restart
      expect(b.useStore.getState().history).toHaveLength(5);
      expect((await undoOf(dev)).history).toHaveLength(1);
      const bk2 = await import("./saveBackup.ts");
      expect(await bk2.restoreKeptDynasty()).toMatchObject({ ok: true, season: 2030, swapped: true }); // and back
      const c = await pageLoad(dev);
      expect(c.useStore.getState().history).toHaveLength(1);
      expect((await undoOf(dev)).history).toHaveLength(5);
    }, BUDGET);

    it("restoring onto an empty league does not claim a swap and keeps the kept copy", async () => {
      const a = await pageLoad(dev);
      await playFiveSeasons(a, 44);
      await a.useStore.getState().newLeague(93); // empty league on screen
      await a.flushSave();
      const bk = await import("./saveBackup.ts");
      expect(await bk.restoreKeptDynasty()).toMatchObject({ ok: true, swapped: false });
      expect((await undoOf(dev)).history).toHaveLength(5);
      expect((await live(dev)).history).toHaveLength(5);
    }, BUDGET);

    it("a new league is refused, with nothing replaced, when the current dynasty cannot be kept; going ahead is explicit", async () => {
      const a = await pageLoad(dev);
      await playFiveSeasons(a, 45);
      let refused: unknown = null;
      const stop = a.onResetRefused((r) => (refused = r));
      dev.idb.faults.quota = true;
      await a.useStore.getState().newLeague(94);
      expect(refused).toMatchObject({ seed: 94 });
      expect(a.useStore.getState().history).toHaveLength(5); // still the dynasty
      dev.idb.faults.quota = false;
      await a.useStore.getState().newLeague(94, undefined, { discardUnkept: true });
      expect(a.useStore.getState().history).toHaveLength(0);
      stop();
    }, BUDGET);

    it("localStorage fallback: a restore that cannot fit rolls back and loses neither dynasty", async () => {
      const ls = quotaStorage();
      vi.resetModules();
      globalThis.window = { localStorage: ls } as unknown as typeof globalThis.window;
      const a = await import("./store.ts");
      await vi.waitFor(() => {
        let h = false;
        a.onStoreHydrated((x) => (h = x))();
        expect(h).toBe(true);
      });
      await playFiveSeasons(a, 46);
      await a.keepCurrentDynasty();
      await a.useStore.getState().newLeague(95);
      a.useStore.setState({ stage: "regularSeason", season: 2030, history: [outcome(2030)] } as never);
      await a.flushSave();
      const realSet = ls.setItem.bind(ls);
      let n = 0;
      ls.setItem = (k: string, v: string) => {
        if (k === SAVE_KEY && ++n >= 1) throw new DOMException("full", "QuotaExceededError"); // the live-slot write fails
        realSet(k, v);
      };
      const bk = await import("./saveBackup.ts");
      expect((await bk.restoreKeptDynasty()).ok).toBe(false);
      ls.setItem = realSet;
      expect(await bk.peekKeptDynasty()).toMatchObject({ seasonsPlayed: 5 }); // kept copy still the 5-season dynasty
      expect(a.useStore.getState().history).toHaveLength(1);
    }, BUDGET);
  });
});
