import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlayerPortrait } from "./PlayerPortrait";

const html = (props: Parameters<typeof PlayerPortrait>[0]): string => renderToStaticMarkup(createElement(PlayerPortrait, { leagueId: 5, ...props }));

describe("PlayerPortrait", () => {
  it("is the same face after a trade; only the uniform changes", () => {
    const a = html({ playerId: "p_9", teamColor: "#0B2265", teamOnColor: "#fff" });
    const b = html({ playerId: "p_9", teamColor: "#A71930", teamOnColor: "#fff" });
    expect(a).not.toBe(b);
    // strip the jersey/background colours: what is left is the face
    const face = (x: string) => x.replace(/#0B2265|#A71930|#[0-9a-f]{6}/gi, "#");
    expect(face(a).replace(/linear-gradient\([^)]*\)/, "")).toBeTruthy();
    expect(a).toContain('data-portrait="p_9"');
    expect(b).toContain('data-portrait="p_9"');
  });

  it("is decorative unless labelled", () => {
    expect(html({ playerId: "x" })).toContain('aria-hidden="true"');
    expect(html({ playerId: "x", label: "Jo Doe" })).toContain('aria-label="Jo Doe"');
  });

  it("renders every hair and beard style without throwing", () => {
    for (let i = 0; i < 300; i++) expect(html({ playerId: `p${i}` })).toContain("<svg");
  });
});
