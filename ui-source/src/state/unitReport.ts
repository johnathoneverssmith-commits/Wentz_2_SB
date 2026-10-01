import type { LeagueState, Player, Position } from "@/domain";

import { REPLACEMENT_RATING, strengthOf, unitGainer, UNITS } from "./unitValue";

/**
 * The team as the engine reads it: by unit, not by player.
 *
 * The engine's synergy layer pays for complete units — a line with no hole
 * in it, a pair of edge rushers, a quarterback with a receiver worth
 * throwing to — and charges for the weak link the opponent will find. The
 * Master AI builds around exactly that (`unitValue.ts`); this is the same
 * reading, for the human: each unit's strength, where it ranks in the
 * league, and the starter holding it back.
 */

export interface UnitStarter {
  id: string | null;
  name: string;
  position: string;
  overall: number;
}

export interface UnitRow {
  key: string;
  label: string;
  /** the unit's strength: its starters' average, pulled toward the weakest */
  strength: number;
  /** 1 = best in the league */
  rank: number;
  teams: number;
  grade: string;
  /** how much the engine pays for a point here, relative to the other units */
  weight: number;
  starters: UnitStarter[];
  /** the starter the unit is pulled toward — only named when he costs it something */
  weakLink: UnitStarter | null;
  /**
   * Weighted points the unit would gain if its weakest starter were an 80:
   * what an upgrade here is worth, comparable across units.
   */
  upgradeValue: number;
  /** where that upgrade would rank the unit */
  upgradeRank: number;
}

export interface UnitReport {
  units: UnitRow[];
  pairing: { qb: UnitStarter | null; wr: UnitStarter | null; value: number; rank: number; grade: string };
  /** the units where an upgrade pays most, best first */
  priorities: UnitRow[];
}

export const UNIT_LABEL: Readonly<Record<string, string>> = {
  quarterback: "Quarterback",
  runningBack: "Running back",
  receivers: "Receivers",
  tightEnd: "Tight end",
  offensiveLine: "Offensive line",
  passRush: "Edge rush",
  interior: "Interior line",
  linebackers: "Linebackers",
  outsideLinebackers: "Outside linebackers",
  corners: "Cornerbacks",
  safeties: "Safeties",
};

/** Grade by league rank: the top eighth is an A, the bottom eighth an F. */
export function gradeFor(rank: number, teams: number): string {
  const q = (rank - 1) / Math.max(1, teams - 1);
  if (q < 0.125) return "A";
  if (q < 0.3) return "B+";
  if (q < 0.45) return "B";
  if (q < 0.6) return "C+";
  if (q < 0.75) return "C";
  if (q < 0.875) return "D";
  return "F";
}

type Lines = Map<string, Map<string, Player[]>>;

/** Every team's depth order at every unit position, in one pass over the players. */
function depthLines(s: LeagueState): Lines {
  const out: Lines = new Map();
  for (const code of Object.keys(s.teams)) out.set(code, new Map());
  for (const p of Object.values(s.players)) {
    if (p.retired || !p.nfl_team) continue;
    const team = out.get(p.nfl_team);
    if (!team) continue;
    const list = team.get(p.position) ?? [];
    list.push(p);
    team.set(p.position, list);
  }
  for (const [code, team] of out) {
    for (const [pos, list] of team) {
      const order = s.depthChart?.[code]?.[pos as Position];
      const rank = new Map((order ?? []).map((id, i) => [id, i]));
      list.sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          b.overall - a.overall,
      );
    }
  }
  return out;
}

const vacancy = (position: string): UnitStarter => ({
  id: null,
  name: "Vacant",
  position,
  overall: REPLACEMENT_RATING,
});

const asStarter = (p: Player): UnitStarter => ({ id: p.id, name: p.name, position: p.position, overall: p.overall });

function startersFor(lines: Map<string, Player[]> | undefined, key: string): UnitStarter[] {
  const out: UnitStarter[] = [];
  for (const [pos, n] of Object.entries(UNITS[key]!.slots)) {
    const at = lines?.get(pos) ?? [];
    for (let i = 0; i < n; i++) out.push(at[i] ? asStarter(at[i]!) : vacancy(pos));
  }
  return out;
}

