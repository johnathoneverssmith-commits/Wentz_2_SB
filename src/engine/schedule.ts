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
 * The division pairings rotate on a fixed cycle (here keyed off `year`); the
 * "same-place" games need each team's prior-year finish rank within its
 * division (1..4). With no history, `priorRank` defaults to roster strength.
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

export interface SchedulePair {
  week: number;
  home: string;
  away: string;
}

export interface ScheduleOptions {
  /** Season year — drives the division-pairing rotations. Default 2025. */
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

/** Intra-conference 4-game partner for each division (a derangement per conf). */
function intraConfPairs(year: number): Map<DivisionId, DivisionId> {
  const m = new Map<DivisionId, DivisionId>();
  for (const conf of ["AFC", "NFC"] as Conference[]) {
    const ds = divisionsIn(conf);
    // 3-year rotation over the derangements of 4 elements that pair up (2 swaps)
    const rot = year % 3;
    const pairings = [
      [
        [0, 1],
        [2, 3],
      ],
      [
        [0, 2],
        [1, 3],
      ],
      [
        [0, 3],
        [1, 2],
      ],
    ][rot]!;
    for (const [i, j] of pairings) {
      m.set(ds[i!]!, ds[j!]!);
      m.set(ds[j!]!, ds[i!]!);
    }
  }
  return m;
}

/** Inter-conference 4-game partner for each division (a bijection AFC↔NFC). */
function interConfPairs(year: number): Map<DivisionId, DivisionId> {
  const m = new Map<DivisionId, DivisionId>();
  const afc = divisionsIn("AFC");
  const nfc = divisionsIn("NFC");
  const rot = year % 4;
  for (let i = 0; i < 4; i++) {
    const j = (i + rot) % 4;
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

  // 5. 17th game: same-place finisher in the other conference. AFC div i plays
  //    NFC div σ(i) where σ is a bijection that avoids the 4-game inter-conf
  //    partner (σ(i) ≠ (i+rot) mod 4). AFC hosts on even years.
  const afc = divisionsIn("AFC");
  const nfc = divisionsIn("NFC");
  const rot = year % 4;
  const shift = 1 + (year % 3); // 1..3 → never lands on the already-played partner
  const afcHosts = year % 2 === 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + rot + shift) % 4;
    for (let r = 0; r < 4; r++) {
      const a = ranked[afc[i]!][r]!;
      const n = ranked[nfc[j]!][r]!;
      if (afcHosts) add(a, n);
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
 * Lay the 272 matchups across 18 weeks: each team plays 17 games with one bye,
 * ≤ 1 game/team/week, ≤ 16 games/week.
 *
 * Two stages. (1) A backtracking edge-colouring places every matchup in a legal
 * week — most-constrained game first, weeks nearest a soft target first, with
 * randomised restarts. Deterministic (RNG seeded off the season). (2) A flatten
 * pass moves games out of the fullest weeks into the emptiest until every week
 * holds 13–16 games, so byes spread across the calendar instead of piling into
 * one near-empty week.
 *
 * Bye-week placement is only approximately realistic in V1 (real NFL byes sit in
 * weeks 5–14); it does not affect standings, seeding or playoff results.
 */
function assignWeeks(matchups: Directed[], year: number): SchedulePair[] {
  const WEEKS = 18;
  const CAP = 16;
  const TARGET = 15; // ≈ 272 / 18
  const N = matchups.length;
  const teams = [...new Set(matchups.flatMap((m) => [m.home, m.away]))].sort();
  const rand = mulberry32(`${year}:${teams.join("")}`);

  const wk = new Array<number>(N).fill(0);
  const busy = new Map<string, Set<number>>(teams.map((t) => [t, new Set<number>()]));
  const cnt = new Array<number>(WEEKS + 1).fill(0);
  const done = new Array<boolean>(N).fill(false);
  const B = (t: string) => busy.get(t)!;

  const legalWeeks = (gi: number): number[] => {
    const g = matchups[gi]!;
    const out: number[] = [];
    for (let w = 1; w <= WEEKS; w++)
      if (cnt[w]! < CAP && !B(g.home).has(w) && !B(g.away).has(w)) out.push(w);
    return out;
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
    pickLW.sort(
      (a, b) => Math.abs(cnt[a]! + 1 - TARGET) - Math.abs(cnt[b]! + 1 - TARGET) || rand() - 0.5,
    );
    for (const w of pickLW) {
      wk[pick] = w;
      B(g.home).add(w);
      B(g.away).add(w);
      cnt[w]! += 1;
      done[pick] = true;
      placed += 1;
      if (solve()) return true;
      wk[pick] = 0;
      B(g.home).delete(w);
      B(g.away).delete(w);
      cnt[w]! -= 1;
      done[pick] = false;
      placed -= 1;
    }
    return false;
  };

  let solved = false;
  for (let attempt = 0; attempt < 400 && !solved; attempt++) {
    budget = steps + 40_000;
    if (solve()) {
      solved = true;
      break;
    }
    wk.fill(0);
    for (const s of busy.values()) s.clear();
    cnt.fill(0);
    done.fill(false);
    placed = 0;
  }
  if (!solved) throw new Error("assignWeeks: no valid 18-week layout found");

  // --- flatten: even out week sizes so byes spread across the calendar ---
  const gamesInWeek = (w: number) => {
    const out: number[] = [];
    for (let gi = 0; gi < N; gi++) if (wk[gi] === w) out.push(gi);
    return out;
  };
  for (let iter = 0; iter < 2000; iter++) {
    let full = 1;
    let empty = 1;
    for (let w = 2; w <= WEEKS; w++) {
      if (cnt[w]! > cnt[full]!) full = w;
      if (cnt[w]! < cnt[empty]!) empty = w;
    }
    if (cnt[full]! - cnt[empty]! <= 1) break;
    // find a game in `full` whose teams are both free in `empty`
    let moved = false;
    for (const gi of gamesInWeek(full)) {
      const g = matchups[gi]!;
      if (B(g.home).has(empty) || B(g.away).has(empty)) continue;
      B(g.home).delete(full);
      B(g.away).delete(full);
      B(g.home).add(empty);
      B(g.away).add(empty);
      wk[gi] = empty;
      cnt[full]! -= 1;
      cnt[empty]! += 1;
      moved = true;
      break;
    }
    if (!moved) break;
  }

  return matchups
    .map((m, i) => ({ week: wk[i]!, home: m.home, away: m.away }))
    .sort((a, b) => a.week - b.week || a.home.localeCompare(b.home));
}

export function nflSchedule(
  priorRankOrOpts: Map<string, number> | ScheduleOptions = {},
): SchedulePair[] {
  const opts: ScheduleOptions =
    priorRankOrOpts instanceof Map ? { priorRank: priorRankOrOpts } : priorRankOrOpts;
  const year = opts.year ?? 2025;
  const priorRank = opts.priorRank ?? new Map();
  return assignWeeks(makeMatchups(year, priorRank), year);
}

export { conferenceOf, divisionOf };
