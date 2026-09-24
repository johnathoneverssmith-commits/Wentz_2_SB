/**
 * Every rule the league runs on, as pure functions over `LeagueState`.
 *
 * These used to live at the bottom of `store.ts`, below the zustand store
 * they were written for. That was fine while the only caller was one
 * browser: it stopped being fine the moment a server had to enforce the same
 * rules, because importing them dragged in zustand, the persist middleware
 * and a reach for `localStorage`. The logic is unchanged — this is a move,
 * not a rewrite — and `store.ts` now imports from here.
 *
 * Nothing in this file does I/O, touches the DOM, or holds state. Given the
 * same `LeagueState` it returns the same answer, on a server or in a tab,
 * which is what lets one set of rules govern both.
 */
import { fittedAttributes } from "@/sim/attributeFit";
import { Rng } from "@/sim/rng";
import { replacementLevels, unitGainer } from "./unitValue.ts";
import {
  type Coach,
  type DraftProspect,
  type CoachRole,
  type ContractOffer,
  type FreeAgencyState,
  type LeagueState,
  type Player,
  type Position,
  type Stage,
  type DraftMode,
} from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { contractValueFor, MockSimulationService } from "@/sim/MockSimulationService";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { applyExtension, extensionAsk } from "./contracts";
import { runCoachingCarousel } from "./coachingCarousel";
import { OFFSEASON_ROSTER_SIZE, ROSTER_SIZE } from "@/sim/roster-template.ts";
import { coachPriorities, playerPriorities } from "@/sim/priorities";

import {
  clearRoomFor,
  expireContracts,
  marketDeal,
  openCapRoomForFreeAgency,
  recomputeTeamRatings,
  releaseToMarket,
} from "./seed.ts";
import { DRAFT_ROUNDS, FANTASY_DRAFT_ROUNDS, ensureDraftPicks, pickKey, pickOrderFor } from "./draftPicks.ts";
import {
  strategyAgeBonus,
  strategyCoachBonus,
  strategyEliteBonus,
  strategyFor,
  strategyNeedAdjustment,
  strategyPositionBonus,
} from "./aiStrategy.ts";
import { deterministicNoiseUnit, difficultyProfile, shortlistByBaseScore } from "./aiDifficulty.ts";
import { updateHoodedFigureStreaks } from "./hoodedFigure.ts";

/** Which side of the market an action is about. */
export type Subject = "players" | "coaches";

/**
 * The rules need a few model calls — retirement odds, season scoring, scheme
 * fit. `HybridSimulationService` delegates every one of them straight to Mock
 * anyway (see its header), so using Mock directly here keeps this file free
 * of the network and deterministic wherever it runs.
 */
const sim = new MockSimulationService();


/** Every human GM has marked themselves ready for the current stage. */
export function humanGate(state: LeagueState): boolean {
  return state.gms.filter((g) => g.isHuman).every((g) => state.readiness[g.id]);
}

/**
 * GM slots in an online league that nobody has claimed yet.
 *
 * An unclaimed slot is the one thing in the league with no team *and* no
 * person: claiming sets both in the same transaction, and the single-player
 * seed hands every GM a team up front. So this counts exactly the seats still
 * waiting for someone to sit in them, and is zero in a local dynasty.
 */
export function openSlots(state: LeagueState): number {
  return state.gms.filter((g) => !g.teamCode && !g.isHuman).length;
}

/**
 * Setup does not close while a seat is still empty.
 *
 * Readiness alone cannot carry this. An unclaimed slot is marked ready the
 * moment the stage opens — correctly, because for every stage after this one
 * it is an AI team with nobody to wait for — so the first GM to click ready
 * was the last one too, and the league fell into the fantasy draft with one
 * human in it. Whoever joined afterwards arrived to a draft already run.
 *
 * Starting is the one decision a league cannot take back, so it is the one
 * that waits for everybody. Afterwards the ordinary rules apply: latecomers
 * do not exist, absent GMs get played by their staff, and no single person
 * can stall a league by refusing to click. A commissioner who is done waiting
 * still has the override, which is the deliberate way to start short.
 */
export function rosterGate(state: LeagueState): boolean {
  return state.stage !== "setup" || openSlots(state) === 0;
}

/** Reset for a new stage: everyone but the viewer is ready by default. */
export function clearReadiness(state: LeagueState): void {
  for (const g of state.gms) state.readiness[g.id] = g.id !== state.viewerGmId;
}

