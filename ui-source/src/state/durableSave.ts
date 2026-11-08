import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Durable browser persistence for the solo (and online-copy) save — GAP-008.
 *
 * A real-engine franchise serialises to 4-6.6 M characters, and localStorage
 * holds 5 MiB per origin, so a dynasty silently stopped saving around
 * season 2, week 16. The save now lives in IndexedDB, gzip-compressed
 * (a decade measures ~8x smaller than the JSON), with:
 *
 *  - **plain or gzip records**: IndexedDB has hundreds of MB, so its records are written plain by
 *    default — measured on a 1.7 M-character league a plain put takes ~10 ms against ~30 ms to
 *    gzip, and it starts without waiting on a stream, which shortens the window in which closing
 *    the tab loses the last move. The localStorage fallback *does* gzip (5 MiB is the whole
 *    problem there). Both are read either way;
 *  - **atomic writes**: one IndexedDB transaction moves the current save to
 *    `<slot>#prev` and puts the new one, so an interrupted write leaves the
 *    old pair untouched; a record carries its length and checksum, so a
 *    record that is damaged anyway is detected rather than loaded;
 *  - **a sanity gate**: a state that doesn't look like a league is refused
 *    and never replaces a good save;
 *  - **fallback to the previous generation** when the newest record is
 *    unreadable, and a `<slot>#damaged` copy of whatever couldn't be read,
 *    which no autosave ever overwrites;
 *  - **migration** of a pre-existing localStorage save: copied into
 *    IndexedDB, read back and verified, and only then removed;
 *  - **a localStorage backend** (compressed too) when IndexedDB is not
 *    available, which is also what the unit tests without a browser run on.
 *
 * Nothing here changes what a save contains. See docs/save_persistence.md.
 */

// ---------------------------------------------------------------- encoding

const GZ_PREFIX = "gz1:";

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined" && typeof Blob !== "undefined";
}

async function pump(input: Blob, t: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  return new Response(input.stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer();
}

export const gzip = (s: string): Promise<ArrayBuffer> => pump(new Blob([s]), new CompressionStream("gzip"));
export async function gunzip(b: ArrayBuffer | Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pump(new Blob([b as BlobPart]), new DecompressionStream("gzip")));
}

/** FNV-1a over UTF-16 code units; cheap enough to run over a 6 M-character save. */
export function checksum(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** What one IndexedDB value looks like. */
export interface SaveRecord {
  fmt: 1;
  enc: "gzip" | "plain";
  data: ArrayBuffer | string;
  /** length of the JSON text, and its checksum: a decoded record must match both */
  chars: number;
  sum: number;
  savedAt: number;
}

export async function encodeRecord(json: string, forceSync = false): Promise<SaveRecord> {
  const base = { fmt: 1 as const, chars: json.length, sum: checksum(json), savedAt: Date.now() };
  if (forceSync || !compressionAvailable()) return { ...base, enc: "plain", data: json };
  return { ...base, enc: "gzip", data: await gzip(json) };
}

export async function decodeRecord(r: SaveRecord): Promise<string> {
  if (!r || r.fmt !== 1) throw new Error("unknown save record format");
  const json = r.enc === "gzip" ? await gunzip(r.data as ArrayBuffer) : String(r.data);
  if (json.length !== r.chars || checksum(json) !== r.sum) throw new Error("save record failed its integrity check");
  return json;
}

// ---------------------------------------------------------------- backends

export interface ReadResult {
  json: string | null;
  /** the newest record was unreadable and the one before it was used */
  fromPrevious?: boolean;
  /** when the record that was loaded was written */
  savedAt?: number;
}

export interface Backend {
  /** Resolves when the backend can be used at all (IndexedDB can open). */
  probe?(): Promise<void>;
  readonly kind: "indexeddb" | "localstorage";
  read(slot: string): Promise<ReadResult>;
  write(slot: string, json: string): Promise<void>;
  /** Start a write now without waiting for compression: the page is going away. */
  writeNow(slot: string, json: string): void;
  remove(slot: string): Promise<void>;
  has(slot: string): Promise<boolean>;
}

const DB_NAME = "nfl-sim-ui-saves";
const STORE = "saves";
const prevKey = (s: string) => `${s}#prev`;
const damagedKey = (s: string) => `${s}#damaged`;

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB request failed"));
  });
const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => rej(tx.error ?? new Error("IndexedDB transaction aborted"));
  });

export interface LegacyOptions {
  /** localStorage, for the one-time migration of a pre-IndexedDB save */
  storage: () => Storage;
  /** gzip the records (smaller on disk, slower to write). Off by default: see the file header. */
  compress?: boolean;
}

