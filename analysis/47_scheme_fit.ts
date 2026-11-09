/**
 * Phase 0 scheme fit — before/after on the real engine.
 *
 *   npx tsx analysis/47_scheme_fit.ts [--seeds N] [--talent 1,1.5] [--part shifts|games|all]
 *
 * `shifts` is exact: the fit term (completion logit / yards-per-carry) every
 * scheme gets on every reference team, legacy vs derived, tagged vs stripped.
 * `games` plays team A (scheme under test) against a league-average-staffed
 * copy of the 32 reference teams and reports A's mean margin per scheme.
 * Margin noise is ~14/sqrt(games) (see the printed standard error).
 */
import type { Player } from "../src/schema/player.js";
import { Roster, roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { DEF_SCHEME_TAGS, OFF_SCHEME_TAGS, leagueAverageStaff, type Staff } from "../src/engine/staff.js";
import { defSchemeFitShift, defSchemeFitShiftDerived, offSchemeFitShift, offSchemeFitShiftDerived } from "../src/engine/staff-fit.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const SEEDS = Number(arg("seeds", "20"));
const TALENTS = arg("talent", "1,1.5").split(",").map(Number);
const PART = arg("part", "all");
const SIDES = arg("side", "off,def").split(",") as ("off" | "def")[];

const OFF = Object.keys(OFF_SCHEME_TAGS) as (keyof typeof OFF_SCHEME_TAGS)[];
const DEF = Object.keys(DEF_SCHEME_TAGS) as (keyof typeof DEF_SCHEME_TAGS)[];
const OFF_SLOTS = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT"];
const DEF_SLOTS = ["EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2"];

type Tagging = "tagged" | "stripped" | "compatible" | "incompatible";
const strip = (r: Roster, f: (p: Player) => string[]): Roster => {
  const all: Player[] = [];
  const order: Record<string, string[]> = {};
  for (const [pos, list] of r.depth) {
    for (const p of list) all.push({ ...p, scheme_tags: f(p) });
    order[pos] = list.map((p) => p.id);
  }
  return new Roster(r.team, all, order);
};
function rosterFor(team: string, t: Tagging, scheme: string | null, side: "off" | "def"): Roster {
  const r = roster(team);
  if (t === "tagged") return r;
  if (t === "stripped" || !scheme) return strip(r, () => []);
  const want = (side === "off" ? OFF_SCHEME_TAGS : DEF_SCHEME_TAGS) as Record<string, readonly string[]>;
  return strip(r, (p) => (t === "compatible" ? [want[scheme]![0]!] : ["__none__"]));
}

const staff = (side: "off" | "def", scheme: string | null, derived: boolean): Staff => {
  const s = leagueAverageStaff();
  if (derived) s.schemeFit = "derived";
  if (scheme && side === "off") s.oc = { ...s.oc, scheme: scheme as never };
  if (scheme && side === "def") s.dc = { ...s.dc, scheme: scheme as never };
  return s;
};

const teams = teamList();
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

if (PART === "shifts" || PART === "all") {
  console.log("\n== exact fit shift, mean over 32 teams: rush (yd/carry) | complete (logit) ==");
  for (const t of ["tagged", "stripped"] as const) {
    for (const derived of [false, true]) {
      const row: string[] = [];
      for (const sc of OFF) {
        const sh = teams.map((tm) => {
          const o = rosterFor(tm, t, null, "off").offense() as Record<string, Player | null>;
          return derived
            ? offSchemeFitShiftDerived(sc, OFF_SLOTS.map((s) => o[s]))
            : offSchemeFitShift(sc, OFF_SLOTS.map((s) => o[s]?.scheme_tags));
        });
        row.push(`${sc}:${mean(sh.map((x) => x.rush)).toFixed(3)}|${mean(sh.map((x) => x.complete)).toFixed(4)}`);
      }
      for (const sc of DEF) {
        const sh = teams.map((tm) => {
          const d = rosterFor(tm, t, null, "def").defense() as Record<string, Player | null>;
          return derived
            ? defSchemeFitShiftDerived(sc, DEF_SLOTS.map((s) => d[s]))
            : defSchemeFitShift(sc, DEF_SLOTS.map((s) => d[s]?.scheme_tags));
        });
        row.push(`${sc}:${mean(sh.map((x) => x.rush)).toFixed(3)}|${mean(sh.map((x) => x.complete)).toFixed(4)}`);
      }
      console.log(`${t.padEnd(8)} ${derived ? "derived" : "legacy "}  ${row.join("  ")}`);
    }
  }
}

if (PART === "games" || PART === "all") {
  for (const talent of TALENTS) {
    console.log(`\n== mean margin of team A, talent ${talent}, ${teams.length * SEEDS} games per cell ==`);
    const run = (tagging: Tagging, side: "off" | "def", scheme: string | null, derived: boolean): [number, number] => {
      const m: number[] = [];
      teams.forEach((tm, ti) => {
        const opp = teams[(ti + 7) % teams.length]!;
        const a = rosterFor(tm, tagging, scheme, side);
        const b = roster(opp);
        const sa = staff(side, scheme, derived);
        const sb = leagueAverageStaff();
        for (let k = 0; k < SEEDS; k++) {
          const seed = 9000 + ti * 1000 + k;
          const home = k % 2 === 0;
          const g = simulateGame(seed, home ? tm : opp, home ? opp : tm, {
            homeRoster: home ? a : b,
            awayRoster: home ? b : a,
            homeStaff: home ? sa : sb,
            awayStaff: home ? sb : sa,
            talentScale: talent,
          });
          const [hs, as] = (g as unknown as { score: [number, number] }).score;
          m.push(home ? hs - as : as - hs);
        }
      });
      const mu = mean(m);
      const se = Math.sqrt(mean(m.map((x) => (x - mu) ** 2)) / m.length);
      return [mu, se];
    };
    const f = ([m, se]: [number, number]) => `${m >= 0 ? "+" : ""}${m.toFixed(2)}±${se.toFixed(2)}`;
    for (const side of SIDES) {
      const schemes = side === "off" ? OFF : DEF;
      const neutral = side === "off" ? "pro_style" : "multiple";
      console.log(`-- ${side === "off" ? "OFFENSE (OC scheme)" : "DEFENSE (DC scheme)"} -- scheme | stripped legacy | stripped derived | compatible(derived) | incompatible(derived)`);
      for (const sc of schemes) {
        console.log(
          `${sc.padEnd(11)} ${f(run("stripped", side, sc, false))}  ${f(run("stripped", side, sc, true))}  ${f(run("compatible", side, sc, true))}  ${f(run("incompatible", side, sc, true))}${sc === neutral ? "   (neutral)" : ""}`,
        );
      }
    }
  }
}