export function faField(subject: Subject): "freeAgency" | "coachingHire" {
  return subject === "players" ? "freeAgency" : "coachingHire";
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function applyPick(s: LeagueState, selectedId: string): void {
  const d = s.draft!;
  const idx = d.currentPickIndex;
  const teamCode = d.pickOrder[idx]!;
  // every team picks once per round (startDraft builds pickOrder from all 32
  // teams), so the round is the pick index over the team count — not over
  // the number of human GMs, which put pick 33 in "round 12" and drove the
  // slotted rookie contract (36 - round*4.5) negative for later picks
  const teamsPerRound = Object.keys(s.teams).length || 32;
  const round = Math.floor(idx / teamsPerRound) + 1;
  if (d.mode === "rookie") {
    const pr = s.draftClass.find((p) => p.id === selectedId);
    d.results.push({
      pickNumber: idx + 1,
      round,
      teamCode,
      selectedId,
      selectedName: pr?.name ?? null,
      selectedPosition: pr?.position ?? null,
    });
  } else {
    const p = s.players[selectedId];
    if (p) {
      // A drafted player is on the team — all of it, not just the team code.
      // Leaving `free_agent` set made him count as rostered *and* as market
      // supply, so the roster fill would "sign" a man it already had and stop
      // one real body short of 53.
      p.nfl_team = teamCode;
      p.free_agent = false;
      // a fantasy pick is a signing: pay him, on a term staggered by round so
      // a team's twenty deals don't all run out in the same offseason. (By
      // pick index they would: 32 teams pick per round, so every pick a team
      // owns shares the same index mod 4.)
      if (!p.contract) p.contract = marketDeal(teamCode, p, 2 + ((round - 1) % 4));
      s.standingFreeAgents = s.standingFreeAgents.filter((id) => id !== selectedId);
    }
    d.results.push({
      pickNumber: idx + 1,
      round,
      teamCode,
      selectedId,
      selectedName: p?.name ?? null,
      selectedPosition: p?.position ?? null,
    });
  }
  d.currentPickIndex += 1;
}

/**
 * Best-player-available, tempered by the picking team's actual positional
 * need (OQ-9) — not pure highest-overall. `NEED_WEIGHT` is calibrated so a
 * maximal need (no one at all on the roster at that position) can tip a
 * close call but won't make a team reach for a real reach over a
 * meaningfully better prospect at a position they're already fine at.
 *
 * CPU Fantasy Draft + Roster Need optimization pass
 * (MASTER_OPTIMIZED_FRANCHISE_PARAMETERS.json -> cpu_draft) raised this from
 * 0.6, alongside `positionalNeed`'s own constants below.
 */
const NEED_WEIGHT = 0.72;

/**
 * What a position is worth, in overall points, when comparing across
 * positions.
 *
 * `overall` is graded *within* a position — a 95 safety is elite among
 * safeties, not the equal of a 95 quarterback — so ranking a draft board by
 * raw overall compares two things that were never on the same scale. Left
 * alone it drafted a 31-year-old safety first and a punter thirteenth, which
 * is the report that prompted this.
 *
 * The premiums are deliberately small enough that a genuinely great player
 * still outranks a mediocre one at a richer position. At +14 the quarterback
 * premium alone lifted a 38-year-old Stafford above Ja'Marr Chase; +10 keeps
 * the elite quarterbacks at the top of the board without making the position
 * itself the whole argument.
 */
// Premiums follow what a point is measured to be worth in this engine
// (see `POSITION_VALUE` in MockSimulationService — about 9·ln(value/0.8)),
// not NFL convention: a running back or safety carries a game here, a tight
// end or an outside linebacker barely touches one.
const POSITION_VALUE: Record<Position, number> = {
  QB: 10,
  RB: 7,
  S: 4,
  EDGE: 4,
  WR: 4,
  CB: 3,
  ILB: 1,
  OT: 1,
  OG: 0,
  C: 0,
  DT: 0,
  TE: -3,
  OLB: -8,
  K: -14,
  P: -14,
};

/** Cross-position draft value: what he is, plus what the position is worth. */
/**
 * How much a point of unit strength (`unitValue.ts`) counts against a point
 * of the base draft value, for a GM that reads units at all (Master).
 */
const UNIT_GAIN_WEIGHT = 1.0;

export function draftValue(overall: number, position: Position): number {
  return overall + POSITION_VALUE[position];
}

export function bestAvailable(s: LeagueState): string | null {
  const d = s.draft!;
  const teamCode = d.pickOrder[d.currentPickIndex];
  const taken = new Set(d.results.map((r) => r.selectedId));
  // Need only depends on the picking team's roster, not on which two players
  // are being compared — compute it once per position per call. (It used to
  // run inside the sort comparator: ~40k full roster scans per pick, which
  // made "Autopick remaining" freeze the browser for minutes.)
  const needByPos = new Map<Position, number>();
  const need = (pos: Position): number => {
    let v = needByPos.get(pos);
    if (v === undefined) {
      v = teamCode ? draftAwareNeed(s, teamCode, pos) * NEED_WEIGHT : 0;
      needByPos.set(pos, v);
    }
    return v;
  };
  // Strategy and difficulty mirror planAutopicks' scoring exactly (isAiTeam
  // gate, same bonus/noise/shortlist terms) so the two paths never diverge;
  // draftPerf.test.ts guards this invariant directly.
  const isAi = !!teamCode && isAiTeam(s, teamCode);
  const strategy = isAi ? strategyFor(teamCode!, s.season) : "balanced";
  const difficulty = isAi ? difficultyProfile(s.config.difficulty) : difficultyProfile("expert");
  const pickIndex = d.currentPickIndex;
  // what the team already carries at each position — the same lists
  // `planAutopicks` keeps, so a pick that would only be cut is penalised alike
  const carried = new Map<Position, number[]>();
  if (teamCode) {
    for (const p of Object.values(s.players)) {
      if (p.retired || p.nfl_team !== teamCode) continue;
      const l = carried.get(p.position);
      if (l) l.push(p.overall);
      else carried.set(p.position, [p.overall]);
    }
    if (d.mode === "rookie") {
      for (const pk of draftedThisDraft(s).get(teamCode) ?? []) {
        const l = carried.get(pk.position);
        if (l) l.push(pk.collegeOverall);
        else carried.set(pk.position, [pk.collegeOverall]);
      }
    }
  }
  const waste = surplusPenalties((pos) => carried.get(pos) ?? []);
  // Master only: what the candidate adds to this team's units — read from
  // exactly what `planAutopicks` keeps (roster by position, plus this rookie
  // draft's own picks) so the two paths still pick identically
  let unitTerm = (_pos: Position, _value: number): number => 0;
  if (difficulty.unitAwareness > 0 && teamCode) {
    const byPos = new Map<string, number[]>();
    const push = (pos: string, v: number) => {
      const l = byPos.get(pos);
      if (l) l.push(v);
      else byPos.set(pos, [v]);
    };
    // the same board and the same counts `planAutopicks` reads
    const counts = new Map<string, Map<string, number>>();
    const count = (team: string, pos: string) => {
      let m = counts.get(team);
      if (!m) counts.set(team, (m = new Map()));
      m.set(pos, (m.get(pos) ?? 0) + 1);
    };
    for (const p of Object.values(s.players)) {
      if (p.retired) continue;
      count(p.nfl_team, p.position);
      if (p.nfl_team === teamCode) push(p.position, p.overall);
    }
    if (d.mode === "rookie") {
      for (const [team, picks] of draftedThisDraft(s)) {
        for (const pk of picks) {
          count(team, pk.position);
          if (team === teamCode) push(pk.position, pk.collegeOverall);
        }
      }
    }
    const board =
      d.mode === "rookie"
        ? s.draftClass.filter((x) => !taken.has(x.id)).map((x) => ({ position: x.position, overall: x.collegeOverall }))
        : Object.values(s.players)
            .filter((x) => !taken.has(x.id) && !x.retired)
            .map((x) => ({ position: x.position, overall: x.overall }));
    board.sort((a, b) => b.overall - a.overall);
    const availByPos = new Map<string, number[]>();
    for (const c of board) {
      const l = availByPos.get(c.position);
      if (l) l.push(c.overall);
      else availByPos.set(c.position, [c.overall]);
    }
    const replacement = replacementLevels(
      Object.keys(s.teams),
      (pos) => availByPos.get(pos) ?? [],
      (team, pos) => counts.get(team)?.get(pos) ?? 0,
    );
    const units = unitGainer((pos) => byPos.get(pos) ?? [], replacement);
    unitTerm = (pos, value) => difficulty.unitAwareness * UNIT_GAIN_WEIGHT * units(pos, value);
  }
  // first-max scan == stable sort's [0]: ties keep the earliest candidate
  let bestId: string | null = null;
  let bestScore = -Infinity;
  if (d.mode === "rookie") {
    const untaken = s.draftClass.filter((x) => !taken.has(x.id));
    const youngestAge = Math.min(...untaken.map((x) => x.age));
    const baseScore = (x: (typeof untaken)[number]): number =>
      x.collegeOverall + need(x.position) * difficulty.needAwareness - waste(x.position, x.collegeOverall);
    const shortlist = shortlistByBaseScore(untaken, baseScore, difficulty.candidateDepth);
    for (const x of shortlist) {
      const noise =
        difficulty.rookieEvaluationNoise === 0
          ? 0
          : deterministicNoiseUnit(teamCode ?? "", s.season, "draft", x.id, pickIndex) * difficulty.rookieEvaluationNoise;
      let score =
        baseScore(x) +
        strategyPositionBonus(strategy, x.position, 0.75) +
        strategyEliteBonus(strategy, x.collegeOverall) +
        unitTerm(x.position, x.collegeOverall) +
        noise;
      if (strategy === "high_ceiling" && x.age === youngestAge) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestId = x.id;
      }
    }
    return bestId;
  }
  const untaken = Object.values(s.players).filter((x) => !taken.has(x.id) && !x.retired);
  const baseScore = (x: (typeof untaken)[number]): number =>
    draftValue(x.overall, x.position) + need(x.position) * difficulty.needAwareness - waste(x.position, x.overall);
  const shortlist = shortlistByBaseScore(untaken, baseScore, difficulty.candidateDepth);
  for (const x of shortlist) {
    const noise =
      difficulty.evaluationNoise === 0
        ? 0
        : deterministicNoiseUnit(teamCode ?? "", s.season, "draft", x.id, pickIndex) * difficulty.evaluationNoise;
    const score =
      baseScore(x) +
      strategyPositionBonus(strategy, x.position) +
      strategyEliteBonus(strategy, x.overall) +
      strategyAgeBonus(strategy, x.age) +
      strategyNeedAdjustment(strategy, need(x.position) / NEED_WEIGHT) +
      unitTerm(x.position, x.overall) +
      noise;
    if (score > bestScore) {
      bestScore = score;
      bestId = x.id;
    }
  }
  return bestId;
}

/**
 * Every pick "Autopick remaining" would make, decided up front on plain data.
 *
 * Running the loop inside the immer producer meant `bestAvailable` re-read the
 * proxied player map on every pick (a 20-round fantasy draft is 640 picks over
 * ~1,700 players), and immer's proxies cost ~100x a plain property read: the
 * button froze the tab for over a minute. This mirrors the handful of fields
 * the scoring actually reads, runs the same first-max scan and the same
 * need-tempered score, and hands the producer a finished list of ids — same
 * picks, no proxy in the hot path. `positionalNeed` is maintained incrementally
 * here (a fantasy pick moves a player between teams, changing both teams' need
 * at that position) rather than rescanned per candidate.
 */