export function createIndexedDbBackend(factory: IDBFactory, legacy: LegacyOptions): Backend {
  let dbp: Promise<IDBDatabase> | null = null;
  let dbNow: IDBDatabase | null = null;
  const open = (): Promise<IDBDatabase> => {
    dbp ??= new Promise<IDBDatabase>((res, rej) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => {
        dbNow = r.result;
        r.result.onclose = () => {
          dbNow = null;
          dbp = null;
        };
        r.result.onversionchange = () => r.result.close();
        res(r.result);
      };
      r.onerror = () => rej(r.error ?? new Error("could not open IndexedDB"));
      r.onblocked = () => rej(new Error("IndexedDB open blocked"));
    }).catch((e) => {
      dbp = null;
      throw e;
    });
    return dbp;
  };
  const rw = (db: IDBDatabase): IDBTransaction => {
    try {
      return db.transaction(STORE, "readwrite", { durability: "strict" });
    } catch {
      return db.transaction(STORE, "readwrite");
    }
  };

  async function getRecord(db: IDBDatabase, key: string): Promise<SaveRecord | undefined> {
    return (await req(db.transaction(STORE, "readonly").objectStore(STORE).get(key))) as SaveRecord | undefined;
  }

  /** Put `rec` as the current save and move whatever was current to `prev`, in one transaction. */
  async function commit(db: IDBDatabase, slot: string, rec: SaveRecord): Promise<void> {
    const tx = rw(db);
    const store = tx.objectStore(STORE);
    const done = txDone(tx);
    const cur = (await req(store.get(slot))) as SaveRecord | undefined;
    if (cur) store.put(cur, prevKey(slot));
    store.put(rec, slot);
    await done;
  }

  async function migrateLegacy(db: IDBDatabase, slot: string): Promise<ReadResult | null> {
    let raw: string | null = null;
    try {
      raw = legacy.storage().getItem(slot);
    } catch {
      return null;
    }
    if (raw == null) return null;
    let json: string;
    try {
      json = await decodeLegacy(raw);
      JSON.parse(json);
    } catch (e) {
      // unreadable: keep the raw bytes where no autosave reaches them, and report it
      await keepDamaged(db, slot, raw);
      throw e;
    }
    // copy → read back → verify → only then remove the old copy
    try {
      await commit(db, slot, await encodeRecord(json, !legacy.compress));
      const back = await getRecord(db, slot);
      if (back && (await decodeRecord(back)) === json) {
        try {
          legacy.storage().removeItem(slot);
        } catch {
          // an undeletable legacy copy is harmless: IndexedDB wins from now on
        }
      }
    } catch {
      // the migration can retry next load; the player's save is still readable from localStorage
    }
    return { json, savedAt: undefined };
  }

  async function keepDamaged(db: IDBDatabase, slot: string, raw: string | SaveRecord): Promise<void> {
    try {
      const tx = rw(db);
      tx.objectStore(STORE).put(raw, damagedKey(slot));
      await txDone(tx);
    } catch {
      // a courtesy copy; the warning does not depend on it
    }
  }

  return {
    kind: "indexeddb",
    async probe() {
      await open();
    },
    async read(slot) {
      const db = await open();
      const cur = await getRecord(db, slot);
      if (cur === undefined) {
        const m = await migrateLegacy(db, slot);
        return m ?? { json: null };
      }
      try {
        return { json: await decodeRecord(cur), savedAt: cur.savedAt };
      } catch {
        const prev = await getRecord(db, prevKey(slot));
        await keepDamaged(db, slot, cur);
        if (prev) {
          try {
            return { json: await decodeRecord(prev), fromPrevious: true, savedAt: prev.savedAt };
          } catch {
            // both generations unreadable
          }
        }
        throw new Error("the stored save could not be read");
      }
    },
    async write(slot, json) {
      const db = await open();
      await commit(db, slot, await encodeRecord(json, !legacy.compress));
    },
    writeNow(slot, json) {
      // The page is closing: no awaiting compression and no read-then-write. One `put` of a plain
      // record, issued synchronously, is what survives an unload most reliably. The previous
      // generation is left as it was.
      if (!dbNow) return;
      try {
        const tx = rw(dbNow);
        tx.objectStore(STORE).put({ fmt: 1, enc: "plain", data: json, chars: json.length, sum: checksum(json), savedAt: Date.now() } satisfies SaveRecord, slot);
      } catch {
        // nothing more can be done while unloading
      }
    },
    async remove(slot) {
      const db = await open();
      const tx = rw(db);
      for (const k of [slot, prevKey(slot)]) tx.objectStore(STORE).delete(k);
      await txDone(tx);
      try {
        legacy.storage().removeItem(slot);
      } catch {
        // none
      }
    },
    async has(slot) {
      const db = await open();
      if ((await req(db.transaction(STORE, "readonly").objectStore(STORE).count(slot))) > 0) return true;
      try {
        return legacy.storage().getItem(slot) != null;
      } catch {
        return false;
      }
    },
  };
}

