/**
 * A just-enough IndexedDB for the persistence tests: databases with object stores, readonly/readwrite
 * transactions that are atomic (writes are staged and applied on commit, discarded on abort), requests
 * answered asynchronously, values structured-cloned, and fault injection. Not a conformance
 * implementation — the real thing is exercised in Chromium by the browser regression run.
 */
export interface FaultPlan {
  /** make the Nth (1-based) `put` of any readwrite transaction fail; the whole transaction aborts */
  failPutNumber?: number;
  /** make `indexedDB.open` fail */
  failOpen?: boolean;
  /** fail every readwrite transaction with a quota error */
  quota?: boolean;
  /** abort the next readwrite transaction after its last request, before commit (power cut) */
  abortBeforeCommit?: boolean;
}

export class FakeIDBFactory {
  readonly stores = new Map<string, Map<string, unknown>>();
  faults: FaultPlan = {};
  puts = 0;
  commits = 0;

  open(name: string, _version?: number): IDBOpenDBRequest {
    const r: Record<string, unknown> = { result: undefined, error: null };
    setTimeout(() => {
      if (this.faults.failOpen) {
        r.error = new Error("open failed");
        (r.onerror as (() => void) | undefined)?.();
        return;
      }
      const fresh = !this.stores.has(name);
      const db = new FakeDb(this, name);
      r.result = db;
      if (fresh) {
        this.stores.set(name, new Map());
        (r.onupgradeneeded as (() => void) | undefined)?.();
      }
      (r.onsuccess as (() => void) | undefined)?.();
    }, 0);
    return r as unknown as IDBOpenDBRequest;
  }

  /** the raw map of the single object store, for assertions and tampering */
  raw(db = "nfl-sim-ui-saves"): Map<string, unknown> {
    return this.stores.get(db)!;
  }
}

class FakeDb {
  objectStoreNames = { contains: () => true };
  constructor(private f: FakeIDBFactory, private name: string) {}
  createObjectStore(): void {}
  close(): void {}
  transaction(_store: string, mode: IDBTransactionMode, _opts?: unknown): IDBTransaction {
    return new FakeTx(this.f, this.f.stores.get(this.name)!, mode) as unknown as IDBTransaction;
  }
}

class FakeTx {
  oncomplete?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  error: Error | null = null;
  private staged = new Map<string, unknown | typeof DELETED>();
  private pending = 0;
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private f: FakeIDBFactory, private data: Map<string, unknown>, private mode: IDBTransactionMode) {
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.maybeFinish(), 0);
  }
  private maybeFinish(): void {
    if (this.finished) return;
    if (this.pending > 0) return this.arm();
    this.finished = true;
    if (this.mode === "readwrite") {
      if (this.f.faults.abortBeforeCommit) {
        this.f.faults.abortBeforeCommit = false;
        this.error = new Error("aborted before commit");
        this.onabort?.();
        return;
      }
      for (const [k, v] of this.staged) {
        if (v === DELETED) this.data.delete(k);
        else this.data.set(k, v);
      }
      this.f.commits++;
    }
    this.oncomplete?.();
  }
  private abort(e: Error): void {
    this.finished = true;
    this.staged.clear();
    this.error = e;
    this.onabort?.();
  }

  private request<T>(run: () => T, write = false): IDBRequest<T> {
    this.pending++;
    const r: Record<string, unknown> = { result: undefined, error: null };
    setTimeout(() => {
      this.pending--;
      if (this.finished) return;
      try {
        if (write && this.f.faults.quota) throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
        r.result = run();
      } catch (e) {
        r.error = e;
        (r.onerror as (() => void) | undefined)?.();
        this.abort(e as Error);
        return;
      }
      (r.onsuccess as (() => void) | undefined)?.();
      this.arm();
    }, 0);
    return r as unknown as IDBRequest<T>;
  }

  objectStore(_n: string): IDBObjectStore {
    const read = (k: string): unknown => (this.staged.has(k) ? (this.staged.get(k) === DELETED ? undefined : this.staged.get(k)) : this.data.get(k));
    return {
      get: (k: string) => this.request(() => read(k)),
      count: (k: string) => this.request(() => (read(k) === undefined ? 0 : 1)),
      put: (v: unknown, k: string) =>
        this.request(() => {
          this.f.puts++;
          if (this.f.faults.failPutNumber !== undefined && this.f.puts === this.f.faults.failPutNumber) {
            throw new Error("injected put failure");
          }
          this.staged.set(k, structuredClone(v));
          return k;
        }, true),
      delete: (k: string) =>
        this.request(() => {
          this.staged.set(k, DELETED);
          return undefined;
        }, true),
    } as unknown as IDBObjectStore;
  }
}
const DELETED = Symbol("deleted");

/** A localStorage with a quota in UTF-16 characters, like the 5 MiB measured in Chromium. */
export function quotaStorage(limitChars = 5_242_875, initial: Record<string, string> = {}): Storage & { used(): number; raw: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  const used = (): number => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const next = used() - (data.has(k) ? k.length + data.get(k)!.length : 0) + k.length + String(v).length;
      if (next > limitChars) throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
      data.set(k, String(v));
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    used,
    raw: data,
  } as unknown as Storage & { used(): number; raw: Map<string, string> };
}
