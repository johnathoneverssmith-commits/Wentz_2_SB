/**
 * Agent 3: free-agent sign-and-flip. For a fresh league: human team H signs a real free agent at his asking salary (expectedSalary),
 * then offers him to each CPU team for as many of that team's own (non-comp) picks as the REAL trade model (judgeWith acceptLikelihood >= 0.5)
 * and REAL legality check (checkTrade) allow. Greedy: highest-chart pick first. Read-only on production code.
 * Copy to ui-source/src/state/_a3_flip.test.ts; run  A3=1 A3_OUT=out.json npx vitest run src/state/_a3_flip.test.ts
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState, TradeAsset } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import { judgeWith, tradeContext, tradeAccepts } from "@/state/tradeModel.ts";
import { offerToContract, checkTrade } from "@/state/rules.ts";
import { picksOwnedBy } from "@/state/draftPicks.ts";
import { tradeAssetValue } from "@/sim/MockSimulationService";
const SEEDS = (process.env.A3_SEEDS ?? "11,12,13").split(",").map(Number);
const POS = ["QB","RB","WR","TE","OT","OG","C","EDGE","DT","ILB","CB","S","K","P"];
describe.skipIf(!process.env.A3)("flip", () => { it("measures", () => {
  const rows: any[] = [];
  for (const seed of SEEDS) {
    const base = createLeague(seed, DEFAULT_CONFIG); fillRosterGaps(base); recomputeTeamRatings(base);
    const teams = Object.keys(base.teams); const H = teams[seed % teams.length]!;
    for (const pos of POS) {
      // A fresh league's free-agent pool is leftovers (best QB ~71), so "market" free agents are modelled as the league's top players at the
      // position treated as if they hit the market (stripped of their old team, signed by H at expectedSalary). Documented limitation.
      const fas = Object.values(base.players).filter((p) => !p.retired && p.nfl_team !== H && p.position === pos && p.age <= 31).sort((a, b) => b.overall - a.overall);
      for (const rank of [0, 4]) for (const years of [1, 4]) for (const room of [false, true]) {
        const fa = fas[rank]; if (!fa) continue;
        const s: LeagueState = structuredClone(base);
        const p = s.players[fa.id]!; const sal = expectedSalary(p);
        p.contract = offerToContract({ teamCode: H, baseSalary: sal, signingBonus: 0, years, guaranteed: sal * years * 0.5 } as any) as any;
        p.nfl_team = H; p.free_agent = false;
        // room=true: every CPU team first drops its lowest-rated player, freeing a roster slot and a sliver of cap (models offseason space)
        if (room) for (const C of Object.keys(s.teams)) { if (C === H) continue; const low = Object.values(s.players).filter((q) => q.nfl_team === C && !q.retired && !q.free_agent).sort((a, b) => a.overall - b.overall)[0]; if (low) { low.nfl_team = "FA"; low.free_agent = true; low.contract = null; } }
        const ctx = tradeContext(s); const give: TradeAsset[] = [{ kind: "player", playerId: p.id }];
        let best = { team: "", value: 0, picks: 0 }; let sum = 0, n = 0; const why: Record<string, number> = {}; let bestLik = 0;
        for (const C of teams) { if (C === H) continue;
          const mine = picksOwnedBy(s, C).map((pk) => ({ kind: "pick", pick: pk }) as TradeAsset).sort((a, b) => tradeAssetValue(s, b) - tradeAssetValue(s, a));
          const take: TradeAsset[] = [];
          for (const a of mine) { const trial = [...take, a];
            const ev = judgeWith(ctx, H, C, give, trial); if (take.length === 0) bestLik = Math.max(bestLik, ev.acceptLikelihood);
            if (!tradeAccepts(ev.acceptLikelihood)) continue;
            const ck = checkTrade(s, { fromTeam: H, toTeam: C, fromAssets: give, toAssets: trial }); if (!ck.ok) { const k = (ck.reason ?? "?").slice(0, 40); why[k] = (why[k] ?? 0) + 1; continue; }
            take.push(a); }
          const v = take.reduce((x, a) => x + tradeAssetValue(s, a), 0);
          if (take.length) { sum += v; n++; }
          if (v > best.value) best = { team: C, value: v, picks: take.length };
        }
        rows.push({ seed, pos, rank, years, room, ovr: p.overall, age: p.age, salaryM: +sal.toFixed(2), capHit0: +(p.contract?.cap_hit_by_year[0] ?? 0).toFixed(2),
          chartValue: +tradeAssetValue(s, give[0]!).toFixed(1), bestTeam: best.team, bestPickValue: +best.value.toFixed(1), bestPicks: best.picks, teamsWillingToPay: n, meanPickValueWhenPaying: n ? +(sum / n).toFixed(1) : 0, bestFirstPickLikelihood: +bestLik.toFixed(2), blocked: Object.fromEntries(Object.entries(why).map(([k, v]) => [k.includes("cap") ? "cap" : k.includes("carry") ? "roster" : "other", 0]).map(([k]) => [k, Object.entries(why).filter(([kk]) => (kk.includes("cap") ? "cap" : kk.includes("carry") ? "roster" : "other") === k).reduce((a, [, v]) => a + v, 0)])) });
      }
    }
  }
  writeFileSync(process.env.A3_OUT ?? "flip.json", JSON.stringify(rows));
}, 3_000_000); });