export function planAutopicks(s: LeagueState): string[] {
  const d = s.draft;
  if (!d) return [];
  const rookie = d.mode === "rookie";

  // candidate order mirrors bestAvailable's, so ties resolve identically
  const candidates = rookie
    ? s.draftClass.map((p) => ({ id: p.id, position: p.position, overall: p.collegeOverall, age: p.age }))
    : Object.values(s.players)
        .filter((p) => !p.retired)
        .map((p) => ({ id: p.id, position: p.position, overall: p.overall, age: p.age }));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  // best-first, once — replacement levels (Master) read the board in this order
  const bestFirst = [...candidates].sort((a, b) => b.overall - a.overall);
  const leagueTeams = Object.keys(s.teams);
  // rookie prospects are clustered young (§5): only the youngest visible
  // prospect at the table gets high-ceiling's small nod, never a general age
  // preference the way the fantasy draft's veteran ages support one.
  const youngestRookieAge = rookie ? Math.min(...candidates.map((c) => c.age)) : 0;

  const taken = new Set<string>();
  for (const r of d.results) if (r.selectedId) taken.add(r.selectedId);

  // team -> position -> overalls currently on that roster; positionalNeed only
  // ever asks for the max of one of these groups
  const rosters = new Map<string, Map<Position, number[]>>();
  const groupFor = (team: string, pos: Position): number[] => {
    let byPos = rosters.get(team);
    if (!byPos) rosters.set(team, (byPos = new Map()));
    let list = byPos.get(pos);
    if (!list) byPos.set(pos, (list = []));
    return list;
  };
  for (const p of Object.values(s.players)) {
    if (!p.retired) groupFor(p.nfl_team, p.position).push(p.overall);
  }
  // A rookie pick isn't on the roster until it signs, so a team's own picks
  // in this draft are counted toward its need here — see `draftedThisDraft`.
  if (rookie) {
    for (const [team, picks] of draftedThisDraft(s)) {
      for (const pk of picks) groupFor(team, pk.position).push(pk.collegeOverall);
    }
  }
  const needOf = (team: string | undefined, pos: Position): number => {
    if (!team) return 0;
    const list = rosters.get(team)?.get(pos);
    let best = 0;
    if (list) for (const v of list) if (v > best) best = v;
    const raw =
      STARTER_QUALITY_BAR - (best || EMPTY_POSITION_BASE) + (POSITION_NEED_BONUS[pos] ?? 0);
    return Math.max(MIN_RAW_NEED, raw) * NEED_WEIGHT;
  };

  const out: string[] = [];
  for (let i = d.currentPickIndex; i < d.pickOrder.length; i++) {
    const teamCode = d.pickOrder[i];
    const needByPos = new Map<Position, number>();
    const need = (pos: Position): number => {
      let v = needByPos.get(pos);
      if (v === undefined) needByPos.set(pos, (v = needOf(teamCode, pos)));
      return v;
    };
    // Strategy and difficulty are both CPU-only preference/competence
    // layers (§1.1/§18, difficulty §20): a human's own team, even when
    // autopicked on their behalf, uses the shared base evaluator only — the
    // same guarantee `isAiTeam` already gives every other gate.
    const isAi = !!teamCode && isAiTeam(s, teamCode);
    const strategy = isAi ? strategyFor(teamCode!, s.season) : "balanced";
    const difficulty = isAi ? difficultyProfile(s.config.difficulty) : difficultyProfile("expert");
    const posScale = rookie ? 0.75 : 1;
    const noiseScale = rookie ? difficulty.rookieEvaluationNoise : difficulty.evaluationNoise;
    // Master only: what the candidate adds to this team's units
    let units: ((pos: string, value: number) => number) | null = null;
    if (difficulty.unitAwareness > 0 && teamCode) {
      const availByPos = new Map<string, number[]>();
      for (const c of bestFirst) {
        if (taken.has(c.id)) continue;
        const l = availByPos.get(c.position);
        if (l) l.push(c.overall);
        else availByPos.set(c.position, [c.overall]);
      }
      const replacement = replacementLevels(
        leagueTeams,
        (pos) => availByPos.get(pos) ?? [],
        (team, pos) => rosters.get(team)?.get(pos as Position)?.length ?? 0,
      );
      units = unitGainer((pos) => rosters.get(teamCode)?.get(pos as Position) ?? [], replacement);
    }
    const unitTerm = (pos: Position, value: number): number =>
      units ? difficulty.unitAwareness * UNIT_GAIN_WEIGHT * units(pos, value) : 0;

    // §10/§20: base value first (player value + need scaled by difficulty's
    // need-awareness), then difficulty's candidate-depth search limit, then
    // strategy preference and evaluation noise only within that shortlist —
    // a lower difficulty can miss the true best candidate because it never
    // seriously considered it, not just because it mis-ranked something.
    const untaken = candidates.filter((c) => !taken.has(c.id));
    const waste = surplusPenalties((pos) => (teamCode ? rosters.get(teamCode)?.get(pos) : undefined) ?? []);
    const baseScore = (c: (typeof untaken)[number]): number =>
      (rookie
        ? c.overall + need(c.position) * difficulty.needAwareness
        : draftValue(c.overall, c.position) + need(c.position) * difficulty.needAwareness) -
      waste(c.position, c.overall);
    const shortlist = shortlistByBaseScore(untaken, baseScore, difficulty.candidateDepth);

    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const c of shortlist) {
      const noise = noiseScale === 0 ? 0 : deterministicNoiseUnit(teamCode ?? "", s.season, "draft", c.id, i) * noiseScale;
      let score =
        baseScore(c) +
        strategyPositionBonus(strategy, c.position, posScale) +
        strategyEliteBonus(strategy, c.overall) +
        unitTerm(c.position, c.overall) +
        noise;
      if (rookie) {
        if (strategy === "high_ceiling" && c.age === youngestRookieAge) score += 1;
      } else {
        // `need(pos)` is already memoized per pick (see above) and pre-scaled
        // by NEED_WEIGHT; un-scale it back to the raw need `strategyNeedAdjustment`
        // expects rather than calling `positionalNeed` again per candidate —
        // that recomputation (an O(roster) scan) inside this per-candidate,
        // per-pick loop is what made a 640-pick draft cost billions of scans.
        score += strategyAgeBonus(strategy, c.age) + strategyNeedAdjustment(strategy, need(c.position) / NEED_WEIGHT);
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = c.id;
      }
    }
    if (!bestId) break;
    out.push(bestId);
    taken.add(bestId);

    // a fantasy pick moves the player onto the picking team; a rookie pick
    // doesn't touch `players` until the signing stage, but it still fills
    // the need it was drafted for
    if (rookie && teamCode) {
      const c = byId.get(bestId);
      if (c) groupFor(teamCode, c.position).push(c.overall);
    }
    if (!rookie && teamCode) {
      const c = byId.get(bestId);
      const from = s.players[bestId]?.nfl_team;
      if (c && from && from !== teamCode) {
        const old = groupFor(from, c.position);
        const at = old.indexOf(c.overall);
        if (at >= 0) old.splice(at, 1);
        groupFor(teamCode, c.position).push(c.overall);
      }
    }
  }
  return out;
}

/**
 * Open a bidding window — the free-agent market, or the coaching market.
 *
 * Like the draft, this used to be the screen's job: open Free Agency, find no
 * window, make one. Online the server never made one, so a league walked
 * through `coachingHiring` with nothing to hire from and `offseasonFreeAgency`
 * with nobody to sign — the stage advanced, and the market it existed for
 * never happened. Verified on the deployed server: a league reached the
 * preseason with `coachingHire` still null.
 *
 * Idempotent: a window that already exists is left exactly as it is, because
 * re-opening one would throw away everybody's bids.
 */
export function beginBidding(s: LeagueState, subject: Subject): void {
  const field = faField(subject);
  if (s[field]) return;
  if (subject === "players") {
    // the market is whoever's deal has run out
    for (const p of Object.values(s.players)) {
      if (p.retired || p.free_agent) continue;
      if (p.contract && p.contract.years_remaining <= 0) releaseToMarket(s, p);
    }
    // then cut day, so there is money in the league to spend
    if (s.stage === "offseasonFreeAgency") openCapRoomForFreeAgency(s);
    recomputeTeamRatings(s);
  } else {
    // coaching: every team starts with zero coaches — all coaches to market
    for (const c of Object.values(s.coaches)) {
      c.team = null;
      c.contract = null;
    }
  }
  s[field] = {
    subject,
    mode: "main",
    day: 1,
    secondsRemaining: 12 * 60,
    interstitialVisible: false,
    bids: {},
    signed: [],
  };
}

/**
 * Settle one day of sealed bids and move to the next.
 *
 * The day is what makes a sealed-bid market a market: bids go in, the day
 * turns, everyone finds out together. Online nothing turned the day, so bids
 * went in and stayed in — the window opened on day one and stopped there.
 */
export function advanceBiddingDayOn(s: LeagueState, subject: Subject): boolean {
  const fa = s[faField(subject)];
  if (!fa || fa.mode !== "main") return false;
  resolveBiddingDay(s, subject, fa);
  if (fa.day >= 5) {
    // closing day — no team is left without a coaching staff
    if (subject === "coaches") fillVacantStaffs(s, fa);
    fa.mode = "standing";
    fa.interstitialVisible = false;
  } else {
    fa.day += 1;
    fa.secondsRemaining = 12 * 60;
    fa.interstitialVisible = true;
  }
  recomputeTeamRatings(s);
  return true;
}

/**
 * How many picks this team has made by hand in the running draft.
 *
 * Counts results rather than pick index, because the two diverge the moment
 * anything is autopicked on a team's behalf.
 */
export function picksMadeBy(s: LeagueState, teamCode: string): number {
  return (s.draft?.results ?? []).filter((r) => r.teamCode === teamCode).length;
}

/**
 * Every human GM has taken the number of picks the commissioner asked for.
 *
 * This is the condition that ends manual drafting. It is deliberately about
 * *every* human rather than the one who just picked: a draft order can give
 * one GM two picks before another has had one, and finishing early because
 * the fastest GM hit the number would take the draft away from everybody
 * else mid-round.
 *
 * `draftSimulateAfterPicks` of `null` means the commissioner chose to run the
 * whole thing by hand, so this is never true and the draft ends only when the
 * board does.
 */
export function draftThresholdMet(s: LeagueState): boolean {
  // Change 13: the rookie draft is one manual round and six automatic ones,
  // for everybody, regardless of what the commissioner set for the fantasy
  // draft. Seven rounds of turn-taking across eight GMs is a week of
  // real time spent on picks that are mostly special-teamers; round one is
  // the part with decisions in it.
  if (s.draft?.mode === "rookie") {
    return s.draft.currentPickIndex >= Object.keys(s.teams).length;
  }
  const threshold = s.config.draftSimulateAfterPicks;
  if (threshold == null) return false;
  if (!s.draft) return false;
  const humans = s.gms.filter((g) => g.isHuman && g.teamCode);
  if (humans.length === 0) return true;
  return humans.every((g) => picksMadeBy(s, g.teamCode) >= threshold);
}

/**
 * Finish the board, however much of it is left.
 *
 * One `planAutopicks` call plans every remaining slot in a single pass, so
 * completing four hundred picks costs one plan rather than four hundred.
 * Returns how many it made, so the caller can say so.
 */
export function completeDraft(s: LeagueState): number {
  const d = s.draft;
  if (!d) return 0;
  const planned = planAutopicks(s);
  let made = 0;
  for (const id of planned) {
    if (d.currentPickIndex >= d.pickOrder.length) break;
    applyPick(s, id);
    made++;
  }
  return made;
}

/** Nobody human is running this team, so the league plays it. */
export function isAiTeam(s: LeagueState, teamCode: string | undefined): boolean {
  if (!teamCode) return false;
  return !s.gms.some((g) => g.isHuman && g.teamCode === teamCode);
}

/**
 * Take every AI pick up to the next one a person owes.
 *
 * Single-player the draft room does this in the browser, between renders, and
 * it is invisible. Online the browser must not: a client picking for twenty-
 * eight teams it does not control is twenty-eight picks the other GMs never
 * agreed to, made from whatever copy of the league that tab happened to hold.
 * So the server does it, and the league moves to the next human in one step.
 *
 * Without this the draft simply stopped. The deadline sweeper only ever
 * picked for *absent humans*, so the first AI team to reach the clock — pick
 * one, most of the time — held it forever, and no timeout would free it.
 *
 * `planAutopicks` plans the whole remaining board in a single pass, so this
 * costs one plan rather than one per pick.
 */
