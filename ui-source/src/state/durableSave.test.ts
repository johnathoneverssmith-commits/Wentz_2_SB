import { describe, expect, it, vi } from "vitest";

import {
  checksum,
  createAutoBackend,
  createDurableStorage,
  createIndexedDbBackend,
  createLocalStorageBackend,
  decodeRecord,
  encodeRecord,
  looksLikeLeague,
  type Backend,
  type SaveRecord,
} from "./durableSave";
import { FakeIDBFactory, quotaStorage } from "./fakeIndexedDb.testutil";

const SLOT = "nfl-sim-ui.league";
const league = (season: number, filler = "") => ({
  state: { season, week: 3, stage: "regularSeason", teams: { KC: {} }, players: { a: { name: "A" } }, gms: [], filler },
  version: 1,
});
const json = (season: number, filler = "") => JSON.stringify(league(season, filler));

/** deterministic incompressible text, so a "big" save really is big after gzip too */
function noise(chars: number): string {
  let x = 123456789;
  let out = "";
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < chars; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += alphabet[x % alphabet.length];
  }
  return out;
}

const setup = (ls = quotaStorage(), compress = false) => {
  const idb = new FakeIDBFactory();
  const backend = createIndexedDbBackend(idb as unknown as IDBFactory, { storage: () => ls, compress });
  return { idb, ls, backend };
};

describe("save records", () => {
  it("round-trips through gzip and detects damage", async () => {
    const text = json(2027, "x".repeat(10_000));
    const rec = await encodeRecord(text);
    expect(rec.enc).toBe("gzip");
    expect((rec.data as ArrayBuffer).byteLength).toBeLessThan(text.length / 5);
    expect(await decodeRecord(rec)).toBe(text);
    await expect(decodeRecord({ ...rec, sum: rec.sum ^ 1 })).rejects.toThrow();
    await expect(decodeRecord({ ...rec, chars: rec.chars + 1 })).rejects.toThrow();
    const cut = new Uint8Array(rec.data as ArrayBuffer).slice(0, 30);
    await expect(decodeRecord({ ...rec, data: cut.buffer })).rejects.toThrow();
  });

  it("the league gate refuses anything that isn't a league", () => {
    expect(looksLikeLeague(league(2026))).toBe(true);
    expect(looksLikeLeague({ state: {}, version: 1 })).toBe(false);
    expect(looksLikeLeague(null)).toBe(false);
    expect(checksum("abc")).toBe(checksum("abc"));
    expect(checksum("abc")).not.toBe(checksum("abd"));
  });
});

