import { describe, expect, it } from "vitest";

import { engineProgressText } from "./EngineProgressLine.tsx";

describe("what the player reads while the engine downloads", () => {
  it("says it is looking, then how far along, then that it is starting", () => {
    expect(engineProgressText({ stage: "manifest", loaded: 0, total: 0 })).toMatch(/Looking for the game engine/);
    expect(engineProgressText({ stage: "download", asset: "artifacts", loaded: 2_621_440, total: 5_242_880 })).toBe(
      "Getting the game engine (first time only): 2.5 of 5.0 MB, 50%",
    );
    expect(engineProgressText({ stage: "start", loaded: 5_242_880, total: 5_242_880 })).toMatch(/Starting the game engine/);
  });
  it("never shows more than 100% or divides by nothing", () => {
    expect(engineProgressText({ stage: "download", loaded: 10, total: 5 })).toMatch(/100%/);
    expect(engineProgressText({ stage: "download", loaded: 0, total: 0 })).toMatch(/0%/);
  });
});
