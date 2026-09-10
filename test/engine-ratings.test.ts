import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import type { Player } from "../src/schema/player.js";
import {
  completionLogitShift,
  familyModifier,
  fgLogitShift,
  offsets,
  sackLogitShift,
} from "../src/engine/ratings.js";
import { roster } from "../src/engine/roster.js";

const fx = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/rating_cases.json", import.meta.url)), "utf8"),
) as {
  synthetic: { fam: string; players: Player[]; expected: number }[];
  offsets: Record<string, number>;
  shifts_SF_KC: Record<string, number>;
  qb1_ids: Record<string, string>;
};

describe("ratings.familyModifier (synthetic, pool-independent)", () => {
  for (const [i, c] of fx.synthetic.entries()) {
    it(`case ${i} — ${c.fam} × ${c.players.length}`, () => {
      expect(familyModifier(c.fam, c.players)).toBeCloseTo(c.expected, 10);
    });
  }

  it("clips z to ±3", () => {
    const huge = { id: "hi", attributes: { throw_accuracy_short: 200 } } as unknown as Player;
    const tiny = { id: "lo", attributes: { throw_accuracy_short: -200 } } as unknown as Player;
    const a = familyModifier("qb_accuracy", [huge]);
    const b = familyModifier("qb_accuracy", [tiny]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0);
    expect(a).toBeCloseTo(-b, 9); // symmetric — both hit the ±3 clip
  });
});

// The pool file is git-ignored (large); roster-dependent checks only run locally.
const hasPool = existsSync(LOCAL_POOL_PATH);
describe.runIf(hasPool)("ratings — against the live pool", () => {
  it("§12 offsets match the Python reference", () => {
    const got = offsets();
    for (const [fam, exp] of Object.entries(fx.offsets)) {
      expect(got[fam]).toBeCloseTo(exp, 8);
    }
  });

  it("resolver shift functions match Python for SF vs KC", () => {
    const o = roster("SF").offense();
    const d = roster("KC").defense();
    expect(o.QB1?.id).toBe(fx.qb1_ids.SF);

    expect(
      completionLogitShift([o.WR1, o.WR2, o.WR3, o.TE1], [d.CB1, d.CB2, d.S1, d.S2], o.QB1 ?? null),
    ).toBeCloseTo(fx.shifts_SF_KC.completion_SF_v_KC as number, 8);
    expect(
      sackLogitShift([o.LT, o.LG, o.C, o.RG, o.RT], [d.EDGE1, d.EDGE2, d.DT1, d.DT2]),
    ).toBeCloseTo(fx.shifts_SF_KC.sack_SF_v_KC as number, 8);
    expect(fgLogitShift(roster("SF").kicker())).toBeCloseTo(fx.shifts_SF_KC.fg_SF as number, 8);
  });
});
