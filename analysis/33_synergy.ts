/**
 * Position-group synergy — calibration and proof.
 *
 *   npx tsx analysis/33_synergy.ts [--seeds N] [--part league|units|all]
 *
 * Two questions, answered with the synergy layer off (scale 0) and on:
 *
 *  1. **League**: does anything the engine is validated on move? Every
 *     ordered pair of the 32 reference teams, averaged. Synergy is centred on
 *     these rosters, so the means should sit still; the spreads (points sd,
 *     margin sd, favourite win rate) are allowed to widen toward real, since
 *     `team-strength.ts` documents the between-team spread as ~20% light.
 *
 *  2. **Units**: does it do what it is for? A median reference team, with one
 *     unit at a time swapped for elite (or deliberately broken) players, plays
 *     every other team home and away. The unit's own channel is reported —
 *     sack rate for a line, forced sack rate for a pass rush, and so on — so
 *     "five great linemen vs three" is a number, not an impression.
 *
 * Swapped-in players are clones with fresh ids, so the original never plays
 * against himself and an injury to one can't sideline the other.
 */

import type { Player } from "../src/schema/player.js";
import { loadPool, Roster, roster, teamList, type DepthOrder } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { setSynergyScale } from "../src/engine/synergy.js";

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
};
const SEEDS = Number(arg("seeds", "3"));
const PART = arg("part", "all");
/** Only run unit cases whose name contains one of these (comma-separated). */
const ONLY = arg("only", "").split(",").filter(Boolean);
/** Engine talent scale for the league check (the franchise "talent impact" setting). */
const TALENT = Number(arg("talent", "1"));

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Stats = Record<string, number>;
const add = (acc: Stats, s: Stats): void => {
  for (const [k, v] of Object.entries(s)) acc[k] = (acc[k] ?? 0) + v;
};
const rate = (s: Stats, num: string, den: string): number => (s[den] ? (s[num] ?? 0) / s[den]! : 0);

function starterMean(r: Roster): number {
  const o = Object.values(r.offense());
  const d = Object.values(r.defense());
  const all = [...o, ...d].filter((p): p is Player => !!p);
  return all.reduce((n, p) => n + (p.overall ?? 0), 0) / all.length;
}

const sd = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

// ---- part 1: the league --------------------------------------------------------

function league(scale: number): void {
  setSynergyScale(scale);
  const teams = teamList();
  const strength = new Map(teams.map((t) => [t, starterMean(roster(t))]));
  const agg: Stats = {};
  const points: number[] = [];
  const margins: number[] = [];
  let favWins = 0;
  let favGames = 0;
  for (const h of teams) {
    for (const a of teams) {
      if (h === a) continue;
      for (let k = 0; k < SEEDS; k++) {
        const g = simulateGame(hash(`L|${h}|${a}|${k}`), h, a, { injuries: true, talentScale: TALENT });
        add(agg, g.teams[0].s);
        add(agg, g.teams[1].s);
        const [hs, as_] = g.score;
        points.push(hs, as_);
        margins.push(hs - as_);
        const sh = strength.get(h)!;
        const sa = strength.get(a)!;
        if (sh !== sa && hs !== as_) {
          favGames++;
          if ((sh > sa) === (hs > as_)) favWins++;
        }
      }
    }
  }
  const n = points.length;
  console.log(
    [
      `talent ${TALENT} syn ${scale}`.padEnd(18),
      `pts/tg ${(points.reduce((x, y) => x + y, 0) / n).toFixed(2)}`,
      `comp ${(100 * rate(agg, "completion", "pass_att")).toFixed(1)}%`,
      `sack ${(100 * rate(agg, "sack", "dropbacks")).toFixed(2)}%`,
      `ypc ${rate(agg, "rush_yards", "rush_att").toFixed(2)}`,
      `ypa ${rate(agg, "pass_yards", "pass_att").toFixed(2)}`,
      `pts sd ${sd(points).toFixed(2)}`,
      `margin sd ${sd(margins).toFixed(2)}`,
      `fav ${((100 * favWins) / favGames).toFixed(1)}%`,
      `(${n / 2} games)`,
    ].join("  "),
  );
}

