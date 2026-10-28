import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TRADE_ACCEPT_THRESHOLD, tradeAccepts, tradeVerdict } from "./tradeModel.ts";

/**
 * What the trade screens say about the CPU's score. The answer is deterministic at 50% (`tradeAccepts`), so a screen must say
 * "would accept" or "would decline", never "N% likely", and a score under the line must not look like an uncertain yes.
 */
describe("the verdict a trade screen shows", () => {
  it("says would accept at 50% and above, would decline below, whatever the rounding", () => {
    expect(tradeVerdict(0.49).text).toBe("Would decline — Trade interest: 49%");
    expect(tradeVerdict(0.5).text).toBe("Would accept — Trade interest: 50%");
    expect(tradeVerdict(0.51).text).toBe("Would accept — Trade interest: 51%");
    // 49.6% rounds to 50 but is under the line: it reads 49 and declines, so no screen shows "Would decline — 50%"
    expect(tradeVerdict(0.496).text).toBe("Would decline — Trade interest: 49%");
    expect(tradeVerdict(0.4999).percent).toBe(49);
    expect(tradeVerdict(0.5001).percent).toBe(50);
  });

  it("is the same decision the model makes, across the whole scale", () => {
    for (let i = 0; i <= 1000; i++) {
      const l = i / 1000;
      const v = tradeVerdict(l);
      expect(v.accepts, `${l}`).toBe(tradeAccepts(l));
      expect(v.text.startsWith(v.accepts ? "Would accept" : "Would decline")).toBe(true);
      // the number never contradicts the words
      expect(v.accepts ? v.percent >= 50 : v.percent < 50, `${l}`).toBe(true);
    }
    expect(TRADE_ACCEPT_THRESHOLD).toBe(0.5);
  });

  it("never colours a decline as a possible yes: a decline is the bad colour, from 0% to 49%", () => {
    for (let i = 0; i < 500; i++) expect(tradeVerdict(i / 1000).tone, `${i / 10}%`).toBe("bad");
    expect(tradeVerdict(0.5).tone).toBe("notice"); // a close yes
    expect(tradeVerdict(0.64).tone).toBe("notice");
    expect(tradeVerdict(0.65).tone).toBe("good");
    expect(tradeVerdict(1).tone).toBe("good");
  });

  it("explains the line", () => {
    expect(tradeVerdict(0.3).explanation).toMatch(/50% or above/);
    expect(tradeVerdict(0.3).explanation).toMatch(/not a chance/);
  });
});

describe("the trade screens", () => {
  const screens = ["TradeProposal.tsx", "TradeDeadlineRoom.tsx"].map((f) => [f, readFileSync(new URL(`../screens/${f}`, import.meta.url), "utf8")] as const);

  it.each(screens)("%s shows the verdict, not a probability", (_name, source) => {
    expect(source).toContain("tradeVerdict(");
    expect(source).toContain("verdict.text");
    for (const bad of [/likely to accept/i, /accept likelihood/i, /% likely/i, /chance of accept/i, /probab/i]) {
      expect(source, `${bad}`).not.toMatch(bad);
    }
    // the old colour bands put 35 to 65 percent in amber, which read as a maybe for a decline
    expect(source).not.toMatch(/acceptLikelihood >= 0\.35/);
    expect(source).not.toMatch(/pct >= 35/);
  });
});
