import { describe, expect, it } from "vitest";

import { contrastRatio, onColorFor, readableAccent, TEAMS } from "./teams.ts";

/**
 * A team's colour isn't decoration here — it's the accent the viewer's whole
 * app is painted in, and it's used for *text*: "You · Baltimore", "BAL vs
 * TEN". The old rule lifted a dark primary until relative luminance cleared
 * 0.09, which lands around 3:1; Baltimore's purple came out at 2.82:1 against
 * the panel. And badges printed white on the team colour regardless, so the
 * Chargers' powder blue carried white text at 3.6:1.
 */
const PANEL = "#15181b";

describe("team colours", () => {
  it("gives every one of the 32 a readable accent", () => {
    const failures = TEAMS.filter(
      (t) => contrastRatio(readableAccent(t).color, PANEL) < 4.5,
    ).map((t) => `${t.code} ${contrastRatio(readableAccent(t).color, PANEL).toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it("keeps the accent recognisably the team's own colour", () => {
    // lifting for legibility shouldn't wash every team to the same pale grey
    for (const t of TEAMS) {
      const accent = readableAccent(t).color;
      expect(accent, `${t.code}`).toMatch(/^#[0-9a-f]{6}$/i);
      // a washed-out result would be near-white; nothing should get that far
      expect(contrastRatio(accent, "#ffffff"), `${t.code} not washed out`).toBeGreaterThan(1.2);
    }
  });

  it("picks the readable foreground for text on a team fill", () => {
    for (const t of TEAMS) {
      const on = onColorFor(t.color);
      expect(contrastRatio(t.color, on), `${t.code} badge text`).toBeGreaterThanOrEqual(
        contrastRatio(t.color, on === "#ffffff" ? "#000000" : "#ffffff"),
      );
    }
  });

  it("gives the accent a foreground that reads on it", () => {
    for (const t of TEAMS) {
      const { color, onColor } = readableAccent(t);
      expect(contrastRatio(color, onColor), `${t.code}`).toBeGreaterThan(3);
    }
  });
});

/**
 * Two teams a reader cannot tell apart.
 *
 * Four franchises share a city — the Giants and the Jets, the Rams and the
 * Chargers — so a league table that printed `city` had two identical "New
 * York" rows and two identical "Los Angeles" ones, with nothing in the row to
 * say which was which. `label` is the name to put on screen, and its one
 * requirement is that it is a name and not a category.
 */
describe("team labels", () => {
  it("names every team distinctly", () => {
    const labels = TEAMS.map((t) => t.label);
    expect(new Set(labels).size).toBe(TEAMS.length);
  });

  it("keeps the city for the 28 teams that have one to themselves", () => {
    const shared = new Set(
      TEAMS.map((t) => t.city).filter((c, _, all) => all.filter((x) => x === c).length > 1),
    );
    for (const t of TEAMS) {
      if (shared.has(t.city)) expect(t.label).toContain(t.name);
      else expect(t.label).toBe(t.city);
    }
  });
});
