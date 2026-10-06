/**
 * Does each AI GM philosophy win through its own style?
 *
 *   npx tsx analysis/42_strategy_tournament.ts [--games 24] [--talent 1.5]
 *
 * Every plan an AI strategy plays (`STRATEGY_PLANS` in `src/engine/gameplan.ts`) is tried
 * by every one of the 32 real rosters against the same opponents on the same
 * seeds, and compared with that roster playing the standard plan. Two numbers
 * per strategy, in points of margin a game:
 *
 *  - overall: the plan on an average roster. A plan that is better everywhere
 *    is a free lunch (the league would steamroll); one that is worse everywhere
 *    is a handicap nobody should be given.
 *  - fit: the plan on the eight rosters it suits best (a passing plan on the
 *    best quarterbacks and receivers, a blitzing one on the best front seven,
 *    a running one on the best backs and line) against the eight it suits
 *    worst. The style should pay where the roster is built for it and cost
 *    where it isn't.
 */
import { cleanPlan, DEFAULT_PLAN, type GamePlan, STRATEGY_PLANS as AI_PLANS } from "../src/engine/gameplan.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : f; };
const GAMES = Number(arg("games", "24"));
const TALENT = Number(arg("talent", "1.5"));
const teams = teamList();

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const ovr = (t: string, pos: string[], n: number) => mean(pos.flatMap((p) => (roster(t).depth.get(p) ?? []).slice(0, n).map((x) => x.overall ?? 0)));

/** How well a roster suits each style, in rating points. */
const FIT: Record<string, (t: string) => number> = {
  pass_heavy: (t) => 0.5 * ovr(t, ["QB"], 1) + 0.3 * ovr(t, ["WR"], 3) + 0.2 * ovr(t, ["OT", "OG", "C"], 2),
  run_heavy: (t) => 0.4 * ovr(t, ["RB"], 1) + 0.4 * ovr(t, ["OT", "OG", "C"], 2) + 0.2 * ovr(t, ["TE"], 1),
  defense_heavy: (t) => 0.4 * ovr(t, ["EDGE", "DT"], 2) + 0.3 * ovr(t, ["ILB"], 2) + 0.3 * ovr(t, ["CB", "S"], 2),
  offense_heavy: (t) => ovr(t, ["QB", "RB", "WR", "TE", "OT", "OG", "C"], 2),
  high_ceiling: (t) => ovr(t, ["QB", "RB", "WR", "TE", "OT", "OG", "C"], 2),
  // ball control: a defence to hold the lead, and a back and a line to run it out
  high_floor: (t) => 0.5 * ovr(t, ["EDGE", "DT", "ILB", "CB", "S"], 2) + 0.3 * ovr(t, ["OT", "OG", "C"], 2) + 0.2 * ovr(t, ["RB"], 1),
  trenches_first: (t) => ovr(t, ["OT", "OG", "C", "EDGE", "DT"], 2),
  balanced: () => 0,
};

interface Tape {
  mean: number;
  /** standard deviation of a game's margin: a floor is a smaller one */
  sd: number;
  /** share of games decided by a score or less that the team won */
  close: number;
  /** share of games lost by two scores or more: the bad nights */
  blowouts: number;
}

function margin(team: string, plan: GamePlan): Tape {
  const ms: number[] = [];
  for (let i = 0; i < GAMES; i++) {
    const opp = teams[(teams.indexOf(team) + 1 + ((i * 7) % 31)) % 32]!;
    if (opp === team) continue;
    const home = i % 2 === 0;
    const g = simulateGame(60000 + i * 31 + teams.indexOf(team), home ? team : opp, home ? opp : team, {
      homeRoster: roster(home ? team : opp),
      awayRoster: roster(home ? opp : team),
      overtime: "nfl",
      injuries: true,
      talentScale: TALENT,
      ...(home ? { homePlan: plan } : { awayPlan: plan }),
    });
    ms.push(home ? g.score[0] - g.score[1] : g.score[1] - g.score[0]);
  }
  const m = mean(ms);
  const closeGames = ms.filter((x) => Math.abs(x) <= 8);
  return {
    mean: m,
    sd: Math.sqrt(mean(ms.map((x) => (x - m) ** 2))),
    close: closeGames.length ? closeGames.filter((x) => x > 0).length / closeGames.length : 0.5,
    blowouts: ms.filter((x) => x <= -17).length / Math.max(1, ms.length),
  };
}

const base = new Map(teams.map((t) => [t, margin(t, cleanPlan(DEFAULT_PLAN))]));
console.log(`talent ${TALENT}, ${GAMES} games a roster; margin vs the standard plan (points/game)
`);
console.log("strategy          overall    best-fit 8   worst-fit 8   spread  | sd of margin   close-game win%   17+ pt losses");
// --only name, and --try 'json' to measure a candidate plan under that name (the FIT metric of the name)
const ONLY = arg("only", "");
const TRY = arg("try", "");
const entries: [string, Partial<GamePlan>][] = TRY ? [[ONLY, JSON.parse(TRY) as Partial<GamePlan>]] : Object.entries(AI_PLANS).filter(([n]) => !ONLY || ONLY.split(",").includes(n));
for (const [name, partial] of entries) {
  if (name === "balanced") continue;
  const plan = cleanPlan(partial);
  const tapes = new Map(teams.map((t) => [t, margin(t, plan)]));
  const delta = new Map(teams.map((t) => [t, tapes.get(t)!.mean - base.get(t)!.mean]));
  const ranked = [...teams].sort((a, b) => FIT[name]!(b) - FIT[name]!(a));
  const top = mean(ranked.slice(0, 8).map((t) => delta.get(t)!));
  const bot = mean(ranked.slice(-8).map((t) => delta.get(t)!));
  const all = mean([...delta.values()]);
  const dd = (k: keyof Tape) => mean(teams.map((t) => tapes.get(t)![k] - base.get(t)![k]));
  const f = (x: number, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);
  const pc = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1);
  console.log(
    `${name.padEnd(16)} ${f(all).padStart(7)}   ${f(top).padStart(10)}   ${f(bot).padStart(11)}   ${f(top - bot).padStart(6)}  | ${f(dd("sd")).padStart(8)}   ${pc(dd("close")).padStart(14)}   ${pc(dd("blowouts")).padStart(11)}`,
  );
}