describe("IndexedDB backend", () => {
  it("writes, rotates the previous generation, and reads the newest", async () => {
    const { idb, backend } = setup();
    await backend.write(SLOT, json(2026));
    await backend.write(SLOT, json(2027));
    expect((await backend.read(SLOT)).json).toBe(json(2027));
    expect(await decodeRecord(idb.raw().get(`${SLOT}#prev`) as SaveRecord)).toBe(json(2026));
    expect((idb.raw().get(SLOT) as SaveRecord).enc).toBe("plain");
  });

  it("can write gzip records, and reads both kinds", async () => {
    const { idb, backend } = setup(quotaStorage(), true);
    const big = json(2027, "k".repeat(200_000));
    await backend.write(SLOT, big);
    expect((idb.raw().get(SLOT) as SaveRecord).enc).toBe("gzip");
    expect((await backend.read(SLOT)).json).toBe(big);
    const plain = createIndexedDbBackend(idb as unknown as IDBFactory, { storage: () => quotaStorage() });
    expect((await plain.read(SLOT)).json).toBe(big);
  });

  it("an interrupted write leaves the last valid save and its predecessor untouched", async () => {
    const { idb, backend } = setup();
    await backend.write(SLOT, json(2026));
    await backend.write(SLOT, json(2027));
    // the transaction fails on the put of the new record (the second put of the transaction)
    idb.faults.failPutNumber = idb.puts + 2;
    await expect(backend.write(SLOT, json(2028))).rejects.toBeTruthy();
    expect((await backend.read(SLOT)).json).toBe(json(2027));
    expect(await decodeRecord(idb.raw().get(`${SLOT}#prev`) as SaveRecord)).toBe(json(2026));
    // power cut after the requests, before commit
    idb.faults.abortBeforeCommit = true;
    await expect(backend.write(SLOT, json(2028))).rejects.toBeTruthy();
    expect((await backend.read(SLOT)).json).toBe(json(2027));
    // and the next write goes through
    await backend.write(SLOT, json(2028));
    expect((await backend.read(SLOT)).json).toBe(json(2028));
  });

  it("falls back to the previous generation when the newest is damaged, and keeps the damaged copy", async () => {
    const { idb, backend } = setup();
    await backend.write(SLOT, json(2026));
    await backend.write(SLOT, json(2027));
    const cur = idb.raw().get(SLOT) as SaveRecord;
    idb.raw().set(SLOT, { ...cur, data: String(cur.data).slice(0, 12) }); // truncated mid-write
    const r = await backend.read(SLOT);
    expect(r.json).toBe(json(2026));
    expect(r.fromPrevious).toBe(true);
    expect(idb.raw().has(`${SLOT}#damaged`)).toBe(true);
  });

  it("throws, with the damaged bytes kept, when every generation is unreadable", async () => {
    const { idb, backend } = setup();
    await backend.write(SLOT, json(2026));
    const cur = idb.raw().get(SLOT) as SaveRecord;
    idb.raw().set(SLOT, { ...cur, sum: 0 });
    await expect(backend.read(SLOT)).rejects.toThrow();
    expect(idb.raw().has(`${SLOT}#damaged`)).toBe(true);
  });

  it("remove() clears both generations", async () => {
    const { backend } = setup();
    await backend.write(SLOT, json(2026));
    await backend.write(SLOT, json(2027));
    await backend.remove(SLOT);
    expect(await backend.has(SLOT)).toBe(false);
    expect((await backend.read(SLOT)).json).toBeNull();
  });
});

describe("migration from a localStorage save", () => {
  it("moves a plain pre-fix save into IndexedDB, verifies it, then removes the old copy", async () => {
    const old = json(2028, "y".repeat(2000));
    const ls = quotaStorage(5_242_875, { [SLOT]: old });
    const { idb, backend } = setup(ls);
    const r = await backend.read(SLOT);
    expect(r.json).toBe(old);
    expect(await decodeRecord(idb.raw().get(SLOT) as SaveRecord)).toBe(old);
    expect(ls.getItem(SLOT)).toBeNull();
    // second load comes from IndexedDB
    expect((await backend.read(SLOT)).json).toBe(old);
  });

  it("keeps the old copy, and still loads it, if the IndexedDB write fails", async () => {
    const old = json(2028);
    const ls = quotaStorage(5_242_875, { [SLOT]: old });
    const { idb, backend } = setup(ls);
    idb.faults.quota = true;
    expect((await backend.read(SLOT)).json).toBe(old);
    expect(ls.getItem(SLOT)).toBe(old);
  });

  it("migrates a save close to the quota limit (the failure this fixes)", async () => {
    const big = json(2028, noise(5_100_000));
    const ls = quotaStorage(5_242_875, { [SLOT]: big });
    const { backend } = setup(ls);
    expect((await backend.read(SLOT)).json).toBe(big);
    expect(ls.getItem(SLOT)).toBeNull();
    // and it can now grow far past what localStorage allows
    const bigger = json(2029, noise(9_000_000));
    await backend.write(SLOT, bigger);
    expect((await backend.read(SLOT)).json).toBe(bigger);
  });

  it("reads the compressed localStorage form too", async () => {
    const ls = quotaStorage();
    const lsb = createLocalStorageBackend({ storage: () => ls });
    await lsb.write(SLOT, json(2027, "z".repeat(5000)));
    expect(ls.getItem(SLOT)!.startsWith("gz1:")).toBe(true);
    const { backend } = setup(ls);
    expect((await backend.read(SLOT)).json).toBe(json(2027, "z".repeat(5000)));
  });

  it("an unreadable legacy save is reported, kept in place, and copied aside", async () => {
    const ls = quotaStorage(5_242_875, { [SLOT]: "{not json" });
    const { idb, backend } = setup(ls);
    await expect(backend.read(SLOT)).rejects.toThrow();
    expect(ls.getItem(SLOT)).toBe("{not json");
    expect(idb.raw().get(`${SLOT}#damaged`)).toBe("{not json");
  });
});

