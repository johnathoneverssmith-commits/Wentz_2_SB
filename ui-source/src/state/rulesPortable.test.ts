import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The rules have to run on a server.
 *
 * They used to live at the bottom of `store.ts`, which meant importing
 * `checkTrade` also constructed a zustand store, installed the persist
 * middleware and reached for `localStorage`. That's fine in a tab and fatal
 * in Node, and it's why an online league couldn't enforce the same rules the
 * client does — the single most important property of a server-authoritative
 * design.
 *
 * This is the guard: `rules.ts` stays free of zustand, storage, and anything
 * else that assumes a browser.
 */

/** `rules.ts` with its comments stripped, so prose can't trip the checks. */
function code(): string {
  const src = readFileSync(new URL("./rules.ts", import.meta.url), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the rules are portable", () => {
  it("imports without a window, a document, or localStorage", async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, localStorage: g.localStorage };
    delete g.window;
    delete g.document;
    delete g.localStorage;
    try {
      const rules = await import("./rules.ts");
      for (const name of [
        "checkTrade",
        "checkBid",
        "checkStandingSign",
        "applyTrade",
        "rosterLimitFor",
        "humanGate",
        "planAutopicks",
        "resolveBiddingDay",
        "commitRetirements",
      ] as const) {
        expect(typeof rules[name], name).toBe("function");
      }
    } finally {
      Object.assign(globalThis, saved);
    }
  });

  it("pulls in nothing from zustand or the persist layer", () => {
    // comments may *mention* these; the code may not use them
    const src = code();
    expect(src).not.toMatch(/zustand/);
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).not.toMatch(/import\.meta\.env/);
  });

  it("reaches no further than the pure model for its simulation calls", () => {
    // Hybrid/Http would try the network; Mock is deterministic anywhere
    expect(code()).not.toMatch(/HybridSimulationService|HttpSimulationService/);
  });
});
