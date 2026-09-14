import { describe, expect, it } from "vitest";

import { millions, money, ordinal, pct, points, seconds } from "./format.ts";

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
      expect(points(v)).toBe("—");
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

/**
 * Tracker points are whole until two GMs finish level, at which point the
 * placement point is split three ways and the score tracker rendered the raw
 * division: `11.333333333333334` in the standings, `-0.6666666666666667`
 * beside it.
 */
describe("points", () => {
  it("leaves a whole number whole", () => {
    expect(points(0)).toBe("0");
    expect(points(9)).toBe("9");
    expect(points(-2)).toBe("-2");
  });

  it("cuts a split point to two decimals", () => {
    expect(points(1 / 3)).toBe("0.33");
    expect(points(34 / 3)).toBe("11.33");
    expect(points(-2 / 3)).toBe("-0.67");
  });

  it("doesn't leave a trailing zero on a half", () => {
    expect(points(0.5)).toBe("0.5");
    expect(points(2.5)).toBe("2.5");
    expect(points(2.25)).toBe("2.25");
  });
});