describe("localStorage fallback", () => {
  it("compresses, so a save that is over quota as plain JSON still fits", async () => {
    const ls = quotaStorage();
    const lsb = createLocalStorageBackend({ storage: () => ls });
    const big = json(2030, "ab".repeat(3_500_000)); // 7 M characters, very compressible
    await lsb.write(SLOT, big);
    expect((await lsb.read(SLOT)).json).toBe(big);
  });

  it("a write that doesn't fit throws and leaves the previous value in place", async () => {
    const ls = quotaStorage();
    const lsb = createLocalStorageBackend({ storage: () => ls });
    await lsb.write(SLOT, json(2026));
    await expect(lsb.write(SLOT, json(2027, noise(6_000_000)))).rejects.toBeTruthy();
    expect((await lsb.read(SLOT)).json).toBe(json(2026));
  });

  it("evicts the named side keys to make room", async () => {
    const ls = quotaStorage(2000, { side: "q".repeat(1500) });
    const lsb = createLocalStorageBackend({ storage: () => ls, evictKeys: () => ["side"] });
    await lsb.write(SLOT, JSON.stringify({ a: noise(1200) }));
    expect(ls.getItem("side")).toBeNull();
  });

  it("the auto backend falls back to localStorage when IndexedDB won't open", async () => {
    const ls = quotaStorage();
    const idb = new FakeIDBFactory();
    idb.faults.failOpen = true;
    const auto = createAutoBackend(createIndexedDbBackend(idb as unknown as IDBFactory, { storage: () => ls }), createLocalStorageBackend({ storage: () => ls }));
    await auto.write(SLOT, json(2026));
    expect(ls.getItem(SLOT)).not.toBeNull();
    expect((await auto.read(SLOT)).json).toBe(json(2026));
    expect(auto.kind).toBe("localstorage");
  });
});

