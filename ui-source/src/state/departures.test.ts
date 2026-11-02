import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { recentReleasesOf, recordDeparture } from "./departures.ts";

/** A bare league is enough: the departure record only reads `season`. */
const at = (season: number, recentReleases?: unknown): LeagueState => ({ season, recentReleases }) as unknown as LeagueState;

describe("departure history ages per player, not per league (Codex P2)", () => {
  it("another team's later release does not refresh an old exclusion", () => {
    const s = at(2025);
    recordDeparture(s, "GB", "gb-old");
    s.season = 2026;
    recordDeparture(s, "KC", "kc-1");
    expect(recentReleasesOf(s, "GB"), "last season still counts").toEqual(["gb-old"]);
    s.season = 2027;
    recordDeparture(s, "KC", "kc-2");
    expect(recentReleasesOf(s, "GB"), "two seasons on, GB's 2025 release has aged out").toEqual([]);
    expect(recentReleasesOf(s, "KC").sort()).toEqual(["kc-1", "kc-2"]);
  });

  it("this season and last season are both barred, older is not", () => {
    const s = at(2030);
    recordDeparture(s, "GB", "a");
    s.season = 2031;
    recordDeparture(s, "GB", "b");
    expect(recentReleasesOf(s, "GB").sort()).toEqual(["a", "b"]);
    s.season = 2032;
    expect(recentReleasesOf(s, "GB")).toEqual(["b"]);
    s.season = 2033;
    expect(recentReleasesOf(s, "GB")).toEqual([]);
  });

  it("recording the same player twice in a season is harmless; re-releasing him later renews his bar", () => {
    const s = at(2025);
    recordDeparture(s, "GB", "p");
    recordDeparture(s, "GB", "p");
    expect(recentReleasesOf(s, "GB")).toEqual(["p"]);
    s.season = 2027; // re-signed elsewhere and released again two years on
    recordDeparture(s, "GB", "p");
    s.season = 2028;
    expect(recentReleasesOf(s, "GB")).toEqual(["p"]);
  });

  it("a save from before per-player stamps keeps its old meaning (its whole list is that season's)", () => {
    const old = at(2026, { season: 2026, byTeam: { GB: ["legacy"] } });
    expect(recentReleasesOf(old, "GB")).toEqual(["legacy"]);
    old.season = 2027;
    expect(recentReleasesOf(old, "GB")).toEqual(["legacy"]);
    recordDeparture(old, "KC", "k"); // converting it must not lose or refresh the legacy entry
    expect(recentReleasesOf(old, "GB")).toEqual(["legacy"]);
    old.season = 2028;
    expect(recentReleasesOf(old, "GB")).toEqual([]);
  });

  it("copy on write: a frozen snapshot's history is never touched", () => {
    const s = at(2026);
    recordDeparture(s, "GB", "a");
    const frozen = JSON.parse(JSON.stringify(s.recentReleases));
    const snap = { ...s } as LeagueState;
    recordDeparture(snap, "GB", "b");
    expect(s.recentReleases).toEqual(frozen);
  });
});
