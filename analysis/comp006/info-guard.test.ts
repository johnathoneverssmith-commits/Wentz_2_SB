/**
 * COMP-006 information guard: the skilled policy may read only what a human GM can see.
 * Fails if `skilled.ts` (the whole policy) mentions a hidden field or a CPU-private evaluator.
 * Comments are stripped first so the rule can be *documented* in the file without tripping the guard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
