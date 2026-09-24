import { describe, expect, it } from "vitest";

import { accrueCareers, awardSeason } from "./seasonAwards.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

describe("season awards and careers", () => {
  it("names award winners from the season's stats, once, and banks careers", () => {
    const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const on = (pos: string) => Object.values(s.players).find((p) => p.position === pos && s.teams[p.nfl_team])!;
    const qb = on("QB");
    const edge = on("EDGE");
    const rb = Object.values(s.players).filter((p) => p.position === "RB" && s.teams[p.nfl_team])[3]!;
    qb.season_stats = { gamesPlayed: 17, passYds: 5100, passTd: 44, passInt: 8 };
    edge.season_stats = { gamesPlayed: 17, sacks: 19, tackles: 60 };
    rb.season_stats = { gamesPlayed: 16, rushYds: 1400, rushTd: 12 };
    rb.years_pro = 0;
    const yp = qb.years_pro ?? 0;

    const awards = awardSeason(s);
    expect(awards.find((a) => a.award === "MVP")?.playerId).toBe(qb.id);
    expect(awards.find((a) => a.award === "DPOY")?.playerId).toBe(edge.id);
    expect(awards.find((a) => a.award === "OROY")?.playerId).toBe(rb.id);
    expect(awardSeason(s)).toEqual([]); // once a season

    accrueCareers(s);
    accrueCareers(s); // idempotent
    expect(qb.career).toMatchObject({ seasons: 1, passYds: 5100, passTd: 44 });
    expect(qb.years_pro).toBe(yp + 1);
  });
});
