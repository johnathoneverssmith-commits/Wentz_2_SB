/** Exact (noise-free) scheme-fit shifts of staff-fit.ts for tagged (pool-2026) vs tagless rosters, per scheme, mean over the 32 rosters. */
import { writeFileSync } from "node:fs";
const ROOT = process.env.ENGINE_ROOT ?? new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const fit = await import(`${ROOT}/src/engine/staff-fit.ts`);
const { roster, teamList } = await import(`${ROOT}/src/engine/roster.ts`);
const OFF = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT"], DEF = ["EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2"];
const out: any = { offense: {}, defense: {} };
const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
for (const [side, schemes] of [["offense", ["west_coast", "vertical", "spread", "power_run", "zone_run"]], ["defense", ["four_three", "three_four", "cover_3", "cover_2", "man_press"]]] as const) {
  for (const s of schemes) {
    const tagged: number[][] = [[], []], tagless: number[][] = [[], []];
    for (const t of teamList()) {
      const r = roster(t); const l = side === "offense" ? r.offense() : r.defense(); const slots = side === "offense" ? OFF : DEF;
      const tags = slots.map((k) => (l as any)[k]?.scheme_tags), none = slots.map(() => []);
      const f = side === "offense" ? fit.offSchemeFitShift : fit.defSchemeFitShift;
      const a = f(s, tags), b = f(s, none);
      tagged[0]!.push(a.complete); tagged[1]!.push(a.rush); tagless[0]!.push(b.complete); tagless[1]!.push(b.rush);
    }
    out[side][s] = { tagged: { completeLogit: +m(tagged[0]!).toFixed(4), ydPerCarry: +m(tagged[1]!).toFixed(4) }, tagless: { completeLogit: +m(tagless[0]!).toFixed(4), ydPerCarry: +m(tagless[1]!).toFixed(4) } };
  }
}
writeFileSync(process.argv[2] ?? "diagD1.json", JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
