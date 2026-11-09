import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backupJson, restoreFromText } from "./saveBackup.ts";
import { useStore } from "./store.ts";

/**
 * Phase 0 scheme fit x the per-dynasty simulator lock (#110): the two per-league settings are independent and must
 * stay so. A new dynasty gets both; an engine-backed dynasty sends the fit mode with every staff it posts to the
 * engine; a legacy save keeps its (absent) fit mode through backup/restore and reset; the lock never rewrites it.
 */
const s = () => useStore.getState();
let posted: string[] = [];

beforeEach(async () => {
  posted = [];
  await s().newLeague(5151);
  useStore.setState({ stage: "regularSeason", week: 1 } as never);
});
afterEach(() => vi.unstubAllGlobals());

/** An adapter that answers nothing but records every request body, so what the client sent can be inspected. */
function recordingAdapter() {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(init.body);
      return Promise.reject(new TypeError("Failed to fetch"));
    }),
  );
}
const staffsPosted = (): Record<string, { schemeFit?: string }>[] =>
  posted.map((b) => JSON.parse(b).staffs).filter(Boolean);

describe("scheme fit with the simulator lock", () => {
  it("a new dynasty gets both settings: derived fit and a recorded simulator", () => {
    expect(s().config.schemeFit).toBe("derived");
    expect(s().simEngine).toBeDefined();
  });

  it("an engine-backed derived dynasty sends schemeFit: derived on every staff it posts", async () => {
    useStore.setState({ simEngine: "engine" } as never);
    recordingAdapter();
    await s().simulateGameDay();
    const sent = staffsPosted();
    expect(sent.length).toBeGreaterThan(0);
    for (const staffs of sent) {
      const all = Object.values(staffs);
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((st) => st.schemeFit === "derived")).toBe(true);
    }
    expect(s().games).toHaveLength(0); // and the lock still refused to fall back to the Mock
  });

  it("an engine-backed legacy dynasty (no schemeFit) posts staffs with no schemeFit key", async () => {
    const { schemeFit: _drop, ...legacy } = s().config;
    useStore.setState({ simEngine: "engine", config: legacy } as never);
    recordingAdapter();
    await s().simulateGameDay();
    const sent = staffsPosted();
    expect(sent.length).toBeGreaterThan(0);
    for (const staffs of sent) expect(Object.values(staffs).some((st) => "schemeFit" in st)).toBe(false);
  });

  it("backup and restore keep a legacy dynasty legacy and a derived one derived, with the lock intact", async () => {
    useStore.setState({ simEngine: "engine" } as never);
    const derived = backupJson().text;
    const { schemeFit: _drop, ...legacy } = s().config;
    useStore.setState({ config: legacy } as never);
    const old = backupJson().text;

    await s().newLeague(1); // something else in the store
    expect((await restoreFromText(old)).ok).toBe(true);
    expect("schemeFit" in s().config).toBe(false);
    expect(s().simEngine).toBe("engine");

    expect((await restoreFromText(derived)).ok).toBe(true);
    expect(s().config.schemeFit).toBe("derived");
    expect(s().simEngine).toBe("engine");
  });

  it("starting a new dynasty gives it derived fit regardless of the old dynasty's mode", async () => {
    const { schemeFit: _drop, ...legacy } = s().config;
    useStore.setState({ config: legacy } as never);
    await s().newLeague(6161);
    expect(s().config.schemeFit).toBe("derived");
  });
});
