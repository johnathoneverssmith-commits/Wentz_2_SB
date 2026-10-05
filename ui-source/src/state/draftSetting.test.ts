import { describe, expect, it } from "vitest";

import { ROSTER_SIZE } from "@/sim/roster-template";

import { beginDraft } from "./rules";
import { applyDraftSetting, createLeague, DEFAULT_CONFIG } from "./seed";

const onTeams = (s: ReturnType<typeof createLeague>) => Object.values(s.players).filter((p) => s.teams[p.nfl_team]);

describe("switching the fantasy draft off", () => {
  it("a default league releases everyone, and switching off restores real rosters", () => {
    const s = createLeague(7, DEFAULT_CONFIG);
    expect(s.config.fantasyDraft).toBe(true);
    expect(onTeams(s)).toHaveLength(0);

    s.config = { ...s.config, fantasyDraft: false };
    applyDraftSetting(s);

    // every team has a full roster of its own players, priced and signed
    for (const code of Object.keys(s.teams)) {
      const squad = onTeams(s).filter((p) => p.nfl_team === code);
      expect(squad.length, `${code} roster`).toBe(ROSTER_SIZE);
      expect(squad.every((p) => !p.free_agent && p.contract), `${code} signed`).toBe(true);
    }
    // the spares are on the market, not lost
    expect(s.standingFreeAgents.length).toBeGreaterThan(0);
    for (const id of s.standingFreeAgents) expect(s.players[id]!.free_agent).toBe(true);
  });

  it("matches a league created with the draft off", () => {
    const direct = createLeague(7, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const toggled = createLeague(7, DEFAULT_CONFIG);
    toggled.config = { ...toggled.config, fantasyDraft: false };
    applyDraftSetting(toggled);
    const team = (s: typeof direct, code: string) =>
      onTeams(s).filter((p) => p.nfl_team === code).map((p) => p.id).sort();
    // the same players (only the choice among equally rated depth when a
    // squad is cut to 53 can differ)
    for (const code of Object.keys(direct.teams)) {
      const a = new Set(team(direct, code));
      const same = team(toggled, code).filter((id) => a.has(id)).length;
      expect(same, code).toBeGreaterThanOrEqual(ROSTER_SIZE - 10);
    }
  });

  it("switching it back on releases everyone again, and off again restores them", () => {
    const s = createLeague(7, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const before = onTeams(s).length;
    s.config = { ...s.config, fantasyDraft: true };
    applyDraftSetting(s);
    expect(onTeams(s)).toHaveLength(0);
    s.config = { ...s.config, fantasyDraft: false };
    applyDraftSetting(s);
    expect(onTeams(s).length).toBe(before);
  });

  it("restores a league saved before players remembered their team", () => {
    const s = createLeague(7, DEFAULT_CONFIG);
    for (const p of Object.values(s.players)) delete p.home_team;
    s.config = { ...s.config, fantasyDraft: false };
    applyDraftSetting(s);
    for (const code of Object.keys(s.teams)) {
      expect(onTeams(s).filter((p) => p.nfl_team === code).length, code).toBe(ROSTER_SIZE);
    }
  });
});

describe("the fantasy draft order", () => {
  const firstPick = (s: ReturnType<typeof createLeague>) => {
    beginDraft(s, "fantasy");
    return s.draft!.pickOrder[0]!;
  };

  it("is drawn per league, not the same every time", () => {
    // the default seed used to give every league the same order
    const firsts = new Set<string>();
    for (let i = 0; i < 24; i++) firsts.add(firstPick(createLeague(1, DEFAULT_CONFIG)));
    expect(firsts.size).toBeGreaterThan(5);
  });

  it("stays what it was once drawn", () => {
    const s = createLeague(1, DEFAULT_CONFIG);
    beginDraft(s, "fantasy");
    const a = [...s.draft!.pickOrder];
    s.draft = null;
    beginDraft(s, "fantasy");
    expect(s.draft!.pickOrder).toEqual(a);
  });
});
