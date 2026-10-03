/**
 * Who gets the defensive stats — and are the league leaders believable?
 *
 *   npx tsx analysis/41_defensive_leaders.ts [--seasons N] [--talent T]
 *
 * Plays N 17-game seasons of the 32 real rosters with the play trace on, and
 * tallies the credit the adapter's box score gives (sacks, interceptions,
 * passes defended, forced fumbles, tackles) the way `server/boxscore-map.ts`
 * does. Reports each category's league leader and 10th place against the
 * NFL's usual range, and whether the credit follows skill: how often the
 * better of each team's two starting corners (by overall) out-intercepts and
 * out-defends the other.
 */
import { playerLinesFrom } from "../server/boxscore-map.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const SEASONS = Number(arg("seasons", "2"));
const TALENT = Number(arg("talent", "1.5"));

type Tally = { sacks: number; defInt: number; passDef: number; ffum: number; tackles: number };
const teams = teamList();
const leaders: Record<keyof Tally, number[][]> = { sacks: [], defInt: [], passDef: [], ffum: [], tackles: [] };
let betterCbMorePicks = 0;
let betterCbMorePds = 0;
let cbPairs = 0;

for (let season = 0; season < SEASONS; season++) {
  const tally = new Map<string, Tally>();
  // a 17-game season: each team's opponents in a rotation, home and away alternating
  for (let wk = 0; wk < 17; wk++) {
    const order = [...teams].sort((a, b) => ((a.charCodeAt(0) * 31 + wk * 7 + season) % 97) - ((b.charCodeAt(0) * 31 + wk * 7 + season) % 97) || a.localeCompare(b));
    for (let i = 0; i < order.length; i += 2) {
      const [h, a] = wk % 2 === 0 ? [order[i]!, order[i + 1]!] : [order[i + 1]!, order[i]!];
      const g = simulateGame(90_000 + season * 1000 + wk * 40 + i, h, a, {
        homeRoster: roster(h),
        awayRoster: roster(a),
        injuries: true,
        talentScale: TALENT,
        trace: true,
        overtime: "nfl",
      });
      const lines = playerLinesFrom(g.playTrace ?? [], h, a, { [h]: [...roster(h).depth.values()].flat(), [a]: [...roster(a).depth.values()].flat() } as never);
      for (const [team, side] of [[h, lines.home], [a, lines.away]] as const) {
        for (const l of side) {
          const key = `${team}|${l.name}`;
          const t = tally.get(key) ?? { sacks: 0, defInt: 0, passDef: 0, ffum: 0, tackles: 0 };
          t.sacks += l.sacks ?? 0;
          t.defInt += l.defInt ?? 0;
          t.passDef += l.passDef ?? 0;
          t.ffum += l.ffum ?? 0;
          t.tackles += l.tackles ?? 0;
          tally.set(key, t);
        }
      }
    }
  }
  for (const k of Object.keys(leaders) as (keyof Tally)[]) {
    leaders[k].push([...tally.values()].map((t) => t[k]).sort((x, y) => y - x));
  }
  // does credit follow skill? each team's two starting corners
  for (const t of teams) {
    const cbs = (roster(t).depth.get("CB") ?? []).slice(0, 2);
    if (cbs.length < 2) continue;
    const [hi, lo] = (cbs[0]!.overall ?? 0) >= (cbs[1]!.overall ?? 0) ? [cbs[0]!, cbs[1]!] : [cbs[1]!, cbs[0]!];
    if ((hi.overall ?? 0) === (lo.overall ?? 0)) continue;
    const a = tally.get(`${t}|${hi.name}`);
    const b = tally.get(`${t}|${lo.name}`);
    if (!a || !b) continue;
    cbPairs++;
    if (a.defInt > b.defInt) betterCbMorePicks++;
    if (a.passDef > b.passDef) betterCbMorePds++;
  }
}

const real: Record<keyof Tally, string> = {
  sacks: "leader ~15-20, 10th ~11-12",
  defInt: "leader ~7-9, 10th ~5",
  passDef: "leader ~18-23, 10th ~14",
  ffum: "leader ~5-6, 10th ~3-4",
  tackles: "leader ~140-170, 10th ~120",
};
console.log(`${SEASONS} season(s), talent ${TALENT}\n`);
for (const k of Object.keys(leaders) as (keyof Tally)[]) {
  const avg = (i: number) => leaders[k].reduce((a, s) => a + (s[i] ?? 0), 0) / leaders[k].length;
  console.log(`${k.padEnd(8)} leader ${avg(0).toFixed(1).padStart(5)}   10th ${avg(9).toFixed(1).padStart(5)}   (NFL: ${real[k]})`);
}
console.log(
  `\nthe better starting corner had more picks in ${((100 * betterCbMorePicks) / cbPairs).toFixed(0)}% of team-seasons, more passes defended in ${((100 * betterCbMorePds) / cbPairs).toFixed(0)}% (${cbPairs} pairs)`,
);
