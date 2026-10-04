/**
 * Injuries, from the game that caused them to the roster that carries them.
 *
 * The engine has simulated injuries all along (`injuries: true` on every game
 * the adapter runs) but only the viewer's game carried them back, buried in
 * its broadcast. Nothing ever wrote one onto a player, so the hub's Injuries
 * tab read "No injuries reported" for an entire dynasty, `injury_history`
 * never grew, and `injuryAgeReduction` — the part of the retirement model that
 * exists to shorten a battered career — had nothing to work with.
 */
import { INJURY_HISTORY_KEPT } from "./saveCompaction.ts";
import type { GameResult, InjuryEvent, InjuryHistoryEntry, InjuryStatus, LeagueState, Player } from "@/domain";

import { recoveryScaleFor } from "./coachEffects.ts";

/** Weeks a severity costs, when the event doesn't project a range itself. */
const FALLBACK_WEEKS: Record<string, [number, number]> = {
  minor: [1, 1],
  moderate: [2, 4],
  significant: [4, 8],
  severe: [8, 14],
  season: [17, 17],
};

/** The engine's severities, mapped to the vocabulary `injury_history` uses. */
function historySeverity(severity: string): string {
  return severity === "severe" || severity === "season" ? "significant" : severity;
}

function weeksFor(ev: InjuryEvent): [number, number] {
  const projected = ev.projectedWeeks;
  if (Array.isArray(projected) && Number.isFinite(projected[0]) && Number.isFinite(projected[1])) {
    return [projected[0], projected[1]];
  }
  return FALLBACK_WEEKS[ev.severity] ?? [1, 2];
}

/** The status word the hub colours by, from how long he's out. */
function statusFor(weeks: number): Player["injury_status"] extends null ? never : "questionable" | "doubtful" | "out" {
  if (weeks <= 1) return "questionable";
  if (weeks <= 2) return "doubtful";
  return "out";
}

/**
 * Writes a week's injuries onto the players who suffered them.
 *
 * A player already hurt keeps whichever injury is worse — a knock in week 3
 * shouldn't shorten a broken leg from week 2.
 */
export function applyInjuries(state: LeagueState, results: GameResult[], season: number): void {
  for (const game of results) {
    for (const ev of game.injuries ?? []) {
      const p = state.players[ev.playerId];
      if (!p || p.retired) continue;
      // Change 3: the training room scales how long this keeps him out. It
      // never changes whether he got hurt — the engine decided that, and a
      // medical staff that prevented injuries would be doing a different job
      // — only the recovery the engine generated. Scaled at the moment the
      // injury is recorded rather than while healing, so the timeline a GM is
      // shown on day one is the one that actually plays out.
      const scale = p.nfl_team ? recoveryScaleFor(state, p.nfl_team) : 1;
      const [rawLo, rawHi] = weeksFor(ev);
      const lo = Math.max(1, Math.round(rawLo * scale));
      const hi = Math.max(lo, Math.round(rawHi * scale));
      const out = Math.max(1, Math.round((lo + hi) / 2));
      const already = p.injury_status?.weeks_out_est?.[1] ?? 0;
      if (out < already) continue;
      p.injury_status = {
        status: statusFor(out),
        weeks_out_est: [lo, hi],
        description: ev.bodyPart || ev.suspectedType || "undisclosed",
      };
      p.injury_history = [
        ...(p.injury_history ?? []).slice(-(INJURY_HISTORY_KEPT - 1)),
        {
          season,
          type: ev.suspectedType || ev.bodyPart || "undisclosed",
          severity: historySeverity(ev.severity),
          weeks_out: out,
        },
      ];
    }
  }
}

/**
 * A week goes by. Everyone hurt gets a week closer, and whoever has run out
 * of weeks is back.
 */
export function healOneWeek(state: LeagueState): void {
  for (const p of Object.values(state.players)) {
    const inj = p.injury_status;
    if (!inj) continue;
    const [lo, hi] = inj.weeks_out_est ?? [0, 0];
    const nextHi = hi - 1;
    if (nextHi <= 0) {
      p.injury_status = null;
      continue;
    }
    p.injury_status = {
      ...inj,
      status: statusFor(nextHi),
      // still out means still at least a week out — a range starting at 0
      // reads as "might play", which is what `questionable` already says
      weeks_out_est: [Math.max(1, Math.min(lo - 1, nextHi)), nextHi],
    };
  }
}

