/**
 * NFL 17-game schedule formula (current since 2021).
 *
 * Each team plays:
 *   - 6 intra-division  (home & away vs each of 3 rivals)
 *   - 4 vs one other division in its own conference   (2 home, 2 away)
 *   - 4 vs one division in the other conference        (2 home, 2 away)
 *   - 2 vs the same-place finishers in its conference's two remaining divisions
 *   - 1 "17th game" vs a same-place finisher in the other conference
 *
 * The division pairings rotate on fixed cycles keyed off `year`, anchored to the
 * real NFL rotation as published for 2023–2026 (intra-conference is a 3-year
 * cycle, the two inter-conference pairings are 4-year cycles), so `year: 2026`
 * reproduces the actual 2026 slate and later years roll the cycles forward. The
 * "same-place" games need each team's prior-year finish rank within its division
 * (1..4); with no history `priorRank` defaults to roster order.
 */

import {
  type Conference,
  type DivisionId,
  DIVISION_IDS,
  DIVISIONS,
  conferenceOf,
  divisionOf,
  divisionsIn,
} from "./nfl-structure.js";

/** Byes fall in this inclusive week range (real NFL: weeks 5–14). */
export const BYE_WEEK_RANGE = [5, 14] as const;
/** Trades are allowed through this week; the deadline is the day after. */
export const TRADE_DEADLINE_WEEK = 9;

// Real NFL rotation cycles. Divisions are indexed 0=East, 1=North, 2=South,
// 3=West within each conference (the order `divisionsIn` returns).

// Intra-conference 4-game block — 3-year cycle, same pairing in both
// conferences. m[year % 3] gives the two division-index pairs.
//   2025 (→0): E–N, S–W    2023/2026 (→1): E–W, N–S    2024 (→2): E–S, N–W
const INTRA_CONF_CYCLE: readonly (readonly [number, number][])[] = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [0, 3],
    [1, 2],
  ],
  [
    [0, 2],
    [1, 3],
  ],
];

// Inter-conference 4-game block — 4-year cycle. AFC division i plays NFC
// division INTER_CONF_CYCLE[year % 4][i].
//   2024 (→0): [3,0,1,2]  2025 (→1): [2,1,3,0]  2026 (→2): [1,2,0,3]  2023 (→3): [0,3,2,1]
const INTER_CONF_CYCLE: readonly (readonly number[])[] = [
  [3, 0, 1, 2],
  [2, 1, 3, 0],
  [1, 2, 0, 3],
  [0, 3, 2, 1],
];

// 17th game — 4-year cycle, AFC division i plays NFC division
// SEVENTEENTH_CYCLE[year % 4][i]. Distinct from the inter-conference block above
// for every division and year. AFC hosts in odd years.
//   2024 (→0): [1,2,0,3]  2025 (→1): [0,3,2,1]  2026 (→2): [3,0,1,2]  2023 (→3): [2,1,3,0]
const SEVENTEENTH_CYCLE: readonly (readonly number[])[] = [
  [1, 2, 0, 3],
  [0, 3, 2, 1],
  [3, 0, 1, 2],
  [2, 1, 3, 0],
];

export interface SchedulePair {
  week: number;
  home: string;
  away: string;
}

export interface ScheduleOptions {
  /** Season year — drives the division-pairing rotations. Default 2026. */
  year?: number;
  /** team → prior-year finish rank in its division, 1 (best) … 4. */
  priorRank?: Map<string, number>;
}

type Directed = { home: string; away: string };

/** div team lists indexed 0..3 by prior-year rank (rank 1 → index 0). */
function rankedDivisions(priorRank: Map<string, number>): Record<DivisionId, string[]> {
  const out = {} as Record<DivisionId, string[]>;
  for (const id of DIVISION_IDS) {
    out[id] = [...DIVISIONS[id]].sort(
      (a, b) => (priorRank.get(a) ?? 4) - (priorRank.get(b) ?? 4) || a.localeCompare(b),
    );
  }
  return out;
}

