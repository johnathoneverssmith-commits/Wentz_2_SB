import { describe, expect, it } from "vitest";
import { realPlayerNames } from "@/sim/MockSimulationService";
import { classDnaForLeague } from "@/sim/leagueDna";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { beginDraft, completeDraft } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { upgradeLeagueState } from "./saveMigration.ts";
import { draftClassTilt } from "./draftSupply.ts";

const cfg = { ...DEFAULT_CONFIG, humanGmCount: 0 };

describe("a new league plays original players", () => {
  it("is fictional by default: DNA record, no real names, ids that do not depend on process history", () => {
    const a = createLeague(77, cfg);
    const b = createLeague(77, cfg);
    const real = new Set(realPlayerNames().map((n) => n.toLowerCase()));
    expect(a.dna?.version).toBe(1);
    expect(Object.values(a.players).filter((p) => real.has(p.name.toLowerCase()))).toEqual([]);
    // two leagues from one seed, made one after the other in one process, are the same league
    expect(Object.keys(a.players)).toEqual(Object.keys(b.players));
    expect(Object.values(a.players).map((p) => [p.id, p.name, p.overall, p.age, p.potential])).toEqual(
      Object.values(b.players).map((p) => [p.id, p.name, p.overall, p.age, p.potential]),
    );
    expect(a.draftClass.map((p) => p.name)).toEqual(b.draftClass.map((p) => p.name));
  });
  it("different seeds are different leagues", () => {
    const a = createLeague(1, cfg);
    const b = createLeague(2, cfg);
    expect(a.dna!.dnaSeed).not.toBe(b.dna!.dnaSeed);
    const names = new Set(Object.values(a.players).map((p) => p.name));
    expect(Object.values(b.players).filter((p) => names.has(p.name)).length).toBeLessThan(40);
  });
  it("the fantasy draft completes with legal, full rosters", () => {
    const s = createLeague(5, cfg);
    beginDraft(s, "fantasy");
    completeDraft(s);
    for (const code of Object.keys(s.teams)) {
      const roster = Object.values(s.players).filter((p) => p.nfl_team === code);
      expect(roster.length, code).toBeGreaterThanOrEqual(46);
      for (const { pos, starters, count } of ROSTER_TEMPLATE) {
        if (starters === 0) continue;
        expect(roster.filter((p) => p.position === pos).length, `${code} ${pos}`).toBeGreaterThanOrEqual(Math.min(count, starters + 1));
      }
    }
  }, 60_000);
  it("the profile is public and qualitative; the class has its own", () => {
    const s = createLeague(9, cfg);
    expect(s.dna!.profile.blurb).not.toMatch(/\d/);
    expect(s.draftClassProfile?.title).toMatch(/Draft Class/);
    expect(s.draftClassProfile?.eraId).toBeNull();
    expect(JSON.stringify(s.dna!.profile)).not.toMatch(/potential|trueOverall/);
  });
});

describe("existing leagues keep what they have", () => {
  it("a legacy league has no DNA, the real players and the old balancing", () => {
    const s = createLeague(3, { ...cfg, playerPool: "legacy" });
    expect(s.dna).toBeUndefined();
    expect(s.draftClassProfile).toBeUndefined();
    expect(Object.values(s.players).some((p) => p.name === "Myles Garrett")).toBe(true);
    draftClassTilt(s);
    expect(s.agingIntegralSeason).toBe(s.season); // legacy still banks its integral term
  });
  it("loading a save never regenerates players or invents a DNA record", () => {
    const s = createLeague(3, { ...cfg, playerPool: "legacy" });
    const before = JSON.stringify(s.players);
    const saved = JSON.parse(JSON.stringify(s));
    upgradeLeagueState(saved);
    expect(saved.dna).toBeUndefined();
    expect(JSON.stringify(saved.players)).toBe(before);
  });
  it("a DNA league survives a save and reload: the same classes come back", () => {
    const s = createLeague(21, cfg);
    const saved = JSON.parse(JSON.stringify(s));
    upgradeLeagueState(saved);
    expect(saved.dna).toEqual(s.dna);
    expect(classDnaForLeague(saved.dna, 2031)).toEqual(classDnaForLeague(s.dna, 2031));
    expect(Object.keys(saved.players).length).toBe(Object.keys(s.players).length);
  });
  it("a DNA league steers its positions to a neutral target, not to how it opened", () => {
    const s = createLeague(33, cfg);
    beginDraft(s, "fantasy");
    completeDraft(s);
    draftClassTilt(s);
    expect(s.positionBaseline).toBeDefined();
    expect(s.agingIntegralSeason).toBeUndefined(); // no integral term in a DNA league
    const open = s.positionBaseline!;
    // the baseline is the same constant for every DNA league
    const t = createLeague(34, cfg);
    beginDraft(t, "fantasy");
    completeDraft(t);
    draftClassTilt(t);
    expect(t.positionBaseline).toEqual(open);
  }, 60_000);
});