// ---- part 2: units ---------------------------------------------------------------

const everyone: Player[] = [...loadPool().values()].flat();
const byPos = (pos: string): Player[] =>
  everyone.filter((p) => p.position === pos).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
const best = (pos: string, n: number): Player[] => byPos(pos).slice(0, n);
const worst = (pos: string, n: number): Player[] => byPos(pos).slice(-n);

let cloneN = 0;
const clone = (p: Player): Player => ({ ...p, id: `${p.id}__syn${cloneN++}` });

/** The median reference team by starter quality — a genuinely ordinary roster. */
function medianTeam(): string {
  const ranked = teamList()
    .map((t) => ({ t, m: starterMean(roster(t)) }))
    .sort((a, b) => a.m - b.m);
  return ranked[Math.floor(ranked.length / 2)]!.t;
}

/**
 * The median team with some positions' starters replaced. `starters[pos]` is
 * the new depth order at that position, starter first; the originals stay on
 * the roster behind them.
 */
function variant(base: string, starters: Record<string, Player[]>): Roster {
  const players = [...loadPool().get(base)!];
  const order: Record<string, string[]> = {};
  for (const [pos, list] of Object.entries(starters)) {
    const clones = list.map(clone);
    players.push(...clones);
    order[pos] = clones.map((p) => p.id);
  }
  return new Roster(base, players, order as DepthOrder);
}

interface UnitResult {
  off: Stats;
  def: Stats;
  pf: number;
  pa: number;
  games: number;
}

function playField(subject: Roster, base: string): UnitResult {
  const off: Stats = {};
  const def: Stats = {};
  let pf = 0;
  let pa = 0;
  let games = 0;
  for (const opp of teamList()) {
    if (opp === base) continue;
    const oppRoster = roster(opp);
    for (let k = 0; k < SEEDS; k++) {
      for (const home of [true, false]) {
        const seed = hash(`U|${opp}|${k}|${home}`);
        const g = home
          ? simulateGame(seed, base, opp, { injuries: true, homeRoster: subject, awayRoster: oppRoster })
          : simulateGame(seed, opp, base, { injuries: true, homeRoster: oppRoster, awayRoster: subject });
        const me: 0 | 1 = home ? 0 : 1;
        const them: 0 | 1 = home ? 1 : 0;
        add(off, g.teams[me].s);
        add(def, g.teams[them].s);
        pf += g.score[me];
        pa += g.score[them];
        games++;
      }
    }
  }
  return { off, def, pf, pa, games };
}

