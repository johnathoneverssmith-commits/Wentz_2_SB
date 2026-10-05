import type { GameResult, TeamGameTotals } from "@/domain";

/**
 * What each team has done this season, stat by stat, and where that ranks.
 *
 * This is the detail behind the matchup screen's three unit ranks. Each
 * unit is a handful of figures from the played regular-season games'
 * box-score totals:
 *
 *  - offense: points, rushing and passing yards, completion %, how open the
 *    receivers got (a modelled estimate), pressure allowed, time of possession
 *  - defense: points, passing and rushing yards allowed, interceptions, fumble
 *    recoveries
 *  - special teams: kicking points, kick and punt return touchdowns, where each
 *    side's drives start, and where its opponents' do
 *
 * A game from a save that predates a figure is simply left out of that
 * figure, so an older league shows what it has rather than a wrong number.
 * Callers pass the games the GM has seen (`visibleGames` online): this never
 * reads `state.games` itself.
 */
export type StatKey =
  | "points"
  | "rushYds"
  | "passYds"
  | "compPct"
  | "separation"
  | "pressure"
  | "possession"
  | "pointsAllowed"
  | "passYdsAllowed"
  | "rushYdsAllowed"
  | "interceptions"
  | "recoveries"
  | "kickPoints"
  | "krTd"
  | "prTd"
  | "startOwn"
  | "startOpp";

export interface StatLine {
  value: number | null;
  /** 1 = best; null with no value */
  rank: number | null;
}

export type TeamProduction = Record<StatKey, StatLine>;

/** Which way is better, per stat. */
export const BETTER: Record<StatKey, "high" | "low"> = {
  points: "high",
  rushYds: "high",
  passYds: "high",
  compPct: "high",
  separation: "high",
  pressure: "low",
  possession: "high",
  pointsAllowed: "low",
  passYdsAllowed: "low",
  rushYdsAllowed: "low",
  interceptions: "high",
  recoveries: "high",
  kickPoints: "high",
  krTd: "high",
  prTd: "high",
  startOwn: "high",
  startOpp: "low",
};

interface Acc {
  games: number;
  // sums over the games that carry each figure, with their own counts
  sum: Partial<Record<StatKey, number>>;
  n: Partial<Record<StatKey, number>>;
  /** ratio stats keep numerator and denominator */
  num: Partial<Record<StatKey, number>>;
  den: Partial<Record<StatKey, number>>;
}

const blank = (): Acc => ({ games: 0, sum: {}, n: {}, num: {}, den: {} });

function perGame(a: Acc, k: StatKey, v: number | undefined): void {
  if (v === undefined || !Number.isFinite(v)) return;
  a.sum[k] = (a.sum[k] ?? 0) + v;
  a.n[k] = (a.n[k] ?? 0) + 1;
}
function total(a: Acc, k: StatKey, v: number | undefined): void {
  perGame(a, k, v); // summed the same; reported as a total, not divided
}
function ratio(a: Acc, k: StatKey, num: number | undefined, den: number | undefined): void {
  if (num === undefined || den === undefined || den <= 0) return;
  a.num[k] = (a.num[k] ?? 0) + num;
  a.den[k] = (a.den[k] ?? 0) + den;
}

const TOTALS = new Set<StatKey>(["interceptions", "recoveries", "krTd", "prTd"]);

export function teamProduction(
  games: readonly GameResult[],
  teamCodes: readonly string[],
): Map<string, TeamProduction> | null {
  const played = games.filter((g) => g.phase === "REG" && g.played && g.totals);
  if (played.length === 0) return null;

  const acc = new Map<string, Acc>(teamCodes.map((c) => [c, blank()]));
  for (const g of played) {
    const sides: [string, TeamGameTotals, TeamGameTotals][] = [
      [g.homeTeam, g.totals!.home, g.totals!.away],
      [g.awayTeam, g.totals!.away, g.totals!.home],
    ];
    for (const [code, me, opp] of sides) {
      const a = acc.get(code);
      if (!a) continue;
      a.games++;
      perGame(a, "points", me.points);
      perGame(a, "rushYds", me.rushYards);
      perGame(a, "passYds", me.passYards);
      ratio(a, "compPct", me.passComp, me.passAtt);
      ratio(a, "separation", me.sepSum, me.sepN);
      // pressure: sacks and hits over every dropback
      if (me.sacksAllowed !== undefined && me.qbHits !== undefined && me.passAtt !== undefined) {
        ratio(a, "pressure", me.sacksAllowed + me.qbHits, me.passAtt + me.sacksAllowed);
      }
      perGame(a, "possession", me.topSeconds);
      perGame(a, "pointsAllowed", opp.points);
      perGame(a, "passYdsAllowed", opp.passYards);
      perGame(a, "rushYdsAllowed", opp.rushYards);
      total(a, "interceptions", opp.intThrown);
      total(a, "recoveries", opp.fumblesLost);
      perGame(a, "kickPoints", me.kickPoints);
      total(a, "krTd", me.krTd);
      total(a, "prTd", me.prTd);
      ratio(a, "startOwn", me.startSum, me.startN);
      ratio(a, "startOpp", opp.startSum, opp.startN);
    }
  }

  const value = (a: Acc, k: StatKey): number | null => {
    if (a.den[k] !== undefined) {
      const d = a.den[k]!;
      if (d <= 0) return null;
      const r = a.num[k]! / d;
      return k === "compPct" || k === "pressure" ? r * 100 : r;
    }
    const n = a.n[k];
    if (!n) return null;
    return TOTALS.has(k) ? a.sum[k]! : a.sum[k]! / n;
  };

  const keys = Object.keys(BETTER) as StatKey[];
  const out = new Map<string, TeamProduction>();
  for (const code of teamCodes) out.set(code, {} as TeamProduction);
  for (const k of keys) {
    const vals = teamCodes.map((c) => [c, value(acc.get(c)!, k)] as const);
    for (const [c, v] of vals) {
      let rank: number | null = null;
      if (v !== null) {
        let better = 0;
        for (const [o, w] of vals) {
          if (o === c || w === null) continue;
          // rounded to the precision it is shown at, so a tie isn't broken by noise
          if (BETTER[k] === "high" ? Math.round(w * 10) > Math.round(v * 10) : Math.round(w * 10) < Math.round(v * 10)) better++;
        }
        rank = better + 1;
      }
      out.get(c)![k] = { value: v, rank };
    }
  }
  return out;
}