/** Intra-conference 4-game partner for each division (real 3-year rotation). */
function intraConfPairs(year: number): Map<DivisionId, DivisionId> {
  const m = new Map<DivisionId, DivisionId>();
  const pairings = INTRA_CONF_CYCLE[((year % 3) + 3) % 3]!;
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const ds = divisionsIn(conf);
    for (const [i, j] of pairings) {
      m.set(ds[i]!, ds[j]!);
      m.set(ds[j]!, ds[i]!);
    }
  }
  return m;
}

/** Inter-conference 4-game partner for each division (real 4-year rotation). */
function interConfPairs(year: number): Map<DivisionId, DivisionId> {
  const m = new Map<DivisionId, DivisionId>();
  const afc = divisionsIn("AFC");
  const nfc = divisionsIn("NFC");
  const cycle = INTER_CONF_CYCLE[((year % 4) + 4) % 4]!;
  for (let i = 0; i < 4; i++) {
    const j = cycle[i]!;
    m.set(afc[i]!, nfc[j]!);
    m.set(nfc[j]!, afc[i]!);
  }
  return m;
}

/**
 * 4-game block between two divisions. `xTeams`/`yTeams` are rank-ordered.
 * X team at rank-index i hosts Y {i, i+1}, visits Y {i+2, i+3} (mod 4) — this
 * gives every team 2 home + 2 away and every matchup appears once.
 */
function divVsDiv(xTeams: string[], yTeams: string[]): Directed[] {
  const out: Directed[] = [];
  for (let i = 0; i < 4; i++) {
    out.push({ home: xTeams[i]!, away: yTeams[i]! });
    out.push({ home: xTeams[i]!, away: yTeams[(i + 1) % 4]! });
    out.push({ home: yTeams[(i + 2) % 4]!, away: xTeams[i]! });
    out.push({ home: yTeams[(i + 3) % 4]!, away: xTeams[i]! });
  }
  return out;
}

