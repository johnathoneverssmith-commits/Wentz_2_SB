/**
 * Fit `HOME_FIELD_SCALE` so the engine's home win rate matches the league's.
 *
 * `31_home_field.py` measured the target — **54.02%** of regular-season games
 * won by the home team over 2018-2025, by a mean margin of **+1.573** — and
 * the shape of the advantage, channel by channel. `home-field.ts` applies that
 * shape. What is left is its size, which is one number.
 *
 * ## Why every ordered pair
 *
 * The sweep plays every ordered pair of the 32 teams: KC hosting BUF *and*
 * BUF hosting KC, and so on for all 992. Roster strength then cancels exactly
 * — each team hosts as often as it visits, against the same opponents — so
 * the home win rate that comes out is the home-field effect and nothing else.
 * No need to control for schedule, and no need to assume the league is
 * balanced.
 *
 * Plain configuration: real rosters, no coaching layer, no injuries. Both of
 * those are symmetric between home and away, so they add variance without
 * moving the quantity being fitted.
 *
 * ## Why a line
 *
 * The shifts are small, so in log-odds the home advantage is very nearly
 * linear in the scale, through the origin (scale 0 is the old engine, and an
 * ordered-pair sweep of it is 50% by construction). So: measure at a couple
 * of scales, fit the slope, solve for the target, and then *verify* the
 * answer on a fresh, larger sample rather than trusting the extrapolation.
 *
 * Run:
 *     npx tsx analysis/32_fit_home_field.ts            # fit, then verify
 *     npx tsx analysis/32_fit_home_field.ts --verify 2.6
 */
