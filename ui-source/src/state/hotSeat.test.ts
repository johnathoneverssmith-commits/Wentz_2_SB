import { describe, expect, it } from "vitest";

import type { LeagueState, SeasonOutcome } from "@/domain";
import { awaitingNewJob, ensureHotSeat, jobSecurity, openJobs, placeUnemployed, takeNewJob } from "./hotSeat";

/** Just the parts of a league the hot seat reads. */
function league(seasons: [number, number, boolean?, SeasonOutcome["furthestRound"]?][], opts: { team?: string } = {}): LeagueState {
  const team = opts.team ?? "BUF";
  const codes = ["BUF", "MIA", "NYJ", "NE", "PIT", "KC", "DEN", "LV"];
  const teams = Object.fromEntries(
    codes.map((c, i) => [
      c,
      {
        wins: 4 + i,
        losses: 13 - i,
        ties: 0,
        ratings: { overallRank: i + 1 },
        controlledBy: c === team ? { kind: "human", gmId: "gm1" } : { kind: "ai" },
      },
    ]),
  );
  const last = 2026 + seasons.length - 1;
  return {
    season: last,
    gms: [{ id: "gm1", name: "Pat", isHuman: true, teamCode: team }],
    teams,
    teamSeasons: codes.map((c, i) => ({ season: last, team: c, wins: 4 + i, losses: 13 - i, ties: 0, pointsFor: 300 + i * 10, pointsAgainst: 400 - i * 10 })),
    history: seasons.map(([wins, losses, playoffs, round], i) => ({
      season: 2026 + i,
      gmId: "gm1",
      teamCode: team,
      madePlayoffs: !!playoffs,
      seed: 0,
      furthestRound: round ?? (playoffs ? "WC" : "none"),
      wonSuperBowl: round === "SB" && !!playoffs,
      regularSeasonRecord: { wins, losses, ties: 0 },
      eliminationMargin: null,
      pointDifferential: 0,
      rivalsEliminated: [],
    })),
  } as unknown as LeagueState;
}

describe("the hot seat", () => {
  it("never fires anyone in their first two seasons, however bad", () => {
    expect(jobSecurity(league([[2, 15]]), "gm1")!.level).not.toBe("fired");
    expect(jobSecurity(league([[2, 15], [2, 15]]), "gm1")!.level).not.toBe("fired");
  });

  it("fires a GM after three terrible seasons", () => {
    const j = jobSecurity(league([[3, 14], [3, 14], [3, 14]]), "gm1")!;
    expect(j.level).toBe("fired");
    expect(j.score).toBeLessThan(20);
  });

  it("puts two bad years on the hot seat, not out of a job", () => {
    const j = jobSecurity(league([[5, 12], [5, 12]]), "gm1")!;
    expect(j.level).toBe("hot");
  });

  it("leaves a middling team that misses the playoffs out of danger", () => {
    const j = jobSecurity(league([[8, 9], [8, 9], [8, 9], [8, 9], [8, 9]]), "gm1")!;
    expect(j.level).toBe("warm");
  });

  it("counts only the last five seasons, and only with this team", () => {
    // six great years then three awful ones: the cushion holds
    const good = Array.from({ length: 6 }, () => [13, 4, true, "CONF"] as [number, number, boolean, SeasonOutcome["furthestRound"]]);
    const s = league([...good, [3, 14], [3, 14], [3, 14]]);
    expect(jobSecurity(s, "gm1")!.seasons).toHaveLength(5);
    // a GM who changed teams starts over
    const moved = league([[3, 14], [3, 14], [3, 14]]);
    moved.history[0]!.teamCode = "MIA";
    const j = jobSecurity(moved, "gm1")!;
    expect(j.tenure).toBe(2);
    expect(j.level).not.toBe("fired");
  });

  it("offers the five worst CPU teams, never the GM's own or another person's", () => {
    const s = league([[3, 14], [3, 14], [3, 14]]);
    s.teams.MIA!.controlledBy = { kind: "human", gmId: "other" };
    const jobs = openJobs(s, "BUF");
    expect(jobs).toHaveLength(5);
    expect(jobs).not.toContain("BUF");
    expect(jobs).not.toContain("MIA");
    // worst record first (BUF is excluded, MIA is a person's)
    expect(jobs[0]).toBe("NYJ");
  });

  it("moves a fired GM to the team they choose, and the old team to the CPU", () => {
    const s = league([[3, 14], [3, 14], [3, 14]]);
    ensureHotSeat(s);
    expect(awaitingNewJob(s)).toHaveLength(1);
    expect(takeNewJob(s, "gm1", "LV").ok).toBe(false); // not on the list
    const r = takeNewJob(s, "gm1", "NYJ"); // (MIA, the worst, is also on the list)
    expect(r.ok).toBe(true);
    expect(s.gms[0]!.teamCode).toBe("NYJ");
    expect(s.teams.NYJ!.controlledBy).toEqual({ kind: "human", gmId: "gm1" });
    expect(s.teams.BUF!.controlledBy).toEqual({ kind: "ai" });
    expect(takeNewJob(s, "gm1", "MIA").ok).toBe(false); // only once
  });

  it("puts an absent fired GM on the worst team available", () => {
    const s = league([[3, 14], [3, 14], [3, 14]]);
    ensureHotSeat(s);
    const placed = placeUnemployed(s);
    expect(placed).toEqual([{ gmId: "gm1", from: "BUF", to: "MIA" }]);
    expect(awaitingNewJob(s)).toHaveLength(0);
  });

  it("is made once a season and then left alone", () => {
    const s = league([[3, 14], [3, 14], [3, 14]]);
    const a = ensureHotSeat(s);
    takeNewJob(s, "gm1", "NYJ");
    expect(ensureHotSeat(s)).toBe(a);
    expect(a.entries[0]!.chosen).toBe("NYJ");
  });
});
