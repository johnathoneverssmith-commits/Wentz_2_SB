import { describe, expect, it } from "vitest";

import type { GameResult, PlayerGameLine, TeamGameTotals } from "@/domain";
import { buildFanPosts, factsOf, starLine } from "./fanReactions";

const tot = (over: Partial<TeamGameTotals> = {}): TeamGameTotals => ({ points: 0, totalYards: 300, passYards: 200, rushYards: 100, plays: 60, thirdDownMade: 5, thirdDownAtt: 12, topSeconds: 1800, penalties: 5, penaltyYards: 40, turnovers: 1, byQuarter: [7, 7, 7, 7], ...over });
const line = (over: Partial<PlayerGameLine>): PlayerGameLine => ({ playerId: "p1", name: "Casey Moreno", position: "QB", ...over });
const base = (over: Partial<GameResult> = {}): GameResult => ({ id: "2026-REG-5-BUF-KC", week: 5, phase: "REG", homeTeam: "BUF", awayTeam: "KC", played: true, homeScore: 31, awayScore: 10, ...over });

describe("fan reactions", () => {
  it("are identical every time for the same game and team", () => {
    const g = base({ totals: { home: tot(), away: tot() } });
    expect(buildFanPosts(g, "BUF")).toEqual(buildFanPosts(g, "BUF"));
    expect(buildFanPosts(g, "BUF").map((p) => p.text)).not.toEqual(buildFanPosts(g, "KC").map((p) => p.text));
  });

  it("gives four to six posts from distinct fans, even for a score-only game", () => {
    for (let i = 0; i < 40; i++) {
      const posts = buildFanPosts(base({ id: `g${i}`, homeScore: i % 40, awayScore: (i * 7) % 35 }), "BUF");
      expect(posts.length).toBeGreaterThanOrEqual(4);
      expect(posts.length).toBeLessThanOrEqual(6);
      expect(new Set(posts.map((p) => p.handle)).size).toBe(posts.length);
    }
  });

  it("empty for an unplayed game", () => {
    expect(buildFanPosts(base({ played: false }), "BUF")).toEqual([]);
  });

  it("only names a player's feats that his line supports", () => {
    const star = line({ passYds: 342, passTd: 3, passAtt: 30 });
    expect(starLine(star)).toBe("342 yards and 3 TDs through the air");
    const lines = { home: [star, line({ playerId: "p2", name: "Dre Walker", position: "RB", rushYds: 40, rushAtt: 12 })], away: [] };
    const posts = buildFanPosts(base({ playerLines: lines }), "BUF");
    const text = posts.map((p) => p.text).join(" ");
    expect(text).not.toContain("Walker"); // 40 rushing yards is not a feat
    for (const p of posts.filter((x) => x.basis.startsWith("star:"))) expect(p.text).toContain("342");
    expect(text).not.toMatch(/three touchdowns|4 TDs/);
  });

  it("claims no comeback, turnovers or sacks without records of them", () => {
    const posts = buildFanPosts(base(), "BUF");
    for (const p of posts) expect(["comeback", "turnovers", "sacks-allowed", "sacks-made", "blown-lead"]).not.toContain(p.basis);
  });

  it("reads a real comeback from the scoring plays", () => {
    const sp = [
      { quarter: 1, team: "KC", description: "x", homeScore: 0, awayScore: 7 },
      { quarter: 2, team: "KC", description: "x", homeScore: 0, awayScore: 14 },
      { quarter: 3, team: "BUF", description: "x", homeScore: 7, awayScore: 14 },
      { quarter: 4, team: "BUF", description: "x", homeScore: 14, awayScore: 14 },
      { quarter: 4, team: "BUF", description: "x", homeScore: 17, awayScore: 14 },
    ];
    const g = base({ homeScore: 17, awayScore: 14, scoringPlays: sp });
    expect(factsOf(g, "BUF").maxDeficit).toBe(14);
    expect(buildFanPosts(g, "BUF", {}).some((p) => p.basis === "comeback" || p.basis === "close-win")).toBe(true);
    const comeback = buildFanPosts(g, "BUF").find((p) => p.basis === "comeback");
    if (comeback) expect(comeback.text).toMatch(/14/);
  });

  it("handles ties, shutouts and missing stats without throwing", () => {
    for (const [h, a] of [[17, 17], [0, 0], [20, 0], [0, 20], [3, 0]] as const) {
      expect(() => buildFanPosts(base({ homeScore: h, awayScore: a }), "BUF")).not.toThrow();
      expect(() => buildFanPosts(base({ homeScore: h, awayScore: a, totals: { home: tot({ byQuarter: [] }), away: tot() } }), "KC")).not.toThrow();
    }
    expect(buildFanPosts(base({ homeScore: 17, awayScore: 17 }), "BUF").some((p) => p.basis === "tie")).toBe(true);
    expect(buildFanPosts(base({ homeScore: 20, awayScore: 0 }), "BUF").every((p) => !/lost|loss/i.test(p.text) || p.basis.startsWith("score"))).toBe(true);
  });

  it("only mentions a streak the earlier games show", () => {
    const win = (id: string, w: number): GameResult => base({ id, week: w, homeScore: 24, awayScore: 10 });
    const g = base({ id: "g4", week: 4 });
    const withStreak = factsOf(g, "BUF", { prior: [win("g1", 1), win("g2", 2), win("g3", 3)] });
    expect(withStreak.streak).toEqual({ kind: "W", n: 4 });
    expect(factsOf(g, "BUF", { prior: [] }).streak).toBeNull();
  });
});
