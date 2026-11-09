import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { Roster } from "../../../src/engine/roster.ts";
import { derivedSchemeTags } from "../../../src/engine/scheme-tags.ts";
import { DEF_SCHEME_TAGS, OFF_SCHEME_TAGS } from "../../../src/engine/staff.ts";
import { DEF_SLOTS, OFF_SLOTS } from "../../../src/engine/staff-fit.ts";
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i);
/**
 * Regenerates artifacts/models/derived_fit_baseline.json (the centring for
 * derived scheme tags, src/engine/staff-fit.ts). Opt-in; needs a full engine pool only for imports:
 *   GEN_DERIVED_FIT_BASELINE=1 npm --prefix ui-source run test -- src/state/derivedFitBaseline.gen.test.ts
 */
it.runIf(!!process.env.GEN_DERIVED_FIT_BASELINE)("regenerate the derived-fit baseline", () => {
  const acc: any = { off: {}, def: {} }, n: any = { off: OFF_SLOTS.map(() => 0), def: DEF_SLOTS.map(() => 0) };
  for (const [side, T] of [["off", OFF_SCHEME_TAGS], ["def", DEF_SCHEME_TAGS]] as const) for (const sc of Object.keys(T)) acc[side][sc] = (side === "off" ? OFF_SLOTS : DEF_SLOTS).map(() => 0);
  for (const seed of SEEDS) {
    const s = createLeague(seed, DEFAULT_CONFIG); fillRosterGaps(s);
    const by: Record<string, any[]> = {};
    for (const p of Object.values(s.players)) if (!p.retired && p.nfl_team && p.nfl_team !== "FA" && !p.nfl_team.startsWith("PS:")) (by[p.nfl_team] ??= []).push(p);
    for (const t of Object.keys(by)) {
      const r = new Roster(t, by[t]);
      for (const [side, slots, T, u] of [["off", OFF_SLOTS, OFF_SCHEME_TAGS, r.offense()], ["def", DEF_SLOTS, DEF_SCHEME_TAGS, r.defense()]] as const) {
        slots.forEach((sl, i) => { const p = (u as any)[sl]; if (!p) return; const d = derivedSchemeTags(p); if (!d.length) return; n[side][i]++;
          for (const sc of Object.keys(T)) if (d.some((x) => (T as any)[sc].includes(x))) acc[side][sc][i]++; });
      }
    }
  }
  const out: any = { note: "Share of starters per lineup slot whose attribute-derived scheme tags match each scheme, averaged over 20 default (Seeded League DNA) leagues x 32 teams. Slot order: engine OFF_SLOTS / DEF_SLOTS (staff-fit.ts). Regenerate: ui-source/src/state/derivedFitBaseline.gen.test.ts.", seeds: SEEDS.length, off: {}, def: {} };
  for (const side of ["off", "def"] as const) for (const sc of Object.keys(acc[side])) out[side][sc] = acc[side][sc].map((c: number, i: number) => Math.round((c / n[side][i]) * 10000) / 10000);
  writeFileSync("../artifacts/models/derived_fit_baseline.json", JSON.stringify(out, null, 1));
}, 600000);
