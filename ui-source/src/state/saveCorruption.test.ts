import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A corrupted save must never load silently.
 *
 * Before this, a parse failure in zustand's `persist` rehydration (bad JSON —
 * a browser crash mid-write, a hand-edited value) was swallowed entirely: the
 * store fell back to its own fresh initial state with no signal anywhere,
 * and the corrupted string sat in `localStorage` until the very next
 * autosave overwrote it with that fresh state — at which point the original
 * dynasty, which only *looked* lost, actually was. This pins the fix: the
 * flag fires, and the raw bytes are preserved somewhere the next write can't
 * reach.
 *
 * The store module runs its one hydration attempt at import time, so this
 * needs a real (if minimal) `localStorage` in place and a fresh module
 * instance *before* importing it — `vi.resetModules()` plus a dynamic
 * `import()` inside each test, rather than the static import the rest of the
 * suite uses.
 */
function fakeLocalStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

const SAVE_KEY = "nfl-sim-ui.league";
const BACKUP_KEY = `${SAVE_KEY}.corrupted-backup`;

describe("save corruption detection", () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    vi.resetModules();
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  // These build and rehydrate a whole league, which takes ~5s on its own and
  // longer when the rest of the suite is running beside them. Left on
  // vitest's 5s default they sat ~80ms under the line and failed whenever the
  // machine was busy — a flake, not a guard.
  const BUDGET = 60_000;

  it("flags a corrupted save and backs up the raw bytes, without touching the flag on a clean one", async () => {
    const storage = fakeLocalStorage({
      [SAVE_KEY]: "{not valid json at all",
    });
    globalThis.window = { localStorage: storage } as unknown as typeof globalThis.window;

    const store = await import("./store.ts");
    // hydration is async even when nothing in it awaits — give its promise
    // chain a turn to run before asserting on what it decided
    await new Promise((r) => setTimeout(r, 0));

    let corrupted: boolean | undefined;
    store.onSaveCorrupted((v) => (corrupted = v));
    expect(corrupted).toBe(true);
    expect(storage.getItem(BACKUP_KEY)).toBe("{not valid json at all");
    // the corrupted original is left alone — only a copy was made
    expect(storage.getItem(SAVE_KEY)).toBe("{not valid json at all");
  }, BUDGET);

  it("does not flag a save that isn't there at all — that's a fresh dynasty, not a broken one", async () => {
    const storage = fakeLocalStorage();
    globalThis.window = { localStorage: storage } as unknown as typeof globalThis.window;

    const store = await import("./store.ts");
    await new Promise((r) => setTimeout(r, 0));

    let corrupted: boolean | undefined;
    store.onSaveCorrupted((v) => (corrupted = v));
    expect(corrupted).toBe(false);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
  }, BUDGET);

  it("does not flag a save that parses and migrates cleanly", async () => {
    const storage = fakeLocalStorage({
      [SAVE_KEY]: JSON.stringify({ state: { teams: {}, season: 2026 }, version: 3 }),
    });
    globalThis.window = { localStorage: storage } as unknown as typeof globalThis.window;

    const store = await import("./store.ts");
    await new Promise((r) => setTimeout(r, 0));

    let corrupted: boolean | undefined;
    store.onSaveCorrupted((v) => (corrupted = v));
    expect(corrupted).toBe(false);
  }, BUDGET);
});