export function runAiPicks(s: LeagueState): string[] {
  const d = s.draft;
  if (!d) return [];
  if (!isAiTeam(s, d.pickOrder[d.currentPickIndex])) return [];

  const planned = planAutopicks(s);
  const played: string[] = [];
  let i = 0;
  while (d.currentPickIndex < d.pickOrder.length) {
    const team = d.pickOrder[d.currentPickIndex];
    if (!isAiTeam(s, team)) break;
    const pick = planned[i++];
    if (!pick) break;
    applyPick(s, pick);
    played.push(team!);
  }
  return played;
}

export function offerToContract(o: ContractOffer) {
  return {
    team_id: o.teamCode,
    years_remaining: o.years,
    total_value: Math.round((o.baseSalary * o.years + o.signingBonus) * 10) / 10,
    guaranteed: o.guaranteed,
    cap_hit_by_year: Array.from({ length: o.years }, () =>
      Math.round((o.baseSalary + o.signingBonus / o.years) * 10) / 10,
    ),
    signing_bonus: o.signingBonus,
  };
}

/** Resolve one in-game day for either subject. */
export function resolveBiddingDay(s: LeagueState, subject: Subject, fa: FreeAgencyState): void {
  const rng = mulberry(s.season * 131 + fa.day * 7 + (subject === "players" ? 1 : 2));
  if (subject === "players") {
    // Best available first, and more so on the opening days.
    //
    // A day used to pick uniformly at random out of the whole market, which
    // meant the 96-overall quarterback was no likelier to sign than the last
    // camp body on the board: a five-day window closed with Josh Allen and
    // Lamar Jackson still unsigned among 452 free agents. Real free agency
    // clears from the top and clears fast. `rng() ** bias` pulls the draw
    // toward the front of a best-first list, hard on day one and flattening
    // out as the week goes on and the names left are ordinary.
    const pool = Object.values(s.players)
      .filter((p) => p.free_agent && !p.retired)
      .sort((a, b) => b.overall - a.overall);
    const bias = Math.max(1.2, 4 - (fa.day - 1) * 0.7);
    const signCount = 12 + Math.floor(rng() * 17);
    // `cap.used` is only recomputed once the day is over, so a day's own
    // signings are tracked here — otherwise four winning bids on one day each
    // see the same room and the team ends the day well past the cap.
    const spentToday: Record<string, number> = {};
    const humanTeams = new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
    for (let i = 0; i < signCount; i++) {
      const p = pool[Math.floor(pool.length * rng() ** bias)];
      if (!p || fa.signed.some((x) => x.id === p.id)) continue;
      // Playtest finding 6: `bestOfferFor` only ranks bids already on the
      // board, and the AI fallback only ran when there were none at all —
      // once any human placed a bid, however small, it simply won, because
      // no AI team was ever asked whether it wanted the player too. A real
      // market has other teams in on a good player; this gives them a
      // chance to actually be there, weighted by how good he is, so a star
      // draws real competition and a camp body still mostly doesn't.
      const existing = fa.bids[p.id] ?? [];
      const aiAlreadyIn = existing.some((o) => aiControlledTeams(s).includes(o.teamCode));
      if (existing.length > 0 && !aiAlreadyIn) {
        const competeChance = clamp((p.overall - 65) / 40, 0.05, 0.85);
        if (rng() < competeChance) {
          (fa.bids[p.id] ??= []).push(aiOfferForPlayer(rng, s, p));
        }
      }
      const winning = bestOfferFor(fa, "players", p.id, s) ?? aiOfferForPlayer(rng, s, p);
      const team = s.teams[winning.teamCode];
      if (!team) continue;
      const hit = offerToContract(winning).cap_hit_by_year[0] ?? 0;
      const room = team.cap.total - team.cap.used - (spentToday[winning.teamCode] ?? 0);
      if (rosterCountOf(s, winning.teamCode) >= rosterLimitFor(s.stage)) continue;
      if (hit > room) {
        // A player this good is worth clearing room for — no team ever holds
        // $51M in reserve, so without this the best quarterback in football
        // goes unsigned through a whole free agency. Anyone ordinary stays on
        // the market instead, which is what a team short of money does.
        const worthIt = p.overall >= 85 && !humanTeams.has(winning.teamCode);
        if (!worthIt || !clearRoomFor(s, winning.teamCode, hit + (spentToday[winning.teamCode] ?? 0)))
          continue;
      }
      spentToday[winning.teamCode] = (spentToday[winning.teamCode] ?? 0) + hit;
      fa.signed.push({ id: p.id, toTeam: winning.teamCode, ...offerFields(winning), at: fa.day });
      p.free_agent = false;
      p.nfl_team = winning.teamCode;
      p.contract = offerToContract(winning);
    }
  } else {
    const openCoaches = Object.values(s.coaches).filter((c) => c.team === null);
    const signCount = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < signCount; i++) {
      const c = openCoaches[Math.floor(rng() * openCoaches.length)];
      if (!c || fa.signed.some((x) => x.id === c.id)) continue;
      const winning = bestOfferFor(fa, "coaches", c.id, s) ?? aiOfferForCoach(rng, s, c);
      if (!winning) continue; // no AI team has a vacancy at this role right now
      // don't let an AI team stack two coaches of the same role
      const clash = Object.values(s.coaches).some(
        (o) => o.team === winning.teamCode && o.role === c.role,
      );
      if (clash) continue;
      fa.signed.push({ id: c.id, toTeam: winning.teamCode, ...offerFields(winning), at: fa.day });
      c.team = winning.teamCode;
      c.contract = { yearsRemaining: winning.years, annualValue: winning.baseSalary };
    }
  }
}

/** Rough "who's the better hire" ordering, for the closing-day backfill. */
export function coachQuality(c: Coach): number {
  return c.role === "HC"
    ? (c.discipline ?? 0) + (c.gameManagement ?? 0) + (c.aggressiveness ?? 0) / 2
    : (c.playCallIq ?? 0) * 2;
}

/**
 * Nobody leaves the hiring window without a staff.
 *
 * The 5-day window only signs coaches to teams that actually bid, and it
 * resolves 6-13 of them a day — so a full window left ~29 of 32 teams short
 * and, if the player never bid, gave them nothing. There is no other way to
 * hire: `startBidding` won't reopen a window that already exists, and the
 * Coaching Staff hub is read-only. Teams were stranded with "Vacant" in every
 * role for the rest of the dynasty, which also means no scheme for
 * `computeSchemeFit` and no staff for the engine's coaching layer.
 *
 * So when the window closes, the league fills what's left: best remaining
 * candidate per role, teams taken in a seeded order so nobody is
 * systematically served last, at the coach's own asking price. Supply covers
 * it — the market is built with 40 HCs and 42 of each coordinator for 32
 * jobs apiece.
 */
export function fillVacantStaffs(s: LeagueState, fa: FreeAgencyState): void {
  for (const role of ["HC", "OC", "DC"] as CoachRole[]) {
    const filled = new Set(
      Object.values(s.coaches)
        .filter((c) => c.team && c.role === role)
        .map((c) => c.team!),
    );
    const needy = shuffle(
      Object.keys(s.teams).filter((t) => !filled.has(t)),
      s.season * 31 + role.length,
    );
    const pool = Object.values(s.coaches)
      .filter((c) => c.team === null && c.role === role)
      .sort((a, b) => coachQuality(b) - coachQuality(a));
    for (const team of needy) {
      const c = pool.shift();
      if (!c) break;
      const asking = coachPriorities(c).expectation;
      c.team = team;
      c.contract = { yearsRemaining: asking.years, annualValue: asking.baseSalary };
      fa.signed.push({
        id: c.id,
        toTeam: team,
        baseSalary: asking.baseSalary,
        signingBonus: asking.signingBonus,
        years: asking.years,
        guaranteed: asking.guaranteed,
        at: fa.day,
      });
    }
  }
}

export function offerFields(o: ContractOffer) {
  return {
    baseSalary: o.baseSalary,
    signingBonus: o.signingBonus,
    years: o.years,
    guaranteed: o.guaranteed,
  };
}
/**
 * Which competing offer wins (OQ-9): not just the highest dollar figure —
 * the subject's own stated top-3 priorities (`playerPriorities`/
 * `coachPriorities`, already computed for the negotiation-screen display,
 * previously never fed into the actual outcome) bend the decision toward an
 * offer that actually satisfies them. "location"/"market size" have no real
 * signal in this data model and are left neutral; the rest use data already
 * on hand: team overall (winning now / roster talent), positional need
 * (a starting role), and the real engine-backed computeSchemeFit (scheme
 * fit) — the same call CoachingStaffHub's live scheme-fit percentage uses.
 */
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function offerScore(o: ContractOffer, subject: Subject, subjectId: string, s: LeagueState): number {
  const dollar = o.baseSalary * o.years + o.signingBonus;
  const team = s.teams[o.teamCode];
  if (!team) return dollar;
  // Free Agency + Contracts optimization pass (free_agency.general_context):
  // each context term moves the score less per point, and the overall swing
  // it can produce is tighter (±0.22, down from ±0.3) — dollars still decide
  // most offers; context breaks the close ones.
  let bonus = 0;
  if (subject === "players") {
    const p = s.players[subjectId];
    if (p) {
      const ranked = playerPriorities(p).ranked;
      if (ranked.includes("winning now")) bonus += (team.ratings.overall - 75) / 60;
      if (ranked.includes("a starting role")) bonus += (positionalNeed(s, o.teamCode, p.position) - 10) / 120;
      if (ranked.includes("scheme fit")) {
        const oc = Object.values(s.coaches).find((c) => c.team === o.teamCode && c.role === "OC") ?? null;
        const dc = Object.values(s.coaches).find((c) => c.team === o.teamCode && c.role === "DC") ?? null;
        bonus += (sim.computeSchemeFit(p, oc, dc) - 62) / 180;
      }
    }
  } else {
    const c = s.coaches[subjectId];
    if (c) {
      const ranked = coachPriorities(c).ranked;
      if (ranked.includes("roster talent")) bonus += (team.ratings.rosterOverall - 75) / 60;
    }
  }
  return dollar * (1 + clamp(bonus, -0.22, 0.22));
}

