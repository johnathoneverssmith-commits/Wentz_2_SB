/**
 * What a rating gap is actually worth, measured against the engine.
 *
 * The franchise UI shows a pre-game win probability on the team hub and in
 * the matchup panel. Until now that number came from a formula somebody
 * reasoned their way to — `0.5 + 0.02 * ratingGap + homeEdge` — which is a
 * guess wearing a percentage sign. It has two problems beyond being a guess:
 * it is linear, so it clips at the ends and needs clamping, and its 0.02 per
 * rating point was never checked against a single simulated game.
 *
 * This runs the engine over every ordered pair of the 32 teams, several seeds
 * each, and fits a logistic to the result:
 *
 *     P(home win) = 1 / (1 + exp(-(a + b * gap)))
 *
 * where `gap` is the home team's starting-lineup mean `overall` minus the
 * away team's, computed from the same 23 slots the UI calls a starting
 * lineup (11 on offense, 10 on defense, a kicker and a punter). `a` is the
 * home-field advantage, and it is measured rather than assumed too.
 *
 * The sim options match what the franchise adapter actually runs
 * (`server/index.ts`): injuries on, no coaching layer. A fit against a
 * different sim than the game plays would be worse than no fit at all.
 *
 * Opt-in, because it is about fifteen minutes of engine time:
 *
 *     npx tsx analysis/27_win_probability.ts [--seeds 12]
 *
 * It prints the fitted coefficients, the empirical curve it fitted to, and
 * the old formula's error against the same data, then stops. Copying the
 * numbers into `ui-source/src/sim/win-probability.ts` is a deliberate step —
 * the same way the draft curve was lifted out of the nflverse fit.
 */