describe("the storage the store persists through", () => {
  const make = (backend: Backend, over: Partial<Parameters<typeof createDurableStorage>[0]> = {}) => {
    const ls = quotaStorage();
    const events: string[] = [];
    const d = createDurableStorage<Record<string, unknown>>({
      backend,
      slotFor: (n) => n,
      statusStorage: () => ls,
      debounceMs: 10,
      onBroken: (b) => events.push(b ? "broken" : "ok"),
      onRecovered: () => events.push("recovered"),
      onPriorFailure: () => events.push("prior"),
      ...over,
    });
    return { d, ls, events };
  };

  it("drops writes made before the save was read, so a fresh league can't replace it", async () => {
    const { backend } = setup();
    await backend.write(SLOT, json(2029));
    const { d } = make(backend);
    d.storage.setItem(SLOT, league(2026) as never); // the store's initial state, pre-hydration
    expect(await d.flush()).toBe(true);
    expect((await backend.read(SLOT)).json).toBe(json(2029));
    const got = await d.storage.getItem(SLOT);
    expect((got as { state: { season: number } }).state.season).toBe(2029);
    d.storage.setItem(SLOT, league(2030) as never);
    await d.flush();
    expect((await backend.read(SLOT)).json).toBe(json(2030));
  });

  it("coalesces bursts of changes into one write of the latest", async () => {
    const { backend } = setup();
    const write = vi.spyOn(backend, "write");
    const { d } = make(backend);
    d.markHydrated(SLOT);
    for (let s = 2026; s < 2036; s++) d.storage.setItem(SLOT, league(s) as never);
    await new Promise((r) => setTimeout(r, 80)); // past the 10 ms debounce
    await d.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect((await backend.read(SLOT)).json).toBe(json(2035));
  });

  it("never writes something that isn't a league", async () => {
    const { backend } = setup();
    await backend.write(SLOT, json(2027));
    const { d } = make(backend);
    d.markHydrated(SLOT);
    d.storage.setItem(SLOT, { state: {}, version: 1 } as never);
    await d.flush();
    expect((await backend.read(SLOT)).json).toBe(json(2027));
  });

  it("a failed write raises the warning, keeps the last good save, and clears on recovery", async () => {
    const { idb, backend } = setup();
    const { d, ls, events } = make(backend);
    d.markHydrated(SLOT);
    d.storage.setItem(SLOT, league(2026) as never);
    expect(await d.flush()).toBe(true);

    idb.faults.quota = true;
    d.storage.setItem(SLOT, league(2027) as never);
    expect(await d.flush()).toBe(false);
    expect(events).toEqual(["broken"]);
    expect(d.lastError()).toBeTruthy();
    expect(JSON.parse(ls.getItem("nfl-sim-ui.save-status")!)).toMatchObject({ broken: true, okSeason: 2026 });
    expect((await backend.read(SLOT)).json).toBe(json(2026)); // nothing lost, nothing rolled back silently

    idb.faults.quota = false;
    d.storage.setItem(SLOT, league(2028) as never);
    expect(await d.flush()).toBe(true);
    expect(events).toEqual(["broken", "ok"]);
    expect((await backend.read(SLOT)).json).toBe(json(2028));
  });

  it("after a reload that follows failed saves, says what was lost and where the save stands", async () => {
    const { idb, backend } = setup();
    const first = make(backend);
    first.d.markHydrated(SLOT);
    first.d.storage.setItem(SLOT, league(2027) as never);
    await first.d.flush();
    idb.faults.quota = true;
    first.d.storage.setItem(SLOT, league(2028) as never);
    await first.d.flush();

    idb.faults.quota = false;
    // a new page load: same device storage, fresh module state
    const second = createDurableStorage<Record<string, unknown>>({
      backend: createIndexedDbBackend(idb as unknown as IDBFactory, { storage: () => first.ls }),
      slotFor: (n) => n,
      statusStorage: () => first.ls,
      onBroken: () => undefined,
      onPriorFailure: (st) => prior.push(st),
    });
    const prior: unknown[] = [];
    const got = (await second.storage.getItem(SLOT)) as { state: { season: number } };
    expect(got.state.season).toBe(2027);
    expect(prior).toHaveLength(1);
    expect(prior[0]).toMatchObject({ okSeason: 2027, broken: true });
  });

  it("reports a recovery from the previous generation", async () => {
    const { idb, backend } = setup();
    await backend.write(SLOT, json(2026));
    await backend.write(SLOT, json(2027));
    idb.raw().set(SLOT, { ...(idb.raw().get(SLOT) as SaveRecord), sum: 1 });
    const { d, events } = make(backend);
    const got = (await d.storage.getItem(SLOT)) as { state: { season: number } };
    expect(got.state.season).toBe(2026);
    expect(events).toContain("recovered");
  });

  it("round-trips an oversized save (larger than the localStorage quota) and survives reload", async () => {
    const { idb, backend } = setup();
    const { d } = make(backend);
    d.markHydrated(SLOT);
    const huge = league(2031, noise(8_000_000));
    d.storage.setItem(SLOT, huge as never);
    expect(await d.flush()).toBe(true);
    const reloaded = createDurableStorage<Record<string, unknown>>({
      backend: createIndexedDbBackend(idb as unknown as IDBFactory, { storage: () => quotaStorage() }),
      slotFor: (n) => n,
      onBroken: () => undefined,
    });
    expect(await reloaded.storage.getItem(SLOT)).toEqual(huge);
  }, 60_000);
});