export function bestOfferFor(fa: FreeAgencyState, subject: Subject, id: string, s: LeagueState): ContractOffer | null {
  const offers = fa.bids[id];
  if (!offers || offers.length === 0) return null;
  return [...offers].sort((a, b) => offerScore(b, subject, id, s) - offerScore(a, subject, id, s))[0]!;
}

/**
 * AI GM decision-making (OQ-9, docs/decisions.md in the engine repo): an AI
 * team's free-agency/coach-hiring behavior optimizes for its own roster's
 * competitiveness — filling actual needs, at a realistic price, with a
 * coach whose scheme fits the roster already in place — not for grabbing
 * the single highest-rated player/coach available, and not (as it was
 * before) a uniformly random team + a uniformly random dollar amount.
 */

export function aiControlledTeams(s: LeagueState): string[] {
  return Object.entries(s.teams)
    .filter(([, t]) => t.controlledBy.kind === "ai")
    .map(([code]) => code);
}

/** Weighted pick — `weights` need not sum to 1; falls back to uniform if all-zero. */
export function weightedPick<T>(rng: () => number, items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** The "starter-quality" bar `positionalNeed` measures the gap below. */
const STARTER_QUALITY_BAR = 77;
/** Stand-in "best at the position" when a team has nobody there at all. */
const EMPTY_POSITION_BASE = 42;
/** `positionalNeed` never reads as fully satisfied — there's always a little
 *  room to want an upgrade, so a maxed-out position never drops out of a
 *  weighted pick entirely. */
const MIN_RAW_NEED = 0.5;

/**
 * A flat need adjustment by position, on top of the roster gap.
 *
 * Independent of `POSITION_VALUE` (the draft-value premium a great player at
 * a position is worth) — this instead biases how urgently the AI treats
 * *needing* the position at all, most visibly at quarterback (proactively
 * seeks one even over a middling gap) and kicker/punter (needs to be truly
 * empty there before it registers as a real need).
 */
const POSITION_NEED_BONUS: Partial<Record<Position, number>> = {
  QB: 13,
  RB: 6,
  WR: 7,
  TE: 1,
  OT: 2,
  OG: 1,
  C: 1,
  EDGE: 3,
  DT: 3,
  ILB: 3,
  OLB: -6,
  CB: 5,
  S: 4,
  K: -9,
  P: -18,
};

/** How much a team needs help at `position` — bigger gap below a "starter-quality"
 *  bar (~77 overall) = more urgent; no one on the roster at all = most urgent. */
/**
 * Each team's picks so far in a rookie draft, as the prospects they are.
 *
 * A rookie pick is a draft-class prospect until the signing stage puts him
 * on a roster, so anything that reads need from `players` alone saw a team's
 * need as untouched by its own draft. Both the CPU and the "best fit"
 * suggestion then filled the same hole round after round: in one four-team
 * draft the Rams took four running backs, Pittsburgh five receivers and the
 * suggestion gave Green Bay five outside linebackers in seven rounds. The
 * public `collegeOverall` is what counts, never the hidden true rating.
 */
export function draftedThisDraft(s: LeagueState): Map<string, DraftProspect[]> {
  const out = new Map<string, DraftProspect[]>();
  const d = s.draft;
  if (!d || d.mode !== "rookie") return out;
  const byId = new Map(s.draftClass.map((p) => [p.id, p]));
  for (const r of d.results) {
    const p = r.selectedId ? byId.get(r.selectedId) : undefined;
    if (!p) continue;
    const list = out.get(r.teamCode);
    if (list) list.push(p);
    else out.set(r.teamCode, [p]);
  }
  return out;
}

/** `positionalNeed`, counting the team's own picks in a rookie draft still under way. */
export function draftAwareNeed(s: LeagueState, teamCode: string, position: Position): number {
  const picks = draftedThisDraft(s).get(teamCode) ?? [];
  const drafted = picks.filter((p) => p.position === position).reduce((m, p) => Math.max(m, p.collegeOverall), 0);
  const onRoster = Object.values(s.players)
    .filter((p) => p.nfl_team === teamCode && p.position === position && !p.retired)
    .reduce((max, p) => Math.max(max, p.overall), 0);
  const best = Math.max(onRoster, drafted);
  const raw = STARTER_QUALITY_BAR - (best || EMPTY_POSITION_BASE) + (POSITION_NEED_BONUS[position] ?? 0);
  return Math.max(MIN_RAW_NEED, raw);
}

/**
 * A pick who would not make the roster is a wasted pick.
 *
 * The need floor (`MIN_RAW_NEED`) never lets a stacked position drop out, so
 * a position's draft premium alone kept pulling the board toward it: CPU
 * teams took a fourth and fifth quarterback in a fantasy draft, and the
 * roster trim released every one of them before the summary screen — along
 * with any outside linebacker, a position with no roster spots at all. Once
 * a position holds its roster-template count, a candidate who is no better
 * than the worst man already there would be the one cut, so he carries this
 * penalty. One who is better is not wasted: he displaces the worst.
 *
 * `carried` is every rating the team holds at the position, any order.
 */
const SURPLUS_PENALTY = 25;
export function surplusPenalty(position: Position, carried: readonly number[], value: number): number {
  return surplusPenalties(() => carried)(position, value);
}

/** `surplusPenalty` for one team at one pick, with each position's cut line found once. */
function surplusPenalties(carriedAt: (pos: Position) => readonly number[]): (pos: Position, value: number) => number {
  const cutLines = new Map<Position, number>();
  return (pos, value) => {
    let line = cutLines.get(pos);
    if (line === undefined) {
      const count = ROSTER_TEMPLATE.find((r) => r.pos === pos)?.count ?? 0;
      const carried = carriedAt(pos);
      line =
        carried.length < count
          ? -Infinity
          : count === 0
            ? Infinity
            : [...carried].sort((a, b) => b - a)[count - 1]!;
      cutLines.set(pos, line);
    }
    return value <= line ? SURPLUS_PENALTY : 0;
  };
}


export function positionalNeed(s: LeagueState, teamCode: string, position: Position): number {
  const best = Object.values(s.players)
    .filter((p) => p.nfl_team === teamCode && p.position === position && !p.retired)
    .reduce((max, p) => Math.max(max, p.overall), 0);
  const raw = STARTER_QUALITY_BAR - (best || EMPTY_POSITION_BASE) + (POSITION_NEED_BONUS[position] ?? 0);
  return Math.max(MIN_RAW_NEED, raw);
}

/** Teams with at least `needed` ($M) of cap room — falls back to every AI
 *  team if literally none qualify, rather than deadlocking the market (a
 *  real front office would restructure/cut to create room; that maneuver
 *  isn't modeled, so this is the honest stand-in). */
export function affordableTeams(s: LeagueState, needed: number): string[] {
  const all = aiControlledTeams(s);
  const can = all.filter((code) => {
    const t = s.teams[code]!;
    return t.cap.total - t.cap.used >= needed;
  });
  return can.length > 0 ? can : all;
}

// Free Agency + Contracts optimization pass (free_agency.standing_ai_offer):
// a narrower market-noise band, a stronger pull toward genuine need, a
// signing bonus that can't dwarf the base salary it rides on, and a lower
// guaranteed-money band.
export function aiOfferForPlayer(rng: () => number, s: LeagueState, p: Player): ContractOffer {
  // real value (overall-driven), with market noise so it isn't a single fixed number
  const base = Math.round(contractValueFor(p.overall, p.position) * (0.95 + rng() * 0.2) * 10) / 10;
  const candidates = affordableTeams(s, base);
  // AI GM season strategy (§7): the target-ranking score gets the same
  // bounded preference terms as the draft, folded into the need-based weight
  // as a multiplier so it can never turn a team's real need negative or hand
  // strategy a bigger say than the base evaluator has. No strategy changes
  // the price, the cap check, or which teams can afford to bid at all.
  const weights = candidates.map((code) => {
    const strategy = strategyFor(code, s.season);
    // AI Difficulty (§13.1): need-awareness scales the shared need term
    // before strategy ever sees it, and deterministic noise sits alongside
    // strategy's bounded adjustment — same cap deal, same asking price,
    // just a less accurate read of which team needs this player most.
    const difficulty = difficultyProfile(s.config.difficulty);
    const raw = positionalNeed(s, code, p.position) * difficulty.needAwareness;
    const noise =
      difficulty.evaluationNoise === 0
        ? 0
        : deterministicNoiseUnit(code, s.season, "fa_target", p.id) * difficulty.evaluationNoise;
    const adj =
      strategyPositionBonus(strategy, p.position) +
      strategyAgeBonus(strategy, p.age) +
      strategyEliteBonus(strategy, p.overall) +
      strategyNeedAdjustment(strategy, raw) +
      noise;
    return raw ** 1.4 * clamp(1 + adj / 20, 0.5, 2);
  });
  const teamCode = weightedPick(rng, candidates, weights) ?? candidates[0] ?? "FA";
  const years = 1 + Math.floor(rng() * 4);
  return {
    teamCode,
    baseSalary: base,
    signingBonus: Math.round(base * rng() * 1.0 * 10) / 10,
    years,
    guaranteed: Math.round(base * years * (0.4 + rng() * 0.25) * 10) / 10,
  };
}

// mirrors nfl-franchise-sim/src/engine/staff.ts's OFF_SCHEME_TAGS/DEF_SCHEME_TAGS
// (also duplicated in HybridSimulationService.ts for computeSchemeFit) — see
// that file's comment for why this stays a small inline table rather than a
// cross-project import.
const OFF_SCHEME_TAGS: Record<string, readonly string[]> = {
  west_coast: ["west_coast", "play_action", "move_te", "zone_run", "outside_zone"],
  vertical: ["vertical", "spread", "play_action", "downhill"],
  spread: ["spread", "rpo", "zone_run", "outside_zone", "west_coast"],
  power_run: ["power_run", "gap_scheme", "inline", "downhill", "pass_pro"],
  zone_run: ["zone_run", "outside_zone", "west_coast", "move_te"],
  pro_style: ["play_action", "inline", "move_te", "power_run", "west_coast"],
};
const DEF_SCHEME_TAGS: Record<string, readonly string[]> = {
  four_three: ["base_4_3", "one_gap", "penetrate", "attack", "wide_9"],
  three_four: ["base_3_4", "two_gap", "contain", "nose"],
  multiple: ["nickel", "cover_3", "split_safety", "robber", "move_te"],
  cover_3: ["cover_3", "single_high", "zone", "robber"],
  cover_2: ["cover_2", "split_safety", "zone"],
  man_press: ["man_press", "cover_man", "cover_1", "nickel"],
};

/** Fraction of `teamCode`'s active roster whose scheme_tags overlap `scheme`'s tags. */
export function rosterSchemeFit(s: LeagueState, teamCode: string, role: "OC" | "DC", scheme: string | undefined): number {
  if (!scheme) return 0;
  const table = role === "OC" ? OFF_SCHEME_TAGS : DEF_SCHEME_TAGS;
  const want = new Set(table[scheme] ?? []);
  if (want.size === 0) return 0;
  const roster = Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired);
  if (roster.length === 0) return 0;
  const fit = roster.filter((p) => p.scheme_tags.some((t) => want.has(t))).length;
  return fit / roster.length;
}

