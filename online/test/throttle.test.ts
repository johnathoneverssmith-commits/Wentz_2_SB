import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAttempts,
  resetThrottle,
  retryAfterSeconds,
  tooManyAttempts,
} from "../src/throttle.js";

describe("login throttle", () => {
  beforeEach(() => resetThrottle());

  it("allows a normal run of typos", () => {
    for (let i = 0; i < 10; i++) expect(tooManyAttempts("a|bob")).toBe(false);
  });

  it("stops the eleventh attempt in the window", () => {
    for (let i = 0; i < 10; i++) tooManyAttempts("a|bob");
    expect(tooManyAttempts("a|bob")).toBe(true);
  });

  it("keeps separate accounts separate", () => {
    for (let i = 0; i < 11; i++) tooManyAttempts("a|bob");
    // a different name from the same address is its own bucket, and a
    // different address entirely certainly is
    expect(tooManyAttempts("a|alice")).toBe(false);
    expect(tooManyAttempts("b|bob")).toBe(false);
  });

  it("forgives once the window passes", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 11; i++) tooManyAttempts("a|bob", t0);
    expect(tooManyAttempts("a|bob", t0)).toBe(true);
    expect(tooManyAttempts("a|bob", t0 + 16 * 60_000)).toBe(false);
  });

  it("clears on a correct password, so one bad night isn't a lockout", () => {
    for (let i = 0; i < 10; i++) tooManyAttempts("a|bob");
    clearAttempts("a|bob");
    expect(tooManyAttempts("a|bob")).toBe(false);
  });

  it("reports a sane retry-after", () => {
    const t0 = 2_000_000;
    tooManyAttempts("a|bob", t0);
    const secs = retryAfterSeconds("a|bob", t0);
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(15 * 60);
  });
});
