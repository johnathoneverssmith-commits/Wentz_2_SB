/**
 * Pre-pass for Experiment B2: how much of a rookie's hidden development gap (potential - overall) is realised after 1, 3, 5 offseasons
 * of the real aging model (applySeasonAging)? Signs every prospect of N generated classes onto a free-agent shelf at his public-expected round,
 * ages them, and regresses the change in overall on the gap. Copy to online/test/_ss_b2pre.test.ts.   SS=1 SS_OUT=out.json
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createLeague, DEFAULT_CONFIG, applySeasonAging } from "@/state/seed.ts";
import { expectedRatings } from "@/state/draftBoard.ts";
import { upsertRookiePlayer } from "@/state/rules.ts";
describe.skipIf(!process.env.SS)("b2 pre", () => {
  it("runs", () => {
    const rows: any[] = [];
    for (let seed = 9900; seed < 9908; seed++) {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 } as any);
      const e = expectedRatings(s.draftClass, 1);
      const ranked = [...s.draftClass].sort((a, b) => e.get(b.id)! - e.get(a.id)!);
      ranked.forEach((p, i) => { upsertRookiePlayer(s, p.id, "FA", Math.min(7, Math.ceil((i + 1) / 32)), true); });
      const ids = ranked.map((p) => `p_rookie_${p.id}`);
      const start = ids.map((id) => ({ o: s.players[id]!.overall, pot: s.players[id]!.potential!, pos: s.players[id]!.position, age: s.players[id]!.age }));
      const traj: number[][] = ids.map(() => []);
      for (let y = 1; y <= 5; y++) { applySeasonAging(s, s.season + y); ids.forEach((id, k) => traj[k]!.push(s.players[id]!.overall)); }
      ids.forEach((id, k) => rows.push({ seed, rank: k + 1, pos: start[k]!.pos, age: start[k]!.age, o0: start[k]!.o, gap: start[k]!.pot - start[k]!.o, d1: traj[k]![0]! - start[k]!.o, d3: traj[k]![2]! - start[k]!.o, d5: traj[k]![4]! - start[k]!.o }));
    }
    writeFileSync(process.env.SS_OUT ?? "b2pre.json", JSON.stringify(rows));
  }, 600_000);
});