const UPGRADE_TO = 80;

export function unitReport(s: LeagueState, teamCode: string): UnitReport {
  const lines = depthLines(s);
  const codes = [...lines.keys()];
  const units: UnitRow[] = [];
  for (const key of Object.keys(UNITS)) {
    const unit = UNITS[key]!;
    const strengths = codes.map((c) => strengthOf(unit, startersFor(lines.get(c), key).map((x) => x.overall)));
    const starters = startersFor(lines.get(teamCode), key);
    const ratings = starters.map((x) => x.overall);
    const strength = strengthOf(unit, ratings);
    const rank = 1 + strengths.filter((v) => v > strength + 1e-9).length;
    const low = Math.min(...ratings);
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const weakest = starters[ratings.indexOf(low)]!;
    const upgraded = ratings.map((r, i) => (i === ratings.indexOf(low) ? Math.max(r, UPGRADE_TO) : r));
    units.push({
      key,
      label: UNIT_LABEL[key] ?? key,
      strength: Math.round(strength * 10) / 10,
      rank,
      teams: codes.length,
      grade: gradeFor(rank, codes.length),
      weight: unit.weight,
      starters,
      weakLink: starters.length > 1 && unit.weakLink > 0 && mean - low >= 4 ? weakest : null,
      upgradeValue: (strengthOf(unit, upgraded) - strength) * unit.weight,
      upgradeRank: 1 + strengths.filter((v) => v > strengthOf(unit, upgraded) + 1e-9).length,
    });
  }

  const best = (lines_: Map<string, Player[]> | undefined, pos: string): UnitStarter | null => {
    const at = lines_?.get(pos) ?? [];
    const top = [...at].sort((a, b) => b.overall - a.overall)[0];
    return top ? asStarter(top) : null;
  };
  const pairValue = (c: string): number =>
    Math.min(best(lines.get(c), "QB")?.overall ?? REPLACEMENT_RATING, best(lines.get(c), "WR")?.overall ?? REPLACEMENT_RATING);
  const mine = pairValue(teamCode);
  const pairRank = 1 + codes.filter((c) => pairValue(c) > mine).length;

  const counted = units.filter((u) => u.weight >= 0.05);
  return {
    units,
    pairing: {
      qb: best(lines.get(teamCode), "QB"),
      wr: best(lines.get(teamCode), "WR"),
      value: mine,
      rank: pairRank,
      grade: gradeFor(pairRank, codes.length),
    },
    priorities: [...counted].filter((u) => u.upgradeValue > 0.05).sort((a, b) => b.upgradeValue - a.upgradeValue),
  };
}

// ---- fit: what a candidate would add to this team's units ------------------

export interface Fit {
  /** weighted unit points — comparable across positions */
  gain: number;
  label: "Major upgrade" | "Upgrade" | "Minor upgrade" | "Depth" | "Fills an empty spot";
  tone: "good" | "neutral" | "faint";
}

export function fitLabel(gain: number): Fit {
  if (gain >= 1.5) return { gain, label: "Major upgrade", tone: "good" };
  if (gain >= 0.5) return { gain, label: "Upgrade", tone: "good" };
  if (gain > 0.05) return { gain, label: "Minor upgrade", tone: "neutral" };
  return { gain, label: "Depth", tone: "faint" };
}

/**
 * How much a candidate at `position` rated `overall` would strengthen this
 * team's units — the same reading the Master AI drafts and signs by, so a
 * human can see what it sees. Largest for a player who fills a hole in a
 * unit that is otherwise good, zero for one who would not start.
 */