function units(): void {
  const base = medianTeam();
  const r0 = roster(base);
  const o0 = r0.offense();
  const d0 = r0.defense();
  const keep = (...ps: (Player | null | undefined)[]): Player[] => ps.filter((p): p is Player => !!p);

  const [ot1, ot2] = best("OT", 2);
  const [og1, og2] = best("OG", 2);
  const [c1] = best("C", 1);
  const [badOg] = worst("OG", 1);
  const [e1, e2] = best("EDGE", 2);
  const [badEdge] = worst("EDGE", 1);
  const [qbGreat] = best("QB", 1);
  const [qbBad] = worst("QB", 1);
  const [wrGreat] = best("WR", 1);
  const [wrBad] = worst("WR", 1);
  const [rbGreat] = best("RB", 1);
  const [cb1, cb2] = best("CB", 2);
  const [s1, s2] = best("S", 2);
  const [badCb] = worst("CB", 1);
  const lbCov = [...byPos("ILB")].sort(
    (a, b) => (b.attributes?.zone_coverage ?? 0) - (a.attributes?.zone_coverage ?? 0),
  ).slice(0, 2);
  const lbRun = [...byPos("ILB")].sort(
    (a, b) => (b.attributes?.tackle ?? 0) + (b.attributes?.block_shedding ?? 0) - (a.attributes?.tackle ?? 0) - (a.attributes?.block_shedding ?? 0),
  ).slice(0, 2);
  const [dt1, dt2] = best("DT", 2);

  const eliteOL = { OT: [ot1!, ot2!], OG: [og1!, og2!], C: [c1!] };
  const cases: [string, Record<string, Player[]>, "off" | "def"][] = [
    ["baseline (median team)", {}, "off"],
    ["OL: 5 elite", eliteOL, "off"],
    ["OL: 3 elite (LT, C, RT)", { OT: [ot1!, ot2!], C: [c1!] }, "off"],
    ["OL: 4 elite + 1 bad (LG)", { OT: [ot1!, ot2!], OG: [badOg!, og2!], C: [c1!] }, "off"],
    ["RB: elite", { RB: [rbGreat!] }, "off"],
    ["RB elite + OL 5 elite", { ...eliteOL, RB: [rbGreat!] }, "off"],
    ["QB great / WR great", { QB: [qbGreat!], WR: [wrGreat!, ...keep(o0.WR2, o0.WR3)] }, "off"],
    ["QB great / WR bad", { QB: [qbGreat!], WR: [wrBad!, ...keep(o0.WR2, o0.WR3)] }, "off"],
    ["QB bad / WR great", { QB: [qbBad!], WR: [wrGreat!, ...keep(o0.WR2, o0.WR3)] }, "off"],
    ["QB bad / WR bad", { QB: [qbBad!], WR: [wrBad!, ...keep(o0.WR2, o0.WR3)] }, "off"],
    ["EDGE: 1 elite", { EDGE: [e1!, ...keep(d0.EDGE2)] }, "def"],
    ["EDGE: 2 elite", { EDGE: [e1!, e2!] }, "def"],
    ["EDGE: 1 elite + 1 bad", { EDGE: [e1!, badEdge!] }, "def"],
    ["DL: 2 elite EDGE + 2 elite DT", { EDGE: [e1!, e2!], DT: [dt1!, dt2!] }, "def"],
    ["DB: elite CB pair + S pair", { CB: [cb1!, cb2!], S: [s1!, s2!] }, "def"],
    ["DB: elite but one bad CB", { CB: [cb1!, badCb!], S: [s1!, s2!] }, "def"],
    ["DB elite + coverage LBs", { CB: [cb1!, cb2!], S: [s1!, s2!], ILB: lbCov }, "def"],
    ["run D: elite DL + run LBs", { EDGE: [e1!, e2!], DT: [dt1!, dt2!], ILB: lbRun }, "def"],
  ];

  console.log(`\nmedian team: ${base}   seeds ${SEEDS}   (subject plays 31 opponents home and away)\n`);
  const head = "case".padEnd(34) + "syn   sack%  ypc   comp%  ypa   pts/g  | allowed: sack%  ypc   comp%  pts/g";
  console.log(head);
  for (const [name, starters, _side] of cases) {
    if (ONLY.length && name !== "baseline (median team)" && !ONLY.some((o) => name.includes(o))) continue;
    for (const scale of [0, 1]) {
      setSynergyScale(scale);
      const res = playField(variant(base, starters), base);
      const o = res.off;
      const d = res.def;
      console.log(
        [
          (scale === 0 ? name : "").padEnd(34),
          (scale === 0 ? "off" : "ON ").padEnd(5),
          (100 * rate(o, "sack", "dropbacks")).toFixed(2).padStart(5),
          rate(o, "rush_yards", "rush_att").toFixed(2).padStart(5),
          (100 * rate(o, "completion", "pass_att")).toFixed(1).padStart(6),
          rate(o, "pass_yards", "pass_att").toFixed(2).padStart(5),
          (res.pf / res.games).toFixed(1).padStart(6),
          "|",
          (100 * rate(d, "sack", "dropbacks")).toFixed(2).padStart(12),
          rate(d, "rush_yards", "rush_att").toFixed(2).padStart(5),
          (100 * rate(d, "completion", "pass_att")).toFixed(1).padStart(6),
          (res.pa / res.games).toFixed(1).padStart(6),
        ].join(" "),
      );
    }
  }
}


