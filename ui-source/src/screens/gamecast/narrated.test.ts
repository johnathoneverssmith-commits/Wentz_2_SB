import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { narrateBroadcast, narratePlay, narrationText } from "../../../../src/engine/narration.js";
import type { BroadcastPlay } from "@/domain";

import { Narrated } from "./Narrated";

/**
 * The Gamecast shows the engine's narration: the markup must carry the same
 * words as the stored `desc` would, with names (and only names) styled.
 */
const play = (over: Partial<BroadcastPlay>): BroadcastPlay => ({
  down: 3, ydstogo: 4, ballOn: 30, quarter: 3, clock: "7:12", call: "pass", depth: "SHORT", gained: 9, outcome: "complete", desc: "",
  firstDown: true, touchdown: false, turnover: false, passer: "Joe Burrow", targetOrRusher: "Tee Higgins", injuries: [], scoreAfter: [10, 7],
  ...over,
});

const html = (p: BroadcastPlay, extra: Partial<Parameters<typeof narrateBroadcast>[1]> = {}): string => {
  const n = narrateBroadcast([{ side: "home", plays: [p] }], { home: "CIN", away: "BAL", ...extra })[0]![0]!;
  return renderToStaticMarkup(createElement(Narrated, { n }));
};
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, "");

describe("Narrated", () => {
  it("renders the shared narration's words, with the names styled", () => {
    const p = play({});
    const m = html(p);
    expect(textOf(m)).toBe(narrationText(narratePlay(p, { side: "home" })));
    expect(m).toContain('<span class="gc-name">Joe Burrow</span>');
    expect(m).toContain('<span class="gc-name">Tee Higgins</span>');
    // only names carry the class
    expect((m.match(/gc-name/g) ?? []).length).toBe(2);
  });

  it("shows a defensive touchdown on a game saved without a score log, from the running score", () => {
    const pick = play({ outcome: "interception", gained: 0, firstDown: false, turnover: true, defender: "Marlon Humphrey" });
    const n = narrateBroadcast(
      [{ side: "home", plays: [play({ scoreAfter: [10, 0] }), { ...pick, scoreAfter: [10, 7] }] }],
      { home: "CIN", away: "BAL" },
    );
    expect(textOf(renderToStaticMarkup(createElement(Narrated, { n: n[0]![1]! })))).toMatch(/Marlon Humphrey .*touchdown/);
  });

  it("puts a flag before the snap it preceded, and says when a late kneel happened", () => {
    const p = play({
      quarter: 3, clock: "15:00",
      eventsBefore: [{ type: "kneel", team: 0, quarter: 2, clock: "0:19", beforePlayIndex: 0, down: 1 }],
    });
    const m = textOf(html(p));
    expect(m.startsWith("Q2 0:19 — CIN take a knee. ")).toBe(true);
    expect(m).toContain("Joe Burrow");
  });
});