export function aiOfferForCoach(rng: () => number, s: LeagueState, c: Coach): ContractOffer | null {
  const skill = c.role === "HC" ? (c.gameManagement ?? 50) : (c.playCallIq ?? 50);
  const base = Math.round(contractValueFor(skill) * (0.8 + rng() * 0.4) * 10) / 10;
  // only teams with an actual vacancy at this role — and enough cap room —
  // are real candidates. Hiring into an already-filled role isn't
  // optimizing for anything; coach salaries count against the same cap.
  const vacant = aiControlledTeams(s).filter(
    (code) => !Object.values(s.coaches).some((o) => o.team === code && o.role === c.role),
  );
  const affordable = new Set(affordableTeams(s, base));
  const candidates = vacant.filter((code) => affordable.has(code));
  const pool = candidates.length > 0 ? candidates : vacant;
  if (pool.length === 0) return null;
  const weights = pool.map((code) => {
    const strategy = strategyFor(code, s.season);
    // §6: the same bounded role bonus the coaching draft uses, folded into
    // the hiring weight the same way a position bonus folds into free agency.
    const roleAdj = 1 + clamp(strategyCoachBonus(strategy, c.role) / 8, -0.4, 0.4);
    // Scheme fit only means something for the two coordinators — a head
    // coach has no scheme, and the nine development coaches work between
    // seasons rather than on the field.
    if (c.role !== "OC" && c.role !== "DC") return roleAdj;
    const fit = rosterSchemeFit(s, code, c.role, c.scheme);
    return (1 + fit * 3) * roleAdj; // a well-fitting scheme is preferred, not required
  });
  const teamCode = weightedPick(rng, pool, weights) ?? pool[0]!;
  const years = 1 + Math.floor(rng() * 4);
  return {
    teamCode,
    baseSalary: base,
    signingBonus: Math.round(base * rng() * 1.5 * 10) / 10,
    years,
    guaranteed: Math.round(base * years * (0.3 + rng() * 0.4) * 10) / 10,
  };
}
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function openStandingMarketFromUndrafted(s: LeagueState): void {
  const taken = new Set(s.draft?.results.map((r) => r.selectedId) ?? []);
  const undrafted = Object.values(s.players).filter(
    (p) => !p.retired && !taken.has(p.id),
  );
  s.standingFreeAgents = undrafted.map((p) => p.id);
  for (const p of undrafted) {
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
  }
}

/**
 * Signs every draft pick the AI teams made.
 *
 * Only the viewer's picks were ever signed: the Rookie Signings screen is the
 * human's, and nothing did the same for the other 31 teams. So each year 217
 * drafted players simply vanished and the league never got any younger. Over
 * five seasons the average age climbed 27.5 -> 31.1, the median overall fell
 * 70 -> 65, and free agency drained from 358 players to 214 — a league quietly
 * ageing to death while its draft classes evaporated.
 */
export function signAiDraftPicks(s: LeagueState): void {
  const humanTeams = new Set(s.gms.filter((g) => g.isHuman).map((g) => g.teamCode));
  for (const r of s.draft?.results ?? []) {
    if (!r.selectedId || humanTeams.has(r.teamCode)) continue;
    if (s.rookieOutcomes[r.selectedId]) continue;
    upsertRookiePlayer(s, r.selectedId, r.teamCode, r.round, false);
    s.rookieOutcomes[r.selectedId] = "signed";
  }
}

/**
 * Every prospect nobody drafted becomes a free agent.
 *
 * The class used to be exactly one prospect per pick, so there were no
 * undrafted rookies at all — and in a small league most of the class was
 * simply thrown away. With ~400 players leaving the league a year and 224
 * arriving, the pool shrank until the preseason fill was inventing
 * replacement-level depth players, and a ten-season league fell from 55
 * players rated 90+ to 4. Undrafted rookies are how a real league refills
 * its bottom of the roster; here they reach the market before free agency
 * opens, carrying their true ratings (the college grade stays a scouting
 * number) and a real skill profile.
 */
export function signUndraftedAsFreeAgents(s: LeagueState): number {
  const taken = new Set((s.draft?.results ?? []).map((r) => r.selectedId));
  let n = 0;
  for (const pr of s.draftClass) {
    if (taken.has(pr.id) || s.players[`p_rookie_${pr.id}`]) continue;
    upsertRookiePlayer(s, pr.id, "FA", 0, true);
    n++;
  }
  return n;
}

export function upsertRookiePlayer(
  s: LeagueState,
  prospectId: string,
  teamCode: string,
  round: number,
  released: boolean,
): void {
  const pr = s.draftClass.find((d) => d.id === prospectId)!;
  const slot = Math.max(0.9, 8 - round);
  const id = `p_rookie_${prospectId}`;
  // A rookie's skills, shaped like a real player's of his (true) overall —
  // he used to arrive with speed/strength/awareness only, so the engine's
  // rating families and synergy could not tell a great one from a bust.
  // Seeded by the prospect, so every machine builds the same rookie.
  const rng = new Rng(fnv(prospectId));
  const attributes = fittedAttributes(pr.position, pr.trueOverall, () => rng.normal(0, 1));
  s.players[id] = {
    id,
    name: pr.name,
    position: pr.position,
    age: pr.age,
    nfl_team: released ? "FA" : teamCode,
    years_pro: 0,
    overall: pr.trueOverall,
    attributes,
    scheme_tags: [],
    dev_age_threshold: pr.age + 3,
    decline_age_threshold: pr.age + 10,
    injury_history: [],
    contract: released
      ? null
      : {
          team_id: teamCode,
          years_remaining: 4,
          total_value: slot * 4,
          guaranteed: slot * 4,
          cap_hit_by_year: [slot, slot * 1.05, slot * 1.1, slot * 1.15],
          signing_bonus: slot,
        },
    free_agent: released,
    injury_status: null,
    retired: false,
    retirement_status: "active",
    draft_info: { round, pick: 0, class_year: s.season },
    college: pr.school,
    season_stats: { gamesPlayed: 0 },
  };
  if (released && !s.standingFreeAgents.includes(id)) s.standingFreeAgents.push(id);
}

/**
 * Actually retires the players RetirementReview.tsx showed as "retiring" —
 * same seed (`s.season`) and same `!p.retired` filter/order that screen
 * uses, so `sim.retirementOutcomes` replays the identical decision instead
 * of drawing fresh random outcomes at commit time.
 */
export function commitRetirements(s: LeagueState): void {
  const outcomes = sim.retirementOutcomes(
    s.season,
    Object.values(s.players).filter((p) => !p.retired),
  );
  for (const o of outcomes) {
    if (o.decision !== "retiring") continue;
    const p = s.players[o.playerId];
    if (!p) continue;
    p.retired = true;
    p.retirement_status = "retiring";
    p.retired_season = s.season;
  }
}

