/**
 * What is each new game-plan lever worth, and to whom?
 *
 *   npx tsx analysis/43_lever_audit.ts [--games 40] [--talent 1.5]
 *
 * Each lever is set to its extreme (+100, then -100) for every one of the 32
 * real rosters against the same opponents on the same seeds, and compared with
 * that roster on the standard plan. In points of margin a game:
 *
 *  - overall: the lever on an average roster. A lever that wins everywhere is
 *    a free lunch; one that loses everywhere is a trap nobody should set
 *  - best / worst fit: the eight rosters the lever suits (the most athletic
 *    quarterbacks for quarterback runs, the strongest-legged kickers for
 *    kickoffs, the most dangerous returners for returns) and the eight it
 *    does not
 */
import { cleanPlan, DEFAULT_PLAN, type GamePlan } from "../src/engine/gameplan.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { kickerLegZ, qbMobilityZ, returnerZ } from "../src/engine/synergy.js";

const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : f; };
const GAMES = Number(arg("games", "40"));
const TALENT = Number(arg("talent", "1.5"));
const teams = teamList();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const qbZ = (t: string) => qbMobilityZ(roster(t).depth.get("QB")?.[0]);
const legZ = (t: string) => kickerLegZ(roster(t).kicker());
const retZ = (t: string) => {
  const o = roster(t).offense();
  return Math.max(...[o.WR3, o.RB1, o.WR2].map((p) => returnerZ(p)));
};
const kids = (t: string) => [...roster(t).depth.values()].flat().filter((p) => p.years_pro === 0 && (p.overall ?? 0) >= 60).length;

const ONLY = arg("only", "");
const ALL: { key: keyof GamePlan; fit?: (t: string) => number; fitName?: string }[] = [
  { key: "qbRun", fit: qbZ, fitName: "QB mobility" },
  { key: "twoPoint" },
  { key: "fourthShort" },
  { key: "fourthLong" },
  { key: "kickoff", fit: legZ, fitName: "kicker leg" },
  { key: "returns", fit: retZ, fitName: "returner" },
  { key: "rookies", fit: kids, fitName: "usable rookies" },
];

const LEVERS = ONLY ? ALL.filter((l) => ONLY.split(",").includes(String(l.key))) : ALL;

function margin(team: string, plan: GamePlan): number {
  let m = 0, n = 0;
  for (let i = 0; i < GAMES; i++) {
    const opp = teams[(teams.indexOf(team) + 1 + ((i * 7) % 31)) % 32]!;
    if (opp === team) continue;
    const home = i % 2 === 0;
    const g = simulateGame(80000 + i * 31 + teams.indexOf(team), home ? team : opp, home ? opp : team, {
      homeRoster: roster(home ? team : opp),
      awayRoster: roster(home ? opp : team),
      overtime: "nfl",
      injuries: true,
      talentScale: TALENT,
      ...(home ? { homePlan: plan } : { awayPlan: plan }),
    });
    m += home ? g.score[0] - g.score[1] : g.score[1] - g.score[0];
    n++;
  }
  return m / n;
}

const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);
const base = new Map(teams.map((t) => [t, margin(t, cleanPlan(DEFAULT_PLAN))]));
console.log(`talent ${TALENT}, ${GAMES} games a roster; margin vs the standard plan (points/game)\n`);
console.log("lever            setting   overall   best-fit 8   worst-fit 8   fit by");
for (const { key, fit, fitName } of LEVERS) {
  for (const v of [100, -100]) {
    const plan = cleanPlan({ [key]: v });
    const delta = new Map(teams.map((t) => [t, margin(t, plan) - base.get(t)!]));
    let top = "", bot = "";
    if (fit) {
      const ranked = [...teams].sort((a, b) => fit(b) - fit(a));
      top = f(mean(ranked.slice(0, 8).map((t) => delta.get(t)!)));
      bot = f(mean(ranked.slice(-8).map((t) => delta.get(t)!)));
    }
    console.log(`${String(key).padEnd(16)} ${String(v).padStart(6)}   ${f(mean([...delta.values()])).padStart(7)}   ${top.padStart(10)}   ${bot.padStart(11)}   ${fitName ?? ""}`);
  }
}