async function decodeLegacy(raw: string): Promise<string> {
  if (!raw.startsWith(GZ_PREFIX)) return raw;
  return gunzip(fromBase64(raw.slice(GZ_PREFIX.length)));
}

export interface LocalBackendOptions {
  storage: () => Storage;
  /** Keys that may be dropped, in order, to make room for a write that doesn't fit. */
  evictKeys?: (slot: string) => string[];
  /** The key an unreadable value is copied to. */
  damagedKey?: (slot: string) => string;
}

/** localStorage, compressed when the browser can. Reads plain JSON from before this change too. */
export function createLocalStorageBackend(o: LocalBackendOptions): Backend {
  const ls = o.storage;
  const encode = async (json: string): Promise<string> => (compressionAvailable() ? GZ_PREFIX + toBase64(await gzip(json)) : json);
  const put = (slot: string, v: string): void => {
    try {
      ls().setItem(slot, v);
      return;
    } catch (e) {
      for (const k of o.evictKeys?.(slot) ?? []) {
        try {
          ls().removeItem(k);
          ls().setItem(slot, v);
          return;
        } catch {
          // try the next
        }
      }
      throw e;
    }
  };
  return {
    kind: "localstorage",
    async read(slot) {
      const raw = ls().getItem(slot);
      if (raw == null) return { json: null };
      try {
        const json = await decodeLegacy(raw);
        JSON.parse(json);
        return { json };
      } catch (e) {
        try {
          const dk = o.damagedKey?.(slot);
          if (dk) ls().setItem(dk, raw);
        } catch {
          // a courtesy copy
        }
        throw e;
      }
    },
    async write(slot, json) {
      put(slot, await encode(json));
    },
    writeNow(slot, json) {
      try {
        ls().setItem(slot, json);
      } catch {
        // unloading
      }
    },
    async remove(slot) {
      ls().removeItem(slot);
    },
    async has(slot) {
      return ls().getItem(slot) != null;
    },
  };
}

/**
 * IndexedDB when it opens, localStorage when it doesn't (some private windows,
 * locked-down profiles). The choice is made once, on first use.
 */
export function createAutoBackend(primary: Backend | null, fallback: Backend): Backend {
  const chosen: Promise<Backend> = (async () => {
    if (!primary?.probe) return primary ?? fallback;
    try {
      await primary.probe();
      return primary;
    } catch {
      return fallback;
    }
  })();
  let resolved: Backend | null = null;
  void chosen.then((b) => (resolved = b));
  return {
    get kind() {
      return (resolved ?? primary ?? fallback).kind;
    },
    read: async (s) => (await chosen).read(s),
    write: async (s, j) => (await chosen).write(s, j),
    writeNow: (s, j) => {
      // synchronous by contract: whichever backend the probe settled on
      (resolved ?? primary ?? fallback).writeNow(s, j);
    },
    remove: async (s) => (await chosen).remove(s),
    has: async (s) => (await chosen).has(s),
    probe: async () => void (await chosen),
  };
}

// ----------------------------------------------------------------- storage

/** Does this look like a league save? A state that doesn't must never replace one that does. */
export function looksLikeLeague(v: unknown): boolean {
  const s = (v as { state?: Record<string, unknown> } | null)?.state;
  return !!s && typeof s === "object" && !!s.teams && typeof s.teams === "object" && !!s.players && typeof s.players === "object" && !!s.gms;
}

export interface SaveStatus {
  /** wall-clock time and place of the last write that landed */
  okAt?: number;
  okSeason?: number;
  okWeek?: number;
  okStage?: string;
  /** a write failed and none has landed since */
  broken?: boolean;
  failedAt?: number;
}

export interface DurableHooks {
  backend: Backend;
  /** which slot a persist `name` lands in */
  slotFor: (name: string) => string;
  /** a write failed (true) or the next one landed (false) */
  onBroken: (broken: boolean) => void;
  /** the newest record was unreadable and the previous generation was loaded */
  onRecovered?: (info: { savedAt?: number }) => void;
  /** where the tiny status record lives (separate from the save so a full quota can't hide it) */
  statusStorage?: () => Storage;
  /** the previous page load ended with writes failing; `status` says when the last one landed */
  onPriorFailure?: (status: SaveStatus) => void;
  /** wait before an autosave is written; later changes inside the wait replace it */
  debounceMs?: number;
}

