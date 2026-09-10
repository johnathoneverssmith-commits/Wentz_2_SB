import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { simulateGame } from "../src/engine/sim.js";

/**
 * Whole-engine check: run a batch of TS games and confirm the emergent
 * per-team-game distributions land in the same place as the Python engine's
 * §22 validation (15/20 within 10% of the empirical 2023–25 baseline). The TS
 * PRNG is not a bit-match of numpy's, so tolerances are a touch looser than
 * §22's 10% and points carries the same known ~−11% gap.
 */
const emp = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/sim_empirical_targets.json", import.meta.url)),
    "utf8",
  ),
) as { rates: Record<string, number>; per_game: Record<string, number> };

const N = 120;

function run() {
  let comp = 0,
    catt = 0,
    pyd = 0,
    ay = 0,
    ints = 0,
    sacks = 0,
    dbks = 0,
    ryd = 0,
    ratt = 0,
    explRush = 0,
    explPass = 0,
    fgm = 0,
    fga = 0,
    rztrip = 0,
    rztd = 0;
  const plays: number[] = [];
  const drives: number[] = [];
  const pts: number[] = [];
  const passAtt: number[] = [];
  const rushAtt: number[] = [];

  for (let i = 0; i < N; i++) {
    const g = simulateGame(50_000 + i);
    for (const tm of g.teams) {
      const s = tm.s;
      const g0 = (k: string) => s[k] ?? 0;
      comp += g0("completion");
      catt += g0("pass_att");
      pyd += g0("pass_yards");
      ay += g0("air_yards");
      ints += g0("int_thrown");
      sacks += g0("sack");
      dbks += g0("dropbacks");
      ryd += g0("rush_yards");
      ratt += g0("rush_att");
      explRush += g0("explosive_rush");
      explPass += g0("explosive_pass");
      fgm += g0("fg_made");
      fga += g0("fg_att");
      rztrip += g0("rz_trip");
      rztd += g0("rz_td");
      plays.push(g0("plays"));
      drives.push(g0("drives"));
      pts.push(g0("points"));
      passAtt.push(g0("pass_att"));
      rushAtt.push(g0("rush_att"));
    }
  }
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  return {
    dropback_rate: dbks / (dbks + ratt),
    completion_pct: comp / catt,
    yards_per_attempt: pyd / catt,
    air_yards_per_attempt: ay / catt,
    int_rate_per_att: ints / catt,
    sack_rate_per_dropback: sacks / dbks,
    yards_per_carry: ryd / ratt,
    explosive_rush_rate: explRush / ratt,
    explosive_pass_rate: explPass / catt,
    fg_make_pct: fgm / fga,
    rz_td_rate: rztd / rztrip,
    plays_per_team_game: mean(plays),
    drives_per_team_game: mean(drives),
    points_per_team_game: mean(pts),
    pass_attempts_per_team_game: mean(passAtt),
    rush_attempts_per_team_game: mean(rushAtt),
  };
}

describe("TS engine — §22 parity", () => {
  const sim = run();

  const within = (key: string, tol: number) => {
    const e = emp.rates[key] ?? emp.per_game[key];
    if (e === undefined) throw new Error(`no empirical target for ${key}`);
    const s = sim[key as keyof typeof sim];
    const rel = Math.abs(s - e) / e;
    it(`${key}: ${s.toFixed(4)} vs emp ${e.toFixed(4)} (${(rel * 100).toFixed(1)}% ≤ ${(tol * 100).toFixed(0)}%)`, () => {
      expect(rel).toBeLessThanOrEqual(tol);
    });
  };

  // core football metrics — §22 holds these to 10%; allow 12% for the RNG diff + n
  for (const k of [
    "dropback_rate",
    "completion_pct",
    "yards_per_attempt",
    "air_yards_per_attempt",
    "int_rate_per_att",
    "sack_rate_per_dropback",
    "yards_per_carry",
    "explosive_rush_rate",
    "explosive_pass_rate",
    "fg_make_pct",
    "rz_td_rate",
    "drives_per_team_game",
    "pass_attempts_per_team_game",
    "rush_attempts_per_team_game",
  ]) {
    within(k, 0.12);
  }
  within("plays_per_team_game", 0.13); // engine runs ~7% hot (known)

  it(`points_per_team_game ${sim.points_per_team_game.toFixed(1)} — in [17, 23] (Python ~20, emp 22.6, known ~−11% gap)`, () => {
    expect(sim.points_per_team_game).toBeGreaterThan(17);
    expect(sim.points_per_team_game).toBeLessThan(23);
  });
});
