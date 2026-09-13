import { describe, expect, it } from "vitest";

import { millions, money, ordinal, pct, seconds } from "./format.ts";

/**
 * These render whatever the state hands them, and the state round-trips
 * through JSON — where a NaN comes back as `null`. One coordinator's salary
 * arrived that way, `null.toFixed(1)` threw, React unmounted the tree, and
 * the whole app went white with no way back (a reload returns to the same
 * screen, since the stage is persisted too).
 */
describe("formatters", () => {
  const bad = [null, undefined, NaN, Infinity, -Infinity] as unknown as number[];

  it("renders a dash rather than throwing on a value that isn't a number", () => {
    for (const v of bad) {
      expect(() => millions(v)).not.toThrow();
      expect(millions(v)).toBe("—");
      expect(money(v)).toBe("—");
      expect(pct(v)).toBe("—");
      expect(seconds(v)).toBe("—");
      expect(ordinal(v)).toBe("—");
    }
  });

  it("still formats real numbers the way it always did", () => {
    expect(millions(12.36)).toBe("$12.4M");
    expect(millions(0)).toBe("$0.0M");
    expect(money(12_400_000)).toBe("$12.4M");
    expect(money(780_000)).toBe("$780K");
    expect(pct(0.625, 1)).toBe("62.5%");
    expect(seconds(125)).toBe("2:05");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(12)).toBe("12th");
  });
});
