import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hasFullPool } from "../src/data/players.js";
import type { Player } from "../src/schema/player.js";
import { roster, teamList } from "../src/engine/roster.js";
import { DEF_SCHEME_TAGS, OFF_SCHEME_TAGS } from "../src/engine/staff.js";
import {
  DEF_SLOTS,
  OFF_SLOTS,
  defSchemeFitShift,
  defSchemeFitShiftDerived,
  offSchemeFitShift,
  offSchemeFitShiftDerived,
  schemeFitBaseline,
  schemeFitSlotBaselines,
} from "../src/engine/staff-fit.js";

/**
 * TypeScript <-> Python numerical parity for the scheme-fit shifts
 * (src/engine/staff-fit.ts vs analysis/engine/staff_fit.py). The TS side
 * computes the shifts for fixed units — fully tagged, fully stripped and mixed
 * — and writes the inputs, its baselines and its answers to a fixture; the
 * Python check (analysis/engine/check_scheme_fit_parity.py) recomputes them from
 * the same inputs and baselines and must agree to 1e-9. The fixture is
 * regenerated here, so a TS change that is not mirrored fails this test.
 */
const FIXTURE = join(tmpdir(), "scheme_fit_parity.json");
const slim = (p: Player | null) => (p ? { position: p.position, attributes: p.attributes, scheme_tags: p.scheme_tags } : null);

describe.skipIf(!hasFullPool())("scheme fit TS/Python parity", () => {
  it("python reproduces the TypeScript shifts", () => {
    const teams = teamList().filter((_, i) => i % 4 === 0);
    const units: unknown[] = [];
    const shifts: unknown[] = [];
    for (const t of teams) {
      const r = roster(t);
      const o = r.offense() as Record<string, Player | null>;
      const d = r.defense() as Record<string, Player | null>;
      // tagged, stripped, and mixed (every other starter stripped)
      for (const mode of ["tagged", "stripped", "mixed"] as const) {
        const f = (p: Player | null, i: number) =>
          !p ? null : mode === "tagged" || (mode === "mixed" && i % 2 === 0) ? slim(p) : { ...slim(p)!, scheme_tags: [] };
        const off = OFF_SLOTS.map((s, i) => f(o[s] ?? null, i));
        const def = DEF_SLOTS.map((s, i) => f(d[s] ?? null, i));
        units.push({ off, def });
        shifts.push({
          off: Object.fromEntries(
            (Object.keys(OFF_SCHEME_TAGS) as (keyof typeof OFF_SCHEME_TAGS)[]).map((sc) => [
              sc,
              { legacy: offSchemeFitShift(sc, off.map((p) => p?.scheme_tags)), derived: offSchemeFitShiftDerived(sc, off as never) },
            ]),
          ),
          def: Object.fromEntries(
            (Object.keys(DEF_SCHEME_TAGS) as (keyof typeof DEF_SCHEME_TAGS)[]).map((sc) => [
              sc,
              { legacy: defSchemeFitShift(sc, def.map((p) => p?.scheme_tags)), derived: defSchemeFitShiftDerived(sc, def as never) },
            ]),
          ),
        });
      }
    }
    writeFileSync(FIXTURE, JSON.stringify({ baseline: schemeFitBaseline(), slots: schemeFitSlotBaselines(), units, shifts }));
    expect(existsSync(FIXTURE)).toBe(true);

    const py = spawnSync("python3", ["-I", "analysis/engine/check_scheme_fit_parity.py", FIXTURE], { encoding: "utf8" });
    if (py.error) return; // no python3 on this machine: the TS half still ran
    expect(py.stdout + py.stderr).toContain("parity ok");
    expect(py.status).toBe(0);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8")).units.length).toBe(teams.length * 3);
  });
});