/**
 * Cap-room gate for signing a standing free agent (the human-side follow-up
 * to OQ-9's AI cap enforcement - `affordableTeams`/`aiOfferForPlayer` were
 * already gated, this action wasn't). Read-only: never mutates `s`, so it's
 * safe to call from the action just to preview the result before committing.
 */
/**
 * Sign or release a drafted rookie.
 *
 * Lived in the store as a local mutation, which meant that online it was not
 * a league action at all: a GM signed their first-rounder, the server never
 * heard about it, and the next frame from the league replaced the answer with
 * one where the pick was still unresolved. Same shape as the draft and the
 * two markets — the decision is league state, so the league has to own it.
 */
export function checkRookieOutcome(
  s: LeagueState,
  prospectId: string,
  teamCode: string,
): { ok: boolean; reason?: string } {
  const pr = s.draftClass.find((d) => d.id === prospectId);
  if (!pr) return { ok: false, reason: "No such prospect." };
  if (s.rookieOutcomes[prospectId]) return { ok: false, reason: "That pick is already settled." };
  const pick = s.draft?.results.find((r) => r.selectedId === prospectId);
  if (pick && pick.teamCode !== teamCode) {
    return { ok: false, reason: "You didn't draft him." };
  }
  return { ok: true };
}

/** Applies it. Call `checkRookieOutcome` first; this assumes it passed. */
export function applyRookieOutcome(
  s: LeagueState,
  prospectId: string,
  teamCode: string,
  released: boolean,
): void {
  const round = s.draft?.results.find((r) => r.selectedId === prospectId)?.round ?? 4;
  upsertRookiePlayer(s, prospectId, teamCode, round, released);
  s.rookieOutcomes[prospectId] = released ? "released" : "signed";
  recomputeTeamRatings(s);
}

/**
 * Hire a coach who is out of work, straight away.
 *
 * The only way to change a coordinator used to be a five-day sealed-bid
 * window at a fixed point in the calendar. With the window gone that would
 * have left no way at all, so this is its asynchronous replacement: an open
 * coach, a role, and the job is yours. Whoever held the role is out of work
 * and back on the market, which is what happens when you replace a coach.
 *
 * Coaching salaries are not a player-cap charge (the cap in this game is the
 * player cap, as `recomputeTeamRatings` has always treated it), so there is
 * no room to check — the constraint is simply that the coach is available.
 */
export function checkCoachHire(
  s: LeagueState,
  coachId: string,
  teamCode: string,
): { ok: boolean; reason?: string } {
  const coach = s.coaches[coachId];
  if (!coach) return { ok: false, reason: "No such coach." };
  if (coach.team === teamCode) return { ok: false, reason: "He already works for you." };
  if (coach.team) return { ok: false, reason: `${coach.name} is under contract at ${coach.team}.` };
  if (!s.teams[teamCode]) return { ok: false, reason: "Unknown team." };
  return { ok: true };
}

/** Applies the hire. Call `checkCoachHire` first; this assumes it passed. */
export function applyCoachHire(s: LeagueState, coachId: string, teamCode: string): void {
  const coach = s.coaches[coachId];
  if (!coach) return;
  // the incumbent in that role is let go, and goes back on the market
  for (const other of Object.values(s.coaches)) {
    if (other.team === teamCode && other.role === coach.role && other.id !== coach.id) {
      other.team = null;
      other.contract = null;
    }
  }
  coach.team = teamCode;
  coach.contract ??= { yearsRemaining: 3, annualValue: 5 };
}

export function checkStandingSign(
  s: LeagueState,
  playerId: string,
  offer: ContractOffer,
): { ok: boolean; reason?: string } {
  const p = s.players[playerId];
  if (!p || !p.free_agent) return { ok: false, reason: "This player is no longer a free agent." };
  const team = s.teams[offer.teamCode];
  if (!team) return { ok: false, reason: "Unknown team." };
  const limit = rosterLimitFor(s.stage);
  if (rosterCountOf(s, offer.teamCode) >= limit) {
    return {
      ok: false,
      reason: `Your roster is full at ${limit}. Release a player on Roster & Cap to open a spot.`,
    };
  }
  const capHitYear1 = offerToContract(offer).cap_hit_by_year[0] ?? 0;
  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  if (capHitYear1 > room) {
    return {
      ok: false,
      reason: `Not enough cap space: this deal needs $${capHitYear1.toFixed(1)}M this year, you have $${room.toFixed(1)}M free.`,
    };
  }
  return { ok: true };
}

/**
 * How many players a team may carry right now. The 53-man limit is a
 * season rule; between the last game and the preseason gate a team may carry
 * the offseason ceiling, which is what makes the free-agency window playable
 * (see `OFFSEASON_ROSTER_SIZE`).
 */
export function rosterLimitFor(stage: Stage): number {
  return stage.startsWith("offseason") || stage.startsWith("endOfSeason")
    ? OFFSEASON_ROSTER_SIZE
    : ROSTER_SIZE;
}

/** Players currently counting against `teamCode`'s roster limit. */
export function rosterCountOf(s: LeagueState, teamCode: string): number {
  return Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired).length;
}

/**
 * The live free-agency window's equivalent of `checkStandingSign`.
 *
 * A bid isn't a signing, so nothing was charged when it was placed — which
 * meant a GM with $7M of room could sit on six $20M offers and wake up on day
 * 5 having won four of them and blown $80M past the cap. The gate the player
 * then hit was the preseason trim cutting their own roster back down.
 *
 * So outstanding bids are treated as committed money: a new offer has to fit
 * the room left after every other bid this team still has live. Coach bids
 * aren't checked — coaching salaries aren't a player-cap charge.
 */
export function checkBid(
  s: LeagueState,
  subject: Subject,
  targetId: string,
  offer: ContractOffer,
): { ok: boolean; reason?: string } {
  if (subject === "coaches") return { ok: true };
  const team = s.teams[offer.teamCode];
  const fa = s.freeAgency;
  if (!team || !fa) return { ok: true };

  const committed = Object.entries(fa.bids).reduce((sum, [id, list]) => {
    if (id === targetId) return sum; // this offer replaces that one
    if (fa.signed.some((x) => x.id === id)) return sum; // already resolved
    const mine = list.find((o) => o.teamCode === offer.teamCode);
    return mine ? sum + (offerToContract(mine).cap_hit_by_year[0] ?? 0) : sum;
  }, 0);

  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  const thisBid = offerToContract(offer).cap_hit_by_year[0] ?? 0;
  if (thisBid + committed > room) {
    const free = Math.round((room - committed) * 10) / 10;
    return {
      ok: false,
      reason:
        committed > 0
          ? `You have $${committed.toFixed(1)}M already tied up in open bids, leaving $${free.toFixed(1)}M. This offer needs $${thisBid.toFixed(1)}M.`
          : `Not enough cap space: this offer needs $${thisBid.toFixed(1)}M this year, you have $${room.toFixed(1)}M free.`,
    };
  }
  return { ok: true };
}

/**
 * Whether both sides can legally absorb a trade.
 *
 * `applyTrade` only ever swapped team codes, so a trade was a free way around
 * every gate the rest of the app enforces: a GM with $2M of room could take
 * back a $40M contract, and a three-for-one put a team over the roster limit
 * with nothing to say about it. The cap is the point of the franchise layer;
 * it can't be optional on the one screen that moves the most money.
 *
 * Read-only, so the Trade Proposal screen can preview the answer before the
 * player commits to a deal that would be refused.
 */
export function checkTrade(
  s: LeagueState,
  t: Pick<LeagueState["trades"][number], "fromTeam" | "toTeam" | "fromAssets" | "toAssets">,
): { ok: boolean; reason?: string } {
  const hitOf = (ids: string[]): number =>
    ids.reduce((n, id) => n + (s.players[id]?.contract?.cap_hit_by_year[0] ?? 0), 0);
  const idsOf = (assets: LeagueState["trades"][number]["fromAssets"]): string[] =>
    assets.filter((a) => a.kind === "player" && a.playerId).map((a) => a.playerId!);

  // exploit audit (trades, "stale asset" / ownership bypass): two trade
  // proposals can sit in `s.trades` at once, both listing the same player or
  // pick, before either resolves. `applyTrade` reassigns unconditionally —
  // without this check, resolving the second trade after the first already
  // moved the asset elsewhere silently reassigns him a second time, seizing
  // him from whoever legitimately received him in the first trade, with no
  // consent or cap check on that team's side at all. A trade whose assets
  // have moved since it was proposed is stale and refused outright, the same
  // way a stale re-sign attempt already is.
  for (const a of t.fromAssets) {
    if (a.kind === "player" && a.playerId && s.players[a.playerId]?.nfl_team !== t.fromTeam) {
      return { ok: false, reason: "That deal is stale — one of the players offered has already moved. Propose it again." };
    }
    if (a.kind === "pick" && a.pick) {
      const held = s.draftPicks?.[pickKey(a.pick.year, a.pick.round, a.pick.originalTeam)];
      if (held && held.ownedBy !== t.fromTeam) {
        return { ok: false, reason: "That deal is stale — one of the picks offered has already moved. Propose it again." };
      }
    }
  }
  for (const a of t.toAssets) {
    if (a.kind === "player" && a.playerId && s.players[a.playerId]?.nfl_team !== t.toTeam) {
      return { ok: false, reason: "That deal is stale — one of the players requested has already moved. Propose it again." };
    }
    if (a.kind === "pick" && a.pick) {
      const held = s.draftPicks?.[pickKey(a.pick.year, a.pick.round, a.pick.originalTeam)];
      if (held && held.ownedBy !== t.toTeam) {
        return { ok: false, reason: "That deal is stale — one of the picks requested has already moved. Propose it again." };
      }
    }
  }

  const out = idsOf(t.fromAssets); // leaving fromTeam
  const back = idsOf(t.toAssets); // leaving toTeam
  const limit = rosterLimitFor(s.stage);

  for (const [code, gains, loses] of [
    [t.fromTeam, back, out],
    [t.toTeam, out, back],
  ] as const) {
    const team = s.teams[code];
    if (!team) return { ok: false, reason: "Unknown team." };
    const name = TEAMS_BY_CODE[code]?.abbr ?? code;

    const size = rosterCountOf(s, code) - loses.length + gains.length;
    if (size > limit) {
      return {
        ok: false,
        reason: `${name} would carry ${size} players, over the ${limit}-man limit. Even the trade up, or release someone first.`,
      };
    }

    const used = Math.round((team.cap.used - hitOf(loses) + hitOf(gains)) * 10) / 10;
    if (used > team.cap.total) {
      const over = Math.round((used - team.cap.total) * 10) / 10;
      return {
        ok: false,
        reason: `${name} would be $${over.toFixed(1)}M over the cap. Send back more salary, or take back less.`,
      };
    }
  }
  return { ok: true };
}