/** Everyone starts a new season healthy; an offseason is longer than any injury. */
export function clearInjuries(state: LeagueState): void {
  for (const p of Object.values(state.players)) p.injury_status = null;
}

/**
 * The roster to hand the simulator: the healthy players, except that a
 * position stripped bare sends its injured man out anyway. The engine builds
 * its depth chart from whatever it is given, and a team with no quarterback
 * on the sheet is a crash, not a hardship.
 */
export function availableRoster(roster: Player[]): Player[] {
  // a holdout isn't hurt, but he isn't playing either
  const healthy = roster.filter(
    (p) => (!p.injury_status || p.injury_status.status !== "out") && p.holdout !== p.nfl_team,
  );
  const covered = new Set(healthy.map((p) => p.position));
  const playingHurt = roster.filter((p) => !covered.has(p.position));
  if (playingHurt.length === 0) return healthy;
  // the least-hurt man at each uncovered position suits up
  const bySpot = new Map<string, Player>();
  for (const p of playingHurt) {
    const cur = bySpot.get(p.position);
    const weeks = (x: Player) => x.injury_status?.weeks_out_est?.[1] ?? 0;
    if (!cur || weeks(p) < weeks(cur)) bySpot.set(p.position, p);
  }
  return [...healthy, ...bySpot.values()];
}

/**
 * Injured reserve.
 *
 * During the season a player expected to miss at least four weeks goes on
 * IR: he stops counting against the 53-man limit and the positional minimums
 * (his salary still counts against the cap, as it does in the NFL), so a
 * team can sign someone to play in his place. Before this a torn ACL held a
 * roster spot all year and a GM had to cut a healthy player to replace him.
 */
export const IR_WEEKS = 4;
const SEASON_STAGES = new Set([
  "preseason",
  "regularSeason",
  "tradeDeadline",
  "tradeDeadlineSummary",
  "midseasonFreeAgency",
  "midseasonFreeAgencySummary",
  "midseasonDepthChart",
  "leagueDevelopments",
  "playoffs",
]);

export function onInjuredReserve(p: Player, stage: string): boolean {
  return SEASON_STAGES.has(stage) && (p.injury_status?.weeks_out_est?.[0] ?? 0) >= IR_WEEKS;
}

/**
 * The league's injury report as it stood when a block was simulated —
 * server-only, like `statLedger`. A block applies every week's injuries and
 * healing up front, so a GM who hadn't watched a single preseason game saw
 * "Out 3–8 wks" for a player hurt in one of them.
 */
export interface InjuryLedger {
  phase: "PRE" | "REG";
  fromWeek: number;
  start: Record<string, { status: InjuryStatus | null; history: InjuryHistoryEntry[] }>;
}

/** Record the injury report at the start of a block. */
export function snapshotInjuries(state: LeagueState, phase: "PRE" | "REG", fromWeek: number): void {
  const start: InjuryLedger["start"] = {};
  for (const p of Object.values(state.players)) {
    if (p.injury_status || p.injury_history?.length) {
      start[p.id] = { status: p.injury_status, history: [...(p.injury_history ?? [])] };
    }
  }
  state.injuryLedger = { phase, fromWeek, start };
}

/**
 * The injury report as of `throughWeek`: back to the block's start, then the
 * watched weeks replayed in the block's own order (injuries, then a week of
 * healing). Nothing to do once every week of the block has been watched.
 */
export function rewindInjuries(state: LeagueState, throughWeek: number): void {
  const l = state.injuryLedger;
  if (!l) return;
  const blockWeeks = state.games.filter((g) => g.phase === l.phase && g.week >= l.fromWeek).map((g) => g.week);
  const lastWeek = blockWeeks.length ? Math.max(...blockWeeks) : l.fromWeek - 1;
  if (throughWeek >= lastWeek) return;
  for (const p of Object.values(state.players)) {
    const st = l.start[p.id];
    p.injury_status = st?.status ?? null;
    p.injury_history = st ? [...st.history] : [];
  }
  for (let w = l.fromWeek; w <= throughWeek; w++) {
    const results = state.games.filter((g) => g.phase === l.phase && g.week === w && g.played);
    if (results.length === 0) continue;
    applyInjuries(state, results, state.season);
    healOneWeek(state);
  }
}
