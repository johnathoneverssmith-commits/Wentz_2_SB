/**
 * COMP-006 information guard: the skilled policy may read only what a human GM can see.
 * Fails if `skilled.ts` (the whole policy) mentions a hidden field or a CPU-private evaluator.
 * Comments are stripped first so the rule can be *documented* in the file without tripping the guard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { ALL_MODULES } from "./skilled.js";
import * as KRaw from "./skilled.js";
import { K } from "./driver.js";

const FORBIDDEN: [RegExp, string][] = [
  [/\bpotential\b/, "hidden player ceiling (privacyView.stripPrivatePlayerFields removes it from client documents)"],
  [/\btrueOverall\b/, "a prospect's hidden true rating"],
  [/\baiGms\b|\bstrategyOf\b|\bstrategyFor\b|\bdifficultyFor\b|\bdifficultyProfile\b/, "CPU GM strategy / skill / difficulty"],
  [/\bchooseFaMove\b|\bbestCoachingPick\b|\bcpuTurn\b|\brunCpu\w*\b|\bgenerateAiTradeOffers\b|\btradeAccepts\b/, "the CPU's own decision procedures"],
  [/\bMath\.random\b|\bseed\b|\bdeterministicNoiseUnit\b/, "RNG / seeds"],
  [/\.games\b|\.history\b/, "results the GM has not watched (state.games / state.history); use standings fields only"],
];

describe("skilled policy information guard", () => {
  const src = readFileSync(fileURLToPath(new URL("./skilled.ts", import.meta.url)), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, ""); // module paths are not data reads
  for (const [re, why] of FORBIDDEN) {
    it(`does not touch ${why}`, () => {
      const hit = code.match(re);
      expect(hit, hit ? `found "${hit[0]}"` : "").toBeNull();
    });
  }
  it("acts only through the GM-facing decision layer", () => {
    // skilled.ts decides; it never mutates league state itself
    expect(code).not.toMatch(/\bs\.(players|teams|draft|draftPicks|freeAgencyEvent|tradeDeadline)\b\s*(\.\w+\s*)*=[^=]/);
  });
});

/**
 * Behavioural check (the text scan above cannot see helpers the policy imports): decisions made through the driver's
 * client view must not depend on the hidden ceilings (`potential`) or on a prospect's `trueOverall`.
 */
describe("skilled policy is blind to hidden state", () => {
  const s = createLeague(7001, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false, talentImpact: "amplified" } as never);
  if (s.draftClass.length === 0) s.draftClass = new MockSimulationService().generateDraftClass(7001, s.season, {} as never, undefined as never);
  const team = "KC";
  const ctx = () => ({ s, team, seats: new Set<string>(), mods: new Set(ALL_MODULES), ledger: {} });
  const setHidden = (mode: "A" | "B"): void => {
    Object.values(s.players).forEach((p, i) => {
      p.potential = mode === "A" ? p.overall + 5 + (i % 7) : Math.max(40, 99 - (i % 13) * 3);
    });
    s.draftClass.forEach((pr, i) => {
      pr.trueOverall = mode === "A" ? pr.collegeOverall : Math.max(40, 99 - pr.collegeOverall + (i % 5));
    });
  };
  const decisions = (k: typeof KRaw): string => {
    const c = ctx();
    const out = {
      camp: k.campPlan(c),
      plan: k.gamePlan(c),
      depth: k.depthOrders(c),
      contracts: k.contractActions(c),
      bench: k.trimBench(c),
      cuts: k.capCuts(c),
      propose: k.proposeTurn(c),
      draft: k.draftPick(c, new Set<string>(), new Map<string, number>()),
    };
    return JSON.stringify(out);
  };
  it("decisions are identical under different hidden ceilings and prospect true ratings", () => {
    setHidden("A");
    const a = decisions(K);
    setHidden("B");
    const b = decisions(K);
    expect(b).toBe(a);
  });
  it("the check has power: without the client view the camp choice does read the ceilings", () => {
    const differs: string[] = [];
    setHidden("A");
    const rawA = decisions(KRaw);
    setHidden("B");
    const rawB = decisions(KRaw);
    if (rawA !== rawB) differs.push("some decision");
    expect(differs.length).toBeGreaterThan(0);
  });
  it("restores the hidden fields after every call", () => {
    setHidden("A");
    const before = JSON.stringify(Object.values(s.players).map((p) => p.potential));
    decisions(K);
    expect(JSON.stringify(Object.values(s.players).map((p) => p.potential))).toBe(before);
  });
});