export function applyTrade(s: LeagueState, t: LeagueState["trades"][number]): void {
  // a contract moves with the player: `team_id` used to keep pointing at the
  // team he just left
  const move = (assets: LeagueState["trades"][number]["fromAssets"], to: string): void => {
    for (const a of assets) {
      if (a.kind === "pick" && a.pick) {
        const held = s.draftPicks?.[pickKey(a.pick.year, a.pick.round, a.pick.originalTeam)];
        if (held) held.ownedBy = to;
        continue;
      }
      if (a.kind !== "player" || !a.playerId) continue;
      const p = s.players[a.playerId];
      if (!p) continue;
      p.nfl_team = to;
      if (p.contract) p.contract.team_id = to;
    }
  };
  move(t.fromAssets, t.toTeam);
  move(t.toAssets, t.fromTeam);
  recomputeTeamRatings(s);
}

export function sbWonByHuman(s: LeagueState): boolean {
  const champ = s.bracket?.matchups.find((m) => m.round === "SB")?.winner ?? s.bracket?.champion;
  if (!champ) return false;
  return s.gms.some((g) => g.isHuman && g.teamCode === champ);
}

export function finalizeSeason(s: LeagueState): void {
  if (s.history.some((h) => h.season === s.season)) return;
  // Only a season that was played. A new league rolls over from its opening
  // offseason into its first season without having played one, and
  // finalizing there took a year off every contract the fantasy draft had
  // just signed, wrote a 0-0 phantom season into history, and counted it
  // toward every human team's Hooded Figure losing streak.
  if (!s.games.some((g) => g.phase === "REG" && g.played)) return;
  s.history.push(...sim.finalizeSeasonOutcomes(s));
  // the CPU teams keep the players worth keeping before their deals run out
  resignAiCore(s);
  // and turn over the staffs that failed
  runCoachingCarousel(s);
  // the year has been played, so every contract is a year shorter — and the
  // ones that just ran out hit the market in time for this offseason's window
  expireContracts(s);
  recomputeTeamRatings(s);
  // Hooded Figure eligibility (§4): reads the history rows just pushed above,
  // so this has to run after them, not before.
  updateHoodedFigureStreaks(s);
}

/**
 * CPU teams re-sign the players they would be foolish to lose.
 *
 * Nothing did: every expiring contract on a CPU team went straight to the
 * market, stars included. Over ten seasons, 29 of the 31 first-round picks of
 * one class were gone from their teams the offseason their rookie deals ran
 * out, and rosters bled their best players every year. A real front office
 * extends its core before the market opens, and so do these — the starters
 * and the good depth at a position, young enough to be worth it, at the price
 * the player asks (`extensionAsk`, the same number a human is quoted), best
 * first, while next year's payroll leaves room for the draft class and the
 * depth fill. Human teams are never touched: that is the GM's call.
 */
const RESIGN_CAP_BUFFER = 18;
const ELITE_RESIGN_CAP_BUFFER = 6;
export function resignAiCore(s: LeagueState): number {
  let signed = 0;
  for (const code of Object.keys(s.teams)) {
    if (!isAiTeam(s, code)) continue;
    const team = s.teams[code]!;
    const roster = Object.values(s.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent && p.contract,
    );
    // what next season already costs: every deal that runs past this one
    let committed = roster.reduce(
      (n, p) => n + ((p.contract!.years_remaining ?? 0) >= 2 ? (p.contract!.cap_hit_by_year[1] ?? 0) : 0),
      0,
    );
    const rankAt = (p: Player): number =>
      roster.filter((x) => x.position === p.position && x.overall > p.overall).length;
    const expiring = roster
      .filter((p) => (p.contract!.years_remaining ?? 0) <= 1)
      .filter((p) => {
        const starters = ROSTER_TEMPLATE.find((r) => r.pos === p.position)?.starters ?? 0;
        const keeper = p.overall >= 80 || (p.overall >= 70 && rankAt(p) < starters + 1);
        const declining = p.age >= (p.decline_age_threshold ?? 32) + 1 && p.overall < 85;
        return keeper && !declining && starters > 0;
      })
      .sort((a, b) => draftValue(b.overall, b.position) - draftValue(a.overall, a.position));
    for (const p of expiring) {
      const ask = extensionAsk(p);
      // a franchise player is kept even when it squeezes the draft budget
      const buffer = p.overall >= 88 ? ELITE_RESIGN_CAP_BUFFER : RESIGN_CAP_BUFFER;
      if (committed + ask.baseSalary > team.cap.total - buffer) continue;
      // budgeted against next year's commitments above, not this year's
      // payroll — at season's end a third of that payroll is about to expire
      applyExtension(p, ask);
      committed += ask.baseSalary;
      signed++;
    }
  }
  return signed;
}

export function isInSeason(stage: Stage): boolean {
  return stage === "preseason" || stage === "regularSeason" || stage === "playoffs";
}

/**
 * Build the draft every GM will share.
 *
 * This used to live in the store, which meant the *screen* created the draft:
 * open the draft room, find no draft, make one locally. Single-player that is
 * merely lazy and works. Online it was the whole bug — the server advanced
 * into the fantasy draft with no draft on it, so each client built its own
 * private board from its own copy of the league, and the server rejected
 * every pick with "there's no draft running". The league could not be played
 * past the stage it had just been so careful to enter together.
 *
 * So the draft is made here, from the state alone and deterministically (the
 * shuffles are seeded on the season), and the server makes it at the moment
 * the stage opens. One order, made once, by the machine that owns the league.
 */
export function beginDraft(s: LeagueState, mode: DraftMode): void {
  // a GM who somehow reached the draft without a team contributes no
  // slot, rather than an empty string in the pick order
  const humanCodes = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
  const allCodes = Object.keys(s.teams);
  const aiCodes = allCodes.filter((c) => !humanCodes.includes(c));

  let fullFirstRound: string[];
  if (mode === "rookie") {
    // real NFL order: worst record picks first. Falls back to a shuffle
    // before any games have been played.
    const played = allCodes.some((c) => {
      const t = s.teams[c]!;
      return t.wins + t.losses + t.ties > 0;
    });
    const pct = (code: string): number => {
      const t = s.teams[code]!;
      const g = t.wins + t.losses + t.ties;
      return g === 0 ? 0.5 : (t.wins + 0.5 * t.ties) / g;
    };
    const diff = (code: string): number => {
      const t = s.teams[code]!;
      return t.pointsFor - t.pointsAgainst;
    };
    fullFirstRound = played
      ? [...allCodes].sort((a, b) => pct(a) - pct(b) || diff(a) - diff(b))
      : shuffle(allCodes, s.season + 11);
  } else if (s.config.draftOrder === "randomized") {
    // every team in the hat — not the humans first and the AI after,
    // which handed the human GMs the top picks of all 20 rounds
    fullFirstRound = shuffle(allCodes, s.season + 7);
  } else {
    // "in order": GM 1 first, GM 2 second, …, then the AI teams
    fullFirstRound = [...humanCodes, ...shuffle(aiCodes, s.season + 11)];
  }

  // `?? FANTASY_DRAFT_ROUNDS` rather than a bare read: a save written before
  // the round count was configurable has no such field, and a draft of
  // `undefined` rounds is an empty board.
  const rounds =
    mode === "fantasy" ? (s.config.fantasyDraftRounds ?? FANTASY_DRAFT_ROUNDS) : DRAFT_ROUNDS;
  let order: string[] = [];
  if (mode === "rookie") {
    // the slots are earned by record; who *uses* each one is whoever
    // owns that pick, which is the whole point of trading them
    ensureDraftPicks(s, s.season);
    order = pickOrderFor(s, s.season, fullFirstRound, rounds);
  } else {
    for (let r = 0; r < rounds; r++) {
      const seq =
        s.config.draftType === "snake" && r % 2 === 1
          ? [...fullFirstRound].reverse()
          : fullFirstRound;
      order.push(...seq);
    }
  }
  s.draft = {
    mode,
    year: s.season,
    order: s.config.draftType,
    pickOrder: order,
    currentPickIndex: 0,
    results: [],
    targetsByGm: Object.fromEntries(s.gms.filter((g) => g.isHuman).map((g) => [g.id, []])),
  };
}

/** FNV-1a, for seeding per-player generation from a stable id. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
