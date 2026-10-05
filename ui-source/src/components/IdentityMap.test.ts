import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useStore } from "@/state/store";
import { IdentityMap } from "./IdentityMap";

describe("the draft summary's identity map", () => {
  it("draws every team once and groups the CPU teams by what their GM prioritizes", () => {
    // (server rendering reads the store's initial league: a fresh one)
    const html = renderToStaticMarkup(createElement(IdentityMap, { code: "GB" }));
    expect((html.match(/<circle/g) ?? []).length).toBe(Object.keys(useStore.getInitialState().teams).length);
    expect(html).toContain("Trenches first");
    expect(html).toContain("Prioritizes the pass");
  });
});