export function fitFor(
  s: Pick<LeagueState, "players">,
  teamCode: string,
): (position: string, overall: number) => Fit {
  const byPos = new Map<string, number[]>();
  for (const p of Object.values(s.players)) {
    if (p.retired || p.nfl_team !== teamCode || p.free_agent) continue;
    const list = byPos.get(p.position) ?? [];
    list.push(p.overall);
    byPos.set(p.position, list);
  }
  const gain = unitGainer((pos) => byPos.get(pos) ?? []);
  return (position, overall) => {
    const f = fitLabel(gain(position, overall));
    // at the top of a fantasy draft every name read "Major upgrade" — over
    // nobody. Say so; "upgrade" then means improving on someone you have.
    if (f.gain > 0.05 && !(byPos.get(position)?.length)) return { ...f, label: "Fills an empty spot" };
    return f;
  };
}

// ---- offense and defense, the way the engine weighs them ---------------------

const OFFENSE_UNITS = ["quarterback", "runningBack", "receivers", "tightEnd", "offensiveLine"];
const DEFENSE_UNITS = ["passRush", "interior", "linebackers", "corners", "safeties"];

export interface SideRatings {
  offense: number;
  defense: number;
  offenseRank: number;
  defenseRank: number;
}

/**
 * Every team's offense and defense as a weighted mean of its unit strengths
 * — each unit weighted by what it is measured to be worth, each strength
 * pulled toward its weakest starter. The hub used to show a flat average of
 * the starters, so it could call an offense twentieth while Unit grades had
 * its quarterback first and its line thirtieth: two screens, two answers.
 */
export function sideRatings(s: Pick<LeagueState, "players" | "teams" | "depthChart">): Record<string, SideRatings> {
  const lines = depthLines(s as LeagueState);
  const codes = [...lines.keys()];
  const side = (code: string, keys: string[]): number => {
    let num = 0;
    let den = 0;
    for (const key of keys) {
      const unit = UNITS[key]!;
      num += strengthOf(unit, startersFor(lines.get(code), key).map((x) => x.overall)) * unit.weight;
      den += unit.weight;
    }
    return num / den;
  };
  const off = new Map(codes.map((c) => [c, side(c, OFFENSE_UNITS)]));
  const def = new Map(codes.map((c) => [c, side(c, DEFENSE_UNITS)]));
  const rank = (m: Map<string, number>, c: string) => 1 + codes.filter((x) => m.get(x)! > m.get(c)! + 1e-9).length;
  return Object.fromEntries(
    codes.map((c) => [
      c,
      {
        offense: Math.round(off.get(c)!),
        defense: Math.round(def.get(c)!),
        offenseRank: rank(off, c),
        defenseRank: rank(def, c),
      },
    ]),
  );
}

// ---- what a trade does to your units -----------------------------------------

export interface UnitDelta {
  key: string;
  label: string;
  before: number;
  after: number;
  rankBefore: number;
  rankAfter: number;
}

/**
 * The units a trade would change for `team`, before and after.
 *
 * A trade is judged in the game the way it is played — by what it does to
 * the starting units — but the trade screen only ever showed the value
 * ledger. This plays the trade on a copy of the rosters (players out, players
 * in) and reports each unit whose strength moves.
 */
export function tradeUnitImpact(
  s: Pick<LeagueState, "players" | "teams" | "depthChart">,
  team: string,
  outgoing: readonly string[],
  incoming: readonly string[],
): UnitDelta[] {
  if (outgoing.length === 0 && incoming.length === 0) return [];
  const before = unitReport(s as LeagueState, team);
  const players = { ...s.players };
  for (const id of outgoing) if (players[id]) players[id] = { ...players[id]!, nfl_team: "__traded__" };
  for (const id of incoming) if (players[id]) players[id] = { ...players[id]!, nfl_team: team };
  const after = unitReport({ ...s, players } as LeagueState, team);
  const out: UnitDelta[] = [];
  for (const u of before.units) {
    const a = after.units.find((x) => x.key === u.key)!;
    if (Math.abs(a.strength - u.strength) < 0.05 || u.weight < 0.05) continue;
    out.push({ key: u.key, label: u.label, before: u.strength, after: a.strength, rankBefore: u.rank, rankAfter: a.rank });
  }
  return out;
}
