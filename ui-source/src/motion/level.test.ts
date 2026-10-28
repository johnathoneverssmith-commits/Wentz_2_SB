import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("motion preference accessibility", () => {
  function device(reduced: boolean, saved = "full") {
    const store = new Map([["fs.motion", saved]]);
    const callbacks = new Set<() => void>();
    const query = { matches: reduced, addEventListener: (_: string, fn: () => void) => callbacks.add(fn), removeEventListener: (_: string, fn: () => void) => callbacks.delete(fn) };
    vi.stubGlobal("window", { matchMedia: () => query });
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    return { query, callbacks, store };
  }

  it("device reduced motion overrides a saved full preference", async () => {
    device(true);
    const level = await import("./level");
    expect(level.getMotionLevel()).toBe("off");
    level.setMotionLevel("full");
    expect(level.getMotionLevel()).toBe("off");
  });

  it("keeps an explicit choice in memory when browser storage is unavailable", async () => {
    device(false);
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private window"); },
      setItem: () => { throw new Error("private window"); },
    });
    const level = await import("./level");
    level.setMotionLevel("off");
    expect(level.getMotionLevel()).toBe("off");
    level.setMotionLevel("subtle");
    expect(level.getMotionLevel()).toBe("subtle");
  });

  it("reacts to device changes and cleans up the listener without losing the saved preference", async () => {
    const d = device(false);
    const level = await import("./level");
    const stop = level.watchMotionPreference();
    d.query.matches = true; d.callbacks.forEach(fn => fn());
    expect(level.getMotionLevel()).toBe("off");
    d.query.matches = false; d.callbacks.forEach(fn => fn());
    expect(level.getMotionLevel()).toBe("full");
    expect(d.store.get("fs.motion")).toBe("full");
    stop();
    expect(d.callbacks.size).toBe(0);
  });
});
