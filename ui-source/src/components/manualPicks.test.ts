import { describe, expect, it } from "vitest";

import { cleanConfigPatch } from "@/state/rules";
import { DEFAULT_CONFIG, createLeague } from "@/state/seed";

import { manualPicksFrom } from "./ManualPicksInput";

describe("manual picks each, typed", () => {
  it("accepts 1 to a whole roster and nothing else", () => {
    expect(manualPicksFrom("1")).toBe(1);
    expect(manualPicksFrom("53")).toBe(53);
    for (const bad of ["", "0", "54", "5.5", "-3", "abc", "1e2"]) expect(manualPicksFrom(bad), bad).toBeNull();
  });

  it("is validated the same way when a commissioner changes it", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, humanGmCount: 2 });
    expect(cleanConfigPatch(s, { draftSimulateAfterPicks: 53 }).ok).toBe(true);
    expect(cleanConfigPatch(s, { draftSimulateAfterPicks: 54 }).ok).toBe(false);
    expect(cleanConfigPatch(s, { draftSimulateAfterPicks: 0 }).ok).toBe(false);
    expect(cleanConfigPatch(s, { draftSimulateAfterPicks: null }).ok).toBe(false);
  });
});