// ---- part 3: the matchup -------------------------------------------------------

/**
 * A 2x2: the median team's offense with its own line or the five worst
 * linemen, against a defence with its own rush or the two best edges. The
 * interaction — (bad, elite) - (bad, normal) - (normal, elite) + (normal,
 * normal) — is what the matchup term adds beyond the two sides summed.
 */
function matchup(): void {
  const base = medianTeam();
  const oppBase = teamList().find((t) => t !== base && t !== teamList()[0])!;
  // The weakest *starting* line any real team fields — not the five worst
  // linemen in a 2,000-player pool, which is a unit nobody would ever play
  // and which the linear model alone already puts past the real extremes.
  const starters = (pos: string, slots: string[]) =>
    teamList()
      .flatMap((tm) => slots.map((sl) => roster(tm).offense()[sl]))
      .filter((p): p is Player => !!p && p.position === pos)
      .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0));
  const worstLine = {
    OT: starters("OT", ["LT", "RT"]).slice(0, 2),
    OG: starters("OG", ["LG", "RG"]).slice(0, 2),
    C: starters("C", ["C"]).slice(0, 1),
  };
  const eliteRush = { EDGE: best("EDGE", 2) };
  const offenses: [string, Record<string, Player[]>][] = [["own line", {}], ["worst line", worstLine]];
  const defenses: [string, Record<string, Player[]>][] = [["own rush", {}], ["elite rush", eliteRush]];
  console.log(`
MATCHUP — ${base} offense vs ${oppBase} defense, ${SEEDS * 40} games a cell`);
  console.log("offense".padEnd(12) + "defense".padEnd(12) + "syn  sack%  comp%  ypa   int%  pts");
  for (const scale of [0, 1]) {
    setSynergyScale(scale);
    for (const [on, os] of offenses) {
      for (const [dn, ds] of defenses) {
        const off = variant(base, os);
        const def = variant(oppBase, ds);
        const st: Stats = {};
        let pts = 0;
        const n = SEEDS * 40;
        for (let k = 0; k < n; k++) {
          const home = k % 2 === 0;
          const seed = hash(`M|${k}`);
          const g = home
            ? simulateGame(seed, base, oppBase, { injuries: true, homeRoster: off, awayRoster: def })
            : simulateGame(seed, oppBase, base, { injuries: true, homeRoster: def, awayRoster: off });
          const me: 0 | 1 = home ? 0 : 1;
          add(st, g.teams[me].s);
          pts += g.score[me];
        }
        console.log(
          [
            on.padEnd(12) + dn.padEnd(12) + (scale ? "ON " : "off"),
            (100 * rate(st, "sack", "dropbacks")).toFixed(2).padStart(5),
            (100 * rate(st, "completion", "pass_att")).toFixed(1).padStart(6),
            rate(st, "pass_yards", "pass_att").toFixed(2).padStart(5),
            (100 * rate(st, "int_thrown", "pass_att")).toFixed(2).padStart(5),
            (pts / n).toFixed(1).padStart(5),
          ].join(" "),
        );
      }
    }
  }
}

const t0 = Date.now();
if (PART === "league" || PART === "all") {
  console.log(`\nLEAGUE — every ordered pair of reference teams × ${SEEDS} seeds`);
  if (TALENT === 1) league(0);
  league(1);
}
if (PART === "units" || PART === "all") units();
if (PART === "matchup" || PART === "all") matchup();
console.error(`\n${Math.round((Date.now() - t0) / 1000)}s`);