import { roster, teamList, type Roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const TARGET_WIN_PCT = 0.540_2;
const TARGET_MARGIN = 1.573;

interface Sample {
  scale: number;
  games: number;
  homeWinPct: number;
  meanMargin: number;
  ties: number;
  pointsPerTeamGame: number;
}

/** FNV-1a, so a matchup's seeds are the same on every run and every scale. */
function hash(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/**
 * Play every ordered pair, `seeds` times each, at the scale this process was
 * started with.
 *
 * The scale is read once at module load from the environment, so a sweep runs
 * one child process per value — which is also what keeps each run as
 * deterministic as any other engine run.
 */
function measure(scale: number, seeds: number, rosters: Map<string, Roster>): Sample {
  const teams = [...rosters.keys()];
  let homeWins = 0;
  let ties = 0;
  let margin = 0;
  let points = 0;
  let games = 0;
  for (const home of teams) {
    for (const away of teams) {
      if (home === away) continue;
      for (let k = 0; k < seeds; k++) {
        const seed = hash(`${home}|${away}|${k}`) % 2_000_000_000;
        const g = simulateGame(seed, home, away);
        const [hs, as] = g.score;
        if (hs > as) homeWins += 1;
        else if (hs === as) ties += 1;
        margin += hs - as;
        points += hs + as;
        games += 1;
      }
    }
  }
  return {
    scale,
    games,
    homeWinPct: (homeWins + ties / 2) / games,
    meanMargin: margin / games,
    ties: ties / games,
    pointsPerTeamGame: points / games / 2,
  };
}

const logit = (p: number): number => Math.log(p / (1 - p));

function report(s: Sample, label: string): void {
  const err = (s.homeWinPct - TARGET_WIN_PCT) * 100;
  console.log(
    `${label.padEnd(22)} scale ${s.scale.toFixed(3).padStart(6)}  ` +
      `home ${(s.homeWinPct * 100).toFixed(2)}%  (target ${(TARGET_WIN_PCT * 100).toFixed(2)}%, ` +
      `${err >= 0 ? "+" : ""}${err.toFixed(2)}pp)  ` +
      `margin ${s.meanMargin >= 0 ? "+" : ""}${s.meanMargin.toFixed(3)}  ` +
      `pts/team ${s.pointsPerTeamGame.toFixed(2)}  n=${s.games}`,
  );
}

/**
 * Solve for the scale that hits the target, given samples taken at several.
 *
 * A quadratic rather than a line, because the effect saturates: measured at
 * 0, 2 and 4, the log-odds gained per unit of scale falls from 0.143 to
 * 0.109. Reading a slope off a single point and extrapolating — which is what
 * a line through the origin does — therefore overshoots, and overshoots by a
 * different amount depending on which point you read it from.
 *
 *     npx tsx analysis/32_fit_home_field.ts --solve 0:0.5018 2:0.5727 4:0.6251
 */
function solve(points: [number, number][]): void {
  if (points.length !== 3) throw new Error("need exactly three points for a quadratic");
  const [[x0, p0], [x1, p1], [x2, p2]] = points as [
    [number, number],
    [number, number],
    [number, number],
  ];
  const [y0, y1, y2] = [logit(p0), logit(p1), logit(p2)];
  // divided differences -> a + bx + cx^2
  const d01 = (y1 - y0) / (x1 - x0);
  const d12 = (y2 - y1) / (x2 - x1);
  const c = (d12 - d01) / (x2 - x0);
  const b = d01 - c * (x0 + x1);
  const a = y0 - b * x0 - c * x0 * x0;
  const target = logit(TARGET_WIN_PCT);
  const roots =
    c === 0
      ? [(target - a) / b]
      : (() => {
          const disc = b * b - 4 * c * (a - target);
          if (disc < 0) return [];
          return [(-b + Math.sqrt(disc)) / (2 * c), (-b - Math.sqrt(disc)) / (2 * c)];
        })();
  const best = roots.filter((r) => Number.isFinite(r) && r > 0).sort((m, n) => m - n)[0];
  const fitted = (x: number) => 1 / (1 + Math.exp(-(a + b * x + c * x * x)));
  console.log(
    `  fit    logit = ${a.toFixed(5)} ${b >= 0 ? "+" : "-"} ${Math.abs(b).toFixed(5)}x ` +
      `${c >= 0 ? "+" : "-"} ${Math.abs(c).toFixed(6)}x²`,
  );
  for (const [x, p] of points) {
    console.log(
      `    at ${x.toFixed(2)}   measured ${(p * 100).toFixed(2)}%   fitted ${(fitted(x) * 100).toFixed(2)}%`,
    );
  }
  console.log(`  target ${(TARGET_WIN_PCT * 100).toFixed(2)}%  (logit ${target.toFixed(5)})`);
  console.log(`  scale  ${best === undefined ? "no positive root" : best.toFixed(4)}`);
}

function main(): void {
  const argv = process.argv;

  // Solving is pure arithmetic on samples already taken, so it must not pay
  // for the roster pool — that check comes before anything touches it.
  const solveAt = argv.indexOf("--solve");
  if (solveAt >= 0) {
    solve(
      argv
        .slice(solveAt + 1)
        .filter((s) => s.includes(":"))
        .map((s) => s.split(":").map(Number) as [number, number]),
    );
    return;
  }

  const rosters = new Map(teamList().sort().map((t) => [t, roster(t)] as const));

  const verifyAt = argv.indexOf("--verify");
  if (verifyAt >= 0) {
    const scale = Number(argv[verifyAt + 1]);
    const seeds = Number(argv[argv.indexOf("--seeds") + 1]) || 12;
    console.log(`verifying scale ${scale} over ${992 * seeds} games\n`);
    report(measure(scale, seeds, rosters), "verify");
    return;
  }

  // One process can only hold one scale (it is read at load), so the sweep is
  // driven from outside — one child process per value. Here we just measure
  // whatever this process was given, and print it in the form `--solve` eats.
  const scale = Number(process.env.HOME_FIELD_SCALE ?? "0");
  const seeds = Number(argv[argv.indexOf("--seeds") + 1]) || 4;
  const s = measure(scale, seeds, rosters);
  report(s, "sample");
  console.log(`  log-odds ${logit(s.homeWinPct).toFixed(5)}   --solve point ${scale}:${s.homeWinPct.toFixed(4)}`);
}

main();
