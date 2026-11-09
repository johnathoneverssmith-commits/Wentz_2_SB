import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { engineStaffsFor } from "@/state/coachScale.ts";
import { emptyReveal } from "@/state/reveal.ts";
import { cleanConfigPatch } from "@/state/rules.ts";
import { migrateLeagueSave, CURRENT_SAVE_VERSION } from "@/state/saveMigration.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { regenerateBroadcast, simulateBlock } from "../src/blocks.js";
import { staffPairOf } from "../src/staffs.js";

/**
 * Phase 0 scheme fit — the per-league flag on the paths a game really takes.
 * No database needed.
 */
function league(schemeFit: "derived" | "legacy-absent"): LeagueState {
  const s = createLeague(2718, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  if (schemeFit === "legacy-absent") delete s.config.schemeFit;
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  s.reveal = emptyReveal();
  return s;
}

describe("scheme-fit flag: creation", () => {
  it("a new league (standalone and online both start from DEFAULT_CONFIG) is derived", () => {
    expect(createLeague(1, DEFAULT_CONFIG).config.schemeFit).toBe("derived");
    // online/src/leagues.ts: { ...DEFAULT_CONFIG, ...cleanConfigPatch(...).patch }
    const clean = cleanConfigPatch({ stage: "setup", config: DEFAULT_CONFIG } as LeagueState, { talentImpact: "extreme" }, { creating: true });
    expect(clean.ok).toBe(true);
    if (clean.ok) expect({ ...DEFAULT_CONFIG, ...clean.patch }.schemeFit).toBe("derived");
  });

  it("a client cannot choose the mode through the rules patch", () => {
    const r = cleanConfigPatch({ stage: "setup", config: DEFAULT_CONFIG } as LeagueState, { schemeFit: "legacy" }, { creating: true });
    expect(r.ok).toBe(false);
  });
});

describe("scheme-fit flag: saves", () => {
  it("a save without the field is still legacy after serialising, migrating and reloading", () => {
    const s = league("legacy-absent");
    const reloaded = migrateLeagueSave(JSON.parse(JSON.stringify(s)), CURRENT_SAVE_VERSION);
    expect("schemeFit" in reloaded.config).toBe(false);
    const staffs = Object.values(engineStaffsFor(reloaded));
    expect(staffs.some((st) => "schemeFit" in st)).toBe(false);
  });

  it("a derived league keeps the flag through serialisation, and on the staff payload sent to the engine", () => {
    const s = league("derived");
    const reloaded = migrateLeagueSave(JSON.parse(JSON.stringify(s)), CURRENT_SAVE_VERSION);
    expect(reloaded.config.schemeFit).toBe("derived");
    const pair = JSON.parse(JSON.stringify(staffPairOf(reloaded, "KC", "BUF")));
    expect(pair.homeStaff.schemeFit).toBe("derived");
    expect(pair.awayStaff.schemeFit).toBe("derived");
    expect(Object.values(engineStaffsFor(reloaded)).every((st) => st.schemeFit === "derived")).toBe(true);
  });
});

describe("scheme-fit flag: it reaches the games", () => {
  it("every online simulateGame call site takes its staffs from staffPairOf (blocks, playoffs, replays, previews)", () => {
    for (const f of readdirSync("src").filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(`src/${f}`, "utf8");
      const calls = text.match(/simulateGame\(/g)?.length ?? 0;
      if (calls === 0) continue;
      expect(text.match(/\.\.\.staffPairOf\(/g)?.length ?? 0, `${f}`).toBeGreaterThanOrEqual(calls);
    }
  });

  it("derived and legacy leagues play different games from the same seed; a derived replay ends at the saved score", () => {
    const a = league("derived");
    const b = league("legacy-absent");
    simulateBlock(a, "PRE", 1, 1);
    simulateBlock(b, "PRE", 1, 1);
    const scores = (s: LeagueState) => s.games.filter((g) => g.phase === "PRE").map((g) => `${g.id}:${g.homeScore}-${g.awayScore}`).sort();
    expect(scores(a).length).toBeGreaterThan(0);
    expect(scores(a)).not.toEqual(scores(b));

    const game = a.games.find((g) => g.phase === "PRE" && g.week === 1)!;
    const cast = regenerateBroadcast(a, game.id)!;
    expect(cast.finalScore).toEqual([game.homeScore, game.awayScore]);
    // and a second, identical derived league reproduces the block exactly
    const c = league("derived");
    simulateBlock(c, "PRE", 1, 1);
    expect(scores(c)).toEqual(scores(a));
  }, 300_000);
});
