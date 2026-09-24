import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type HgbPortableModel, predictProbaPortable, predictProbaPortableReference } from "../src/engine/hgb-portable.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * The compiled tree walk has to be the reference walk, exactly: every
 * resolver the engine ships, on feature vectors drawn from real games.
 */
function models(dir: string): HgbPortableModel[] {
  const out: HgbPortableModel[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...models(p));
    else if (f.endsWith(".json")) {
      try {
        const m = JSON.parse(readFileSync(p, "utf8"));
        if (m?.format === "hgb-portable-1") out.push(m);
      } catch {
        /* not a model */
      }
    }
  }
  return out;
}

describe("compiled HGB walk", () => {
  it("matches the reference walk bit for bit", () => {
    const all = models(join(__dirname, "..", "artifacts"));
    expect(all.length).toBeGreaterThan(0);
    let checked = 0;
    for (const m of all) {
      // random-but-fixed feature vectors, with missing values and unknown categories
      for (let k = 0; k < 40; k++) {
        const x: Record<string, number | string | null> = {};
        m.features.forEach((f, i) => {
          const r = Math.sin(k * 97 + i * 13) * 10000;
          const u = r - Math.floor(r);
          if (u < 0.08) x[f.name] = null;
          else if (f.categorical) x[f.name] = u < 0.9 ? String(Math.floor(u * 6)) : "??";
          else x[f.name] = (u - 0.5) * 40;
        });
        expect(predictProbaPortable(m, x)).toEqual(predictProbaPortableReference(m, x));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("a traced game is unchanged", () => {
    const a = simulateGame(4242, "KC", "BUF", { trace: true });
    expect(a.score).toEqual(simulateGame(4242, "KC", "BUF", { trace: true }).score);
  });
});
