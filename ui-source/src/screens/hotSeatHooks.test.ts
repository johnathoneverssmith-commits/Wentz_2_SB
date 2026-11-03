import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The hot seat screen shows an "owners are still reviewing" state until the
 * league's hot seat exists, and the hot seat can appear while the screen is
 * mounted (a league frame arriving). A hook called after that early return is
 * skipped on the first render and run on the next, which React rejects
 * ("rendered more hooks than during the previous render"). There is no DOM
 * test environment here, so this pins the structure: no hook call may follow
 * the early return inside `HotSeat`.
 */
describe("HotSeat hook order", () => {
  const src = readFileSync(new URL("./HotSeat.tsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function HotSeat()"));
  const early = body.indexOf("if (!hot) {");

  it("has the early return", () => {
    expect(early).toBeGreaterThan(0);
  });

  it("calls no hook after the early return", () => {
    const after = body.slice(early);
    expect(after.match(/\buse[A-Z]\w*\(/g) ?? []).toEqual([]);
  });

  it("still calls its hooks before it", () => {
    const before = body.slice(0, early);
    expect(before).toMatch(/useState</);
    expect(before).toMatch(/useEffect\(/);
  });
});
