import { describe, expect, it } from "vitest";

import { portraitFor, portraitKey, portraitSignature, SKIN } from "./portrait";

describe("portraits", () => {
  it("are a pure function of player id and league", () => {
    expect(portraitFor("p_42", 7)).toEqual(portraitFor("p_42", 7));
    expect(portraitSignature(portraitFor("p_42", 7))).not.toBe(portraitSignature(portraitFor("p_42", 8)));
  });

  it("do not depend on anything that changes: a drafted rookie keeps his prospect's face", () => {
    expect(portraitKey("p_rookie_abc")).toBe("abc");
    expect(portraitFor("p_rookie_abc", 3)).toEqual(portraitFor("abc", 3));
  });

  it("are unique across a 20,000-player population", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(portraitSignature(portraitFor(`p_${i}`, 12345)));
    expect(seen.size).toBe(20_000);
  });

  it("spread across the traits rather than collapsing onto a few faces", () => {
    const skin = new Array(SKIN.length).fill(0) as number[];
    let beards = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const s = portraitFor(`id${i}`, 1);
      skin[s.skin]!++;
      if (s.beard > 0) beards++;
    }
    for (const c of skin) expect(c / N).toBeGreaterThan(0.09);
    expect(beards / N).toBeGreaterThan(0.4);
    expect(beards / N).toBeLessThan(0.8);
  });

  it("draws 2,000 portraits fast", () => {
    const t = performance.now();
    for (let i = 0; i < 2000; i++) portraitFor(`p_${i}`, 9);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