import type { Player } from "../src/schema/player.js";
import { Roster, roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const seedsPerPair = Number(
  process.argv[process.argv.indexOf("--seeds") + 1] || (process.argv.includes("--seeds") ? 12 : 12),
);

/**
 * The 23 slots the UI means by "starting lineup".
 *
 * `Roster.offense()` and `.defense()` fill exactly the slots the sim plays,
 * so this is the sim's own idea of who starts rather than a second one.
 */
function starterMean(r: Roster): number {
  const lineup: (Player | null)[] = [
    ...Object.values(r.offense()),
    ...Object.values(r.defense()),
    r.kicker(),
    r.punter(),
  ];
  const rated = lineup.filter((p): p is Player => p != null).map((p) => p.overall ?? 0);
  return rated.reduce((s, v) => s + v, 0) / rated.length;
}

interface Cell {
  gap: number;
  games: number;
  homeWins: number;
}

interface Entrant {
  name: string;
  team: string;
  roster: Roster;
  rating: number;
}

/**
 * The 32 real rosters, plus weakened copies of each.
 *
 * The real league is tightly packed — every team's starting lineup sits
 * between about 76 and 84 — so playing it against itself only ever measures
 * gaps of eight points or less. A franchise four years in is not tightly
 * packed: a rebuild that traded its stars away faces a contender across a gap
 * twice that wide, and the curve has to say something sensible there.
 *
 * So each team also enters as a copy with its best players missing. The
 * kicker and punter are always kept: they are often among a roster's highest
 * `overall`s, and a team with no kicker is a different sport rather than a
 * worse team.
 */
function allEntrants(): Entrant[] {
  const out: Entrant[] = [];
  for (const team of teamList().sort()) {
    const full = roster(team);
    const players = [...full.depth.values()].flat();
    for (const drop of [0, 6, 12, 20]) {
      const specialists = players.filter((p) => p.position === "K" || p.position === "P");
      const rest = players
        .filter((p) => p.position !== "K" && p.position !== "P")
        .sort((x, y) => (y.overall ?? 0) - (x.overall ?? 0))
        .slice(drop);
      const r = drop === 0 ? full : new Roster(team, [...specialists, ...rest]);
      out.push({
        name: drop === 0 ? team : `${team}-${drop}`,
        team,
        roster: r,
        rating: starterMean(r),
      });
    }
  }
  return out;
}

function run(): void {
  const entrants = allEntrants();

  const cells: Cell[] = [];
  let games = 0;
  let ties = 0;
  let points = 0;
  const started = Date.now();

  for (const h of entrants) {
    for (const a of entrants) {
      // never a team against a copy of itself
      if (h.team === a.team) continue;
      const gap = h.rating - a.rating;
      let homeWins = 0;
      let played = 0;
      for (let k = 0; k < seedsPerPair; k++) {
        // a seed per matchup and repetition, stable across runs
        const seed = (hash(`${h.name}|${a.name}|${k}`) >>> 0) % 2_000_000_000;
        const g = simulateGame(seed, h.team, a.team, {
          injuries: true,
          homeRoster: h.roster,
          awayRoster: a.roster,
        });
        const [hs, as_] = g.score as [number, number];
        points += hs + as_;
        played += 1;
        if (hs > as_) homeWins += 1;
        else if (hs === as_) ties += 1;
      }
      cells.push({ gap, games: played, homeWins });
      games += played;
    }
    process.stderr.write(
      `${h.name} done — ${games} games, ${Math.round((Date.now() - started) / 1000)}s\n`,
    );
  }

  const { a, b } = fitLogistic(cells);

  console.log("");
  console.log(`games            ${games}`);
  console.log(`seeds per pair   ${seedsPerPair}`);
  console.log(`ties             ${ties} (${((ties / games) * 100).toFixed(2)}%)`);
  console.log(`points/game      ${(points / games).toFixed(1)}`);
  const ratings = entrants.map((e) => e.rating);
  console.log(
    `rating spread    ${Math.min(...ratings).toFixed(1)} … ${Math.max(...ratings).toFixed(1)}`,
  );
  console.log("");
  console.log(`FIT   P(home win) = 1 / (1 + exp(-(A + B * gap)))`);
  console.log(`  A (home edge)  ${a.toFixed(5)}   → ${(logistic(a) * 100).toFixed(1)}% at an even matchup`);
  console.log(`  B (per point)  ${b.toFixed(5)}`);
  console.log("");

  // the empirical curve, so the fit can be checked by eye rather than trusted
  console.log("gap      n     actual   fitted   old");
  const buckets = bucketise(cells);
  let errNew = 0;
  let errOld = 0;
  for (const [label, mid, n, wins] of buckets) {
    const actual = wins / n;
    const fitted = logistic(a + b * mid);
    const old = Math.min(0.9, Math.max(0.1, 0.5 + mid * 0.02 + 0.04));
    errNew += n * Math.abs(actual - fitted);
    errOld += n * Math.abs(actual - old);
    console.log(
      `${label.padStart(7)} ${String(n).padStart(6)}   ${pct(actual)}   ${pct(fitted)}   ${pct(old)}`,
    );
  }
  console.log("");
  console.log(`mean |error|  fitted ${(errNew / games).toFixed(4)}   old ${(errOld / games).toFixed(4)}`);
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(6);
const logistic = (z: number): number => 1 / (1 + Math.exp(-z));

/** FNV-1a, so a matchup's seeds are the same on every run. */
function hash(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h;
}

/** Binomial logistic regression by IRLS. Two parameters, so this converges fast. */
function fitLogistic(cells: readonly Cell[]): { a: number; b: number } {
  let a = 0;
  let b = 0.05;
  for (let iter = 0; iter < 60; iter++) {
    // gradient and Hessian of the log-likelihood
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const c of cells) {
      const p = logistic(a + b * c.gap);
      const resid = c.homeWins - c.games * p;
      const w = c.games * p * (1 - p);
      g0 += resid;
      g1 += resid * c.gap;
      h00 += w;
      h01 += w * c.gap;
      h11 += w * c.gap * c.gap;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

/** Equal-width gap buckets, for looking at the curve rather than the fit. */
function bucketise(cells: readonly Cell[]): [string, number, number, number][] {
  const width = 2;
  const by = new Map<number, { n: number; wins: number; sum: number }>();
  for (const c of cells) {
    const k = Math.round(c.gap / width);
    const e = by.get(k) ?? { n: 0, wins: 0, sum: 0 };
    e.n += c.games;
    e.wins += c.homeWins;
    e.sum += c.gap * c.games;
    by.set(k, e);
  }
  return [...by.entries()]
    .sort((x, y) => x[0] - y[0])
    .filter(([, e]) => e.n >= 100)
    .map(([k, e]) => [
      `${k * width > 0 ? "+" : ""}${k * width}`,
      e.sum / e.n,
      e.n,
      e.wins,
    ]);
}

run();
