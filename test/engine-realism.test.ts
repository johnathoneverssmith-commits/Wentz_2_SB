import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { playerLinesFrom } from "../server/boxscore-map.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { gameWeather } from "../src/engine/weather.js";

/**
 * A realism guard for the game as franchise leagues play it — rating layer,
 * team strength, synergy, injuries, NFL overtime, weather — against the
 * NFL's own numbers (`artifacts/validation/simulation_validation.json`).
 *
 * Every engine change that moves how units affect a play has to keep the
 * league looking like the league. The full measurement is
 * `analysis/39_league_metrics.ts` over thousands of games; this is the cheap
 * version that runs on every test pass, with bands wide enough for a few
 * hundred games' noise and narrow enough that a real regression (scoring off
 * by a field goal, sacks up a third, one linebacker making every tackle)
 * fails it.
 */

const real = JSON.parse(readFileSync("artifacts/validation/simulation_validation.json", "utf8")).empirical_raw;

const within = (v: number, target: number, rel: number) => {
  expect(v, `${v.toFixed(4)} vs ${target.toFixed(4)} ±${rel * 100}%`).toBeGreaterThan(target * (1 - rel));
  expect(v, `${v.toFixed(4)} vs ${target.toFixed(4)} ±${rel * 100}%`).toBeLessThan(target * (1 + rel));
};

describe("engine realism (franchise options)", () => {
  it("league rates and scoring stay near the NFL's", () => {
    const teams = teamList();
    const t = { att: 0, cmp: 0, int: 0, sack: 0, ruA: 0, ruY: 0, pts: 0, g: 0, t3: 0, c3: 0 };
    const margins: number[] = [];
    let k = 0;
    for (let i = 0; i < teams.length; i++) {
      for (let j = 1; j <= 9; j++) {
        const h = teams[i]!;
        const a = teams[(i + j * 3) % teams.length]!;
        if (h === a) continue;
        const seed = 31_000 + k++;
        const g = simulateGame(seed, h, a, {
          homeRoster: roster(h),
          awayRoster: roster(a),
          injuries: true,
          overtime: "nfl",
          weather: gameWeather(h, 1 + (k % 17), seed),
        });
        t.pts += g.score[0] + g.score[1];
        t.g += 2;
        margins.push(g.score[0] - g.score[1]);
        for (const side of [0, 1]) {
          const st = g.teams[side]!.s as Record<string, number>;
          t.att += st.pass_att ?? 0;
          t.cmp += st.completion ?? 0;
          t.int += st.int_thrown ?? 0;
          t.sack += st.sack ?? 0;
          t.ruA += st.rush_att ?? 0;
          t.ruY += st.rush_yards ?? 0;
          t.t3 += st.third_att ?? 0;
          t.c3 += st.third_conv ?? 0;
        }
      }
    }
    within(t.pts / t.g, real.per_game.points_per_team_game, 0.1);
    within(t.cmp / t.att, real.rates.completion_pct, 0.07);
    within(t.int / t.att, real.rates.int_rate_per_att, 0.3);
    within(t.sack / (t.att + t.sack), real.rates.sack_rate_per_dropback, 0.2);
    within(t.ruY / t.ruA, real.rates.yards_per_carry, 0.08);
    within(t.c3 / t.t3, 0.39, 0.1);
    const m = margins.reduce((a, b) => a + b, 0) / margins.length;
    const sd = Math.sqrt(margins.reduce((a, b) => a + (b - m) ** 2, 0) / margins.length);
    within(sd, 14.33, 0.2);
  }, 240_000);

  it("defensive credit spreads across a defense the way it does in the NFL", () => {
    const teams = teamList().slice(0, 8);
    const share = new Map<string, number>();
    let tackles = 0;
    let sacks = 0;
    let topSack = 0;
    const bySacker = new Map<string, number>();
    let k = 0;
    for (const h of teams) {
      for (const a of teams) {
        if (h === a) continue;
        const g = simulateGame(41_000 + k++, h, a, { homeRoster: roster(h), awayRoster: roster(a), trace: true, overtime: "nfl" });
        const lines = playerLinesFrom(g.playTrace ?? [], h, a, {
          [h]: [...roster(h).depth.values()].flat(),
          [a]: [...roster(a).depth.values()].flat(),
        } as never);
        for (const [team, side] of [[h, lines.home], [a, lines.away]] as const) {
          for (const l of side) {
            const key = `${team}|${l.name}`;
            share.set(key, (share.get(key) ?? 0) + (l.tackles ?? 0));
            tackles += l.tackles ?? 0;
            sacks += l.sacks ?? 0;
            bySacker.set(key, (bySacker.get(key) ?? 0) + (l.sacks ?? 0));
          }
        }
      }
    }
    // against his own team's total: no tackler near a third of it, and no
    // rusher with more than about half his team's sacks
    void tackles;
    void sacks;
    void topSack;
    const teamTotal = (m: Map<string, number>, team: string) =>
      [...m].filter(([k]) => k.startsWith(`${team}|`)).reduce((n, [, v]) => n + v, 0);
    for (const team of teams) {
      const tk = teamTotal(share, team);
      const sk = teamTotal(bySacker, team);
      const topT = Math.max(...[...share].filter(([k]) => k.startsWith(`${team}|`)).map(([, v]) => v));
      const topS = Math.max(...[...bySacker].filter(([k]) => k.startsWith(`${team}|`)).map(([, v]) => v));
      expect(topT / tk, `${team} top tackler share`).toBeLessThan(0.3);
      if (sk >= 15) expect(topS / sk, `${team} top sacker share`).toBeLessThan(0.55);
    }
  }, 240_000);
});