export const STATUS_KEY = "nfl-sim-ui.save-status";

export interface Durable<S> {
  storage: PersistStorage<S>;
  /** Write what is pending right now. Resolves true when everything has landed. */
  flush(): Promise<boolean>;
  /** The last write error, for the UI. */
  lastError(): string | null;
  /** The status recorded by the previous page load and this one. */
  status(): SaveStatus;
  /** Declare a slot with nothing to read as loaded, so writes to it are accepted. */
  markHydrated(slot: string): void;
  backend: Backend;
}

export function createDurableStorage<S>(h: DurableHooks): Durable<S> {
  const debounceMs = h.debounceMs ?? 0;
  let pending: { slot: string; value: StorageValue<S> } | null = null;
  /** the value being written right now (compression and the transaction are in flight) */
  let current: { slot: string; value: StorageValue<S> } | null = null;
  let writing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let err: string | null = null;
  const hydrated = new Set<string>();
  let broken = false;

  const readStatus = (): SaveStatus => {
    try {
      return JSON.parse(h.statusStorage?.().getItem(STATUS_KEY) ?? "{}") as SaveStatus;
    } catch {
      return {};
    }
  };
  const writeStatus = (patch: SaveStatus): SaveStatus => {
    const next = { ...readStatus(), ...patch };
    try {
      h.statusStorage?.().setItem(STATUS_KEY, JSON.stringify(next));
    } catch {
      // a full quota must not turn a status note into a second failure
    }
    return next;
  };

  const setBroken = (b: boolean): void => {
    if (b === broken) return;
    broken = b;
    h.onBroken(b);
  };

  const persist = async (slot: string, value: StorageValue<S>): Promise<void> => {
    try {
      if (!looksLikeLeague(value)) return; // never replace a good save with something that isn't a league
      await h.backend.write(slot, JSON.stringify(value));
      const st = (value.state ?? {}) as unknown as { season?: number; week?: number; stage?: string };
      writeStatus({ okAt: Date.now(), okSeason: st.season, okWeek: st.week, okStage: st.stage, broken: false });
      err = null;
      setBroken(false);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      writeStatus({ broken: true, failedAt: Date.now() });
      setBroken(true);
    }
  };

  /** Start writing what is pending, unless a write is already running (it re-checks when it ends). */
  const run = (): void => {
    timer = null;
    if (writing || !pending) return;
    current = pending;
    pending = null;
    const w = persist(current.slot, current.value).finally(() => {
      current = null;
      writing = null;
      if (pending) schedule();
    });
    writing = w;
  };
  const schedule = (): void => {
    if (writing || timer) return;
    // Leading edge: with no debounce the write starts in this very call, so the window in which a
    // closing tab can lose the last change is the write itself, not a timer behind a render.
    if (debounceMs <= 0) run();
    else timer = setTimeout(run, debounceMs);
  };

  const flush = async (): Promise<boolean> => {
    if (timer) clearTimeout(timer);
    timer = null;
    while (pending || writing) {
      if (!writing) run();
      await writing;
    }
    return !broken;
  };

  // Closing the tab: an awaited gzip would not finish, so start a plain write synchronously —
  // of the newest value, whether it is still waiting or already on its way.
  const onHide = (): void => {
    const p = pending ?? current;
    if (!p || !looksLikeLeague(p.value)) return;
    h.backend.writeNow(p.slot, JSON.stringify(p.value));
  };
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("pagehide", onHide);
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) onHide();
    });
  }

  const storage: PersistStorage<S> = {
    async getItem(name) {
      const slot = h.slotFor(name);
      let r: ReadResult;
      try {
        r = await h.backend.read(slot);
      } catch (e) {
        hydrated.add(slot);
        throw e;
      }
      hydrated.add(slot);
      if (r.json == null) return null;
      if (r.fromPrevious) h.onRecovered?.({ savedAt: r.savedAt });
      const st = readStatus();
      // the previous session ended with a save that was failing: this load is the last write that landed
      if (st.broken) h.onPriorFailure?.(st);
      return JSON.parse(r.json) as StorageValue<S>;
    },
    setItem(name, value) {
      const slot = h.slotFor(name);
      // Before the stored save has been read, the store still holds its fresh initial state;
      // persisting that would overwrite the very save about to be loaded.
      if (!hydrated.has(slot)) return;
      pending = { slot, value };
      schedule();
    },
    async removeItem(name) {
      const slot = h.slotFor(name);
      pending = null;
      await writing;
      await h.backend.remove(slot);
    },
  };

  return { storage, flush, lastError: () => err, status: readStatus, markHydrated: (slot) => void hydrated.add(slot), backend: h.backend };
}