function makeMatchups(year: number, priorRank: Map<string, number>): Directed[] {
  const ranked = rankedDivisions(priorRank);
  const intra = intraConfPairs(year);
  const inter = interConfPairs(year);
  const seen = new Set<string>(); // exact directed matchup "away@home", once
  const out: Directed[] = [];
  const add = (home: string, away: string) => {
    const k = `${away}@${home}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ home, away });
  };

  // 1. intra-division: home & away vs each rival
  for (const id of DIVISION_IDS) {
    const ts = DIVISIONS[id];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) if (i !== j) add(ts[i]!, ts[j]!);
  }

  // 2 + 3. division-vs-division 4-game blocks (each unordered pair once)
  const blockDone = new Set<string>();
  for (const id of DIVISION_IDS) {
    for (const partnerMap of [intra, inter]) {
      const p = partnerMap.get(id)!;
      const key = [id, p].sort().join("|");
      if (blockDone.has(key)) continue;
      blockDone.add(key);
      for (const d of divVsDiv(ranked[id], ranked[p])) add(d.home, d.away);
    }
  }

  // 4. same-place finishers. The conference's 4 divisions split into two
  //    intra-conf partner pairs {d0,p0} and {d1,p1}; same-place games are the
  //    cross product between the pairs (4 division-pairs × 4 ranks = 16/conf).
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const ds = divisionsIn(conf);
    const d0 = ds[0]!;
    const p0 = intra.get(d0)!;
    const [d1, p1] = ds.filter((d) => d !== d0 && d !== p0) as [DivisionId, DivisionId];
    const cross: [DivisionId, DivisionId][] = [
      [d0, d1],
      [d0, p1],
      [p0, d1],
      [p0, p1],
    ];
    // Each team sits in exactly two of these four pairs. `xHome` is chosen so a
    // team's two same-place games split 1 home / 1 away (the naive `(k+r)%2`
    // gives the two "y-slot" divisions both-home or both-away — see the parity
    // table in the commit msg): x hosts when k∈{0,3}⊕(r odd).
    cross.forEach(([x, y], k) => {
      for (let r = 0; r < 4; r++) {
        const xHome = (k === 0 || k === 3) === (r % 2 === 0);
        const [home, away] = xHome ? [ranked[x][r]!, ranked[y][r]!] : [ranked[y][r]!, ranked[x][r]!];
        add(home, away);
      }
    });
  }

  // 5. 17th game: same-place finisher in the other conference, on the real
  //    4-year cycle. AFC hosts in odd years.
  const afc = divisionsIn("AFC");
  const nfc = divisionsIn("NFC");
  const cycle17 = SEVENTEENTH_CYCLE[((year % 4) + 4) % 4]!;
  const afcHosts17 = ((year % 2) + 2) % 2 === 1;
  for (let i = 0; i < 4; i++) {
    const nfcDiv = nfc[cycle17[i]!]!;
    for (let r = 0; r < 4; r++) {
      const a = ranked[afc[i]!][r]!;
      const n = ranked[nfcDiv][r]!;
      if (afcHosts17) add(a, n);
      else add(n, a);
    }
  }

  return out;
}

/** mulberry32, seeded off a string. */
function mulberry32(seedStr: string): () => number {
  let seed = 0x9e3779b9;
  for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(seed, 31) + seedStr.charCodeAt(i)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lay the 272 matchups across 18 weeks: each team plays 17 games with exactly
 * one bye, ≤ 1 game/team/week, ≤ 16 games/week, and **the bye falls in weeks
 * 5–14** (`BYE_WEEK_RANGE`) — so weeks 1–4 and 15–18 are full 16-game slates
 * and every team plays all of them.
 *
 * Backtracking edge-colouring: most-constrained game first; mandatory (non-bye)
 * weeks filled ahead of the bye window; per-team forward checks so a team can't
 * run out of games for its mandatory weeks or overfill the window; randomised
 * restarts. Deterministic per season (RNG seeded off the year + team list).
 */
function assignWeeks(matchups: Directed[], year: number): SchedulePair[] {
  const WEEKS = 18;
  const CAP = 16;
  const GAMES = 17;
  const [BW_LO, BW_HI] = BYE_WEEK_RANGE;
  const inWindow = (w: number) => w >= BW_LO && w <= BW_HI;
  const MAND_WEEKS = WEEKS - (BW_HI - BW_LO + 1); // 8
  const WINDOW_PLAY = BW_HI - BW_LO + 1 - 1; // weeks played in the window: 9
  const WINDOW_TARGET = (2 * GAMES - MAND_WEEKS * CAP) / (BW_HI - BW_LO + 1); // ≈14.4 games/window-week

  const N = matchups.length;
  const teams = [...new Set(matchups.flatMap((m) => [m.home, m.away]))].sort();
  const rand = mulberry32(`${year}:${teams.join("")}`);

  const wk = new Array<number>(N).fill(0);
  const busy = new Map<string, Set<number>>(teams.map((t) => [t, new Set<number>()]));
  const cnt = new Array<number>(WEEKS + 1).fill(0);
  const done = new Array<boolean>(N).fill(false);
  const gp = new Map<string, number>(teams.map((t) => [t, 0])); // games placed
  const winPlayed = new Map<string, number>(teams.map((t) => [t, 0])); // window weeks used
  const B = (t: string) => busy.get(t)!;

  // Can team `t` still reach 8 mandatory weeks + 9 window weeks with the games
  // it has left?  (mandatory-weeks-left is inferred: gamesLeft − windowLeft.)
  const teamOk = (t: string): boolean => {
    const gamesLeft = GAMES - gp.get(t)!;
    const mandLeft = MAND_WEEKS - (gp.get(t)! - winPlayed.get(t)!);
    if (gamesLeft < mandLeft) return false;
    if (winPlayed.get(t)! + (gamesLeft - mandLeft) > WINDOW_PLAY) return false;
    return true;
  };

  const legalWeeks = (gi: number): number[] => {
    const g = matchups[gi]!;
    const out: number[] = [];
    for (let w = 1; w <= WEEKS; w++)
      if (cnt[w]! < CAP && !B(g.home).has(w) && !B(g.away).has(w)) out.push(w);
    return out;
  };

  const apply = (gi: number, w: number) => {
    const g = matchups[gi]!;
    wk[gi] = w;
    B(g.home).add(w);
    B(g.away).add(w);
    cnt[w]! += 1;
    done[gi] = true;
    for (const t of [g.home, g.away]) {
      gp.set(t, gp.get(t)! + 1);
      if (inWindow(w)) winPlayed.set(t, winPlayed.get(t)! + 1);
    }
  };
  const undo = (gi: number, w: number) => {
    const g = matchups[gi]!;
    wk[gi] = 0;
    B(g.home).delete(w);
    B(g.away).delete(w);
    cnt[w]! -= 1;
    done[gi] = false;
    for (const t of [g.home, g.away]) {
      gp.set(t, gp.get(t)! - 1);
      if (inWindow(w)) winPlayed.set(t, winPlayed.get(t)! - 1);
    }
  };

  let placed = 0;
  let steps = 0;
  let budget = 0;

  const solve = (): boolean => {
    if (placed === N) return true;
    if (++steps > budget) return false;
    let pick = -1;
    let pickLW: number[] = [];
    for (let gi = 0; gi < N; gi++) {
      if (done[gi]) continue;
      const lw = legalWeeks(gi);
      if (lw.length === 0) return false;
      if (pick === -1 || lw.length < pickLW.length) {
        pick = gi;
        pickLW = lw;
        if (lw.length === 1) break;
      }
    }
    const g = matchups[pick]!;
    // mandatory weeks first (pack to 16), then window weeks nearest their target
    pickLW.sort((a, b) => {
      const wa = inWindow(a);
      const wb = inWindow(b);
      if (wa !== wb) return wa ? 1 : -1;
      if (!wa) return cnt[b]! - cnt[a]! || rand() - 0.5;
      return Math.abs(cnt[a]! + 1 - WINDOW_TARGET) - Math.abs(cnt[b]! + 1 - WINDOW_TARGET) || rand() - 0.5;
    });
    for (const w of pickLW) {
      apply(pick, w);
      placed += 1;
      if (teamOk(g.home) && teamOk(g.away) && solve()) return true;
      placed -= 1;
      undo(pick, w);
    }
    return false;
  };

  for (let attempt = 0; attempt < 600; attempt++) {
    budget = steps + 50_000;
    if (solve()) {
      return matchups
        .map((m, i) => ({ week: wk[i]!, home: m.home, away: m.away }))
        .sort((a, b) => a.week - b.week || a.home.localeCompare(b.home));
    }
    wk.fill(0);
    for (const s of busy.values()) s.clear();
    cnt.fill(0);
    done.fill(false);
    for (const t of teams) {
      gp.set(t, 0);
      winPlayed.set(t, 0);
    }
    placed = 0;
  }
  throw new Error("assignWeeks: no valid 18-week layout found");
}

export function nflSchedule(
  priorRankOrOpts: Map<string, number> | ScheduleOptions = {},
): SchedulePair[] {
  const opts: ScheduleOptions =
    priorRankOrOpts instanceof Map ? { priorRank: priorRankOrOpts } : priorRankOrOpts;
  const year = opts.year ?? 2026;
  const priorRank = opts.priorRank ?? new Map();
  return assignWeeks(makeMatchups(year, priorRank), year);
}

export { conferenceOf, divisionOf };
