/**
 * Broadcast view of a single game — the render-ready structure behind the
 * in-game field visualisation (ball tracking + drive arrow), the play-by-play
 * (with cosmetic player attribution), and the injury interstitials.
 *
 * Built from the opt-in `playTrace` + `injuryLog`: the trace is grouped into
 * possessions (a run of plays by one team, ending on a change of possession, a
 * touchdown, a turnover, or a punt/field-goal attempt). The concatenation of
 * every drive's `plays`, in order, reproduces the original trace exactly — no
 * plays are dropped or reordered — so an injury's `playIndex` maps onto one
 * exact play, and a play's own `quarter` (which can change mid-drive, same as
 * real broadcasts) is enough for a consumer to detect quarter transitions by
 * walking the whole game front-to-back.
 *
 * Punts and field-goal attempts are their own trailing play on the drive that
 * produced them (call: "punt" | "field_goal") — same trace, no separate log.
 */

import type { InjuryEvent } from "./injury.js";
import { narratePlay, narrationText } from "./narration.js";
import {
  type ClockPlayEvent,
  type GameEvent,
  type GameStaff,
  type OvertimeStartEvent,
  type PenaltyEvent,
  type PlayRec,
  type ScoreEvent,
  simulateGame,
} from "./sim.js";

export interface BroadcastPlay {
  down: number;
  ydstogo: number;
  /** yards to the possessing team's target end zone, pre-snap. */
  ballOn: number;
  quarter: number;
  clock: string;
  call: PlayRec["call"];
  depth: string;
  gained: number;
  outcome: string;
  desc: string;
  firstDown: boolean;
  touchdown: boolean;
  turnover: boolean;
  /** cosmetic attribution — see `PlayRec`. */
  passer?: string | undefined;
  targetOrRusher?: string | undefined;
  defender?: string | undefined;
  /** who made the tackle on a run or a completed pass — cosmetic attribution, like the rest. */
  tackler?: string | undefined;
  /** kicker (field_goal) or punter (punt) — cosmetic attribution. */
  kicker?: string | undefined;
  /** punt returner, when the punt is fielded and run back — cosmetic attribution. */
  returner?: string | undefined;
  /** field_goal attempt distance, or punt gross distance, in yards. */
  distance?: number | undefined;
  /** injuries that happened on this exact play (almost always empty). */
  injuries: InjuryEvent[];
  /**
   * Scores this play caused, from the engine's own log: the touchdown and its
   * kick, a field goal, a safety, and — the point of it — a defence's
   * return touchdown, which the trace shows only as the turnover. Absent
   * when the play scored nothing.
   */
  scores?: ScoreEvent[];
  /**
   * Accepted penalties, spikes and kneel-downs between the previous snap and
   * this one. These plays are not in the trace, which is what explains a
   * change in down, distance or field position that no traced play produced.
   */
  eventsBefore?: (PenaltyEvent | ClockPlayEvent)[];
  /**
   * [home, away] once this play and anything it caused is over.
   *
   * The score a replay should be showing while this play is on screen. It is
   * *after* rather than before because a pick-six is traced as the
   * interception — the six points land after that record is written — and a
   * viewer watching the pick-six wants to see the seven go up, not on the
   * next snap.
   */
  scoreAfter: [number, number];
}

export interface BroadcastDrive {
  team: string;
  side: "home" | "away";
  quarter: number;
  startClock: string;
  /** yards to the target end zone at the first snap. */
  startBallOn: number;
  plays: BroadcastPlay[];
  /** how the drive ended — inferred from its last play. */
  ended: "touchdown" | "turnover" | "field_goal" | "missed_field_goal" | "punt" | "punt_return_td" | "stalled";
  /** points this team scored on the drive — measured, extra point included. */
  points: number;
  /**
   * Points the *other* team scored during this drive: a pick-six, a scoop-six,
   * a punt returned for a touchdown.
   *
   * This used to be invisible. `points` was hardcoded to 7 for a touchdown
   * and 3 for a made kick, so a drive that ended in a defensive touchdown read
   * as a turnover worth nothing and a seven-point swing vanished from the
   * drive chart entirely.
   */
  pointsAgainst: number;
}

export interface GameBroadcast {
  home: string;
  away: string;
  finalScore: [number, number];
  drives: BroadcastDrive[];
  /**
   * Indices into `drives` on which the scoreboard moved — including the
   * drives where it moved for the *other* team, which is exactly when a
   * viewer most wants the drive chart to say something.
   */
  scoringDrives: number[];
  /** every injury in the game, in play order (also attached to its own play). */
  injuries: InjuryEvent[];
  /** scores no traced play caused: a kickoff returned for a touchdown, and the kick after it. */
  returnScores?: ScoreEvent[];
}

/**
 * Group the flat trace into possessions; attach each injury to its exact play.
 *
 * `finalScore` closes the last play's running score: every other play's
 * `scoreAfter` is the *next* play's `scoreBefore`, which catches the points
 * that land between two traced records — a pick-six, a scoop-six, a punt
 * taken back, a kickoff return.
 */
function toDrives(
  trace: PlayRec[],
  injuries: InjuryEvent[],
  home: string,
  away: string,
  finalScore: readonly [number, number],
  log: readonly GameEvent[] = [],
): BroadcastDrive[] {
  // what the engine logged, filed under the play it belongs to
  const scoresAt = new Map<number, ScoreEvent[]>();
  const beforeAt = new Map<number, (PenaltyEvent | ClockPlayEvent)[]>();
  const otStarts: OvertimeStartEvent[] = [];
  for (const e of log) {
    if (e.type === "overtime_start") {
      otStarts.push(e);
    } else if (e.type === "score") {
      if (e.playIndex === null) continue;
      scoresAt.set(e.playIndex, [...(scoresAt.get(e.playIndex) ?? []), e]);
    } else {
      beforeAt.set(e.beforePlayIndex, [...(beforeAt.get(e.beforePlayIndex) ?? []), e]);
    }
  }
  const byPlayIndex = new Map<number, InjuryEvent[]>();
  injuries.forEach((e) => {
    if (e.playIndex === undefined) return;
    const list = byPlayIndex.get(e.playIndex) ?? [];
    list.push(e);
    byPlayIndex.set(e.playIndex, list);
  });

  const drives: BroadcastDrive[] = [];
  let cur: BroadcastDrive | null = null;
  trace.forEach((r, i) => {
    // Overtime isn't in the trace's own quarter labels (see `OvertimeStartEvent`)
    const ot = otStarts.filter((o) => o.beforePlayIndex <= i).at(-1);
    const quarter = ot ? 4 + ot.period : r.quarter;
    // A kickoff separates possessions even when the same team gets the ball
    // again: the one that opens the second half, and each overtime period. The
    // trace has no kickoff rows — without this a team that scored at the end of
    // a half had its next possession glued onto the last one, with a
    // field-position jump nothing explained.
    const prev = trace[i - 1];
    const kickedOff =
      prev !== undefined &&
      ((r.quarter === 3 && prev.quarter === 2) || otStarts.some((o) => o.beforePlayIndex === i));
    if (!cur || kickedOff || cur.side !== (r.team === 0 ? "home" : "away")) {
      cur = {
        team: r.team === 0 ? home : away,
        side: r.team === 0 ? "home" : "away",
        quarter,
        startClock: r.clock,
        startBallOn: r.ballOn,
        plays: [],
        ended: "stalled",
        points: 0,
        pointsAgainst: 0,
      };
      drives.push(cur);
    }
    cur.plays.push({
      down: r.down,
      ydstogo: r.ydstogo,
      ballOn: r.ballOn,
      quarter,
      clock: r.clock,
      call: r.call,
      depth: r.depth,
      gained: r.gained,
      outcome: r.outcome,
      desc: narrationText(narratePlay({ ...r, quarter, scores: scoresAt.get(i) })),
      firstDown: r.firstDown,
      touchdown: r.touchdown,
      turnover: r.turnover,
      passer: r.passer,
      targetOrRusher: r.targetOrRusher,
      defender: r.defender,
      tackler: r.tackler,
      kicker: r.kicker,
      returner: r.returner,
      distance: r.distance,
      injuries: byPlayIndex.get(i) ?? [],
      ...(scoresAt.has(i) ? { scores: scoresAt.get(i)! } : {}),
      ...(beforeAt.has(i) ? { eventsBefore: beforeAt.get(i)! } : {}),
      // filled in below, once we know what the next snap saw
      scoreAfter: [0, 0],
    });
    if (r.call === "field_goal") {
      cur.ended = r.outcome === "made" ? "field_goal" : "missed_field_goal";
      cur = null;
    } else if (r.call === "punt") {
      cur.ended = r.outcome === "return_td" ? "punt_return_td" : "punt";
      cur = null;
    } else if (r.touchdown) {
      cur.ended = "touchdown";
      cur = null;
    } else if (r.turnover) {
      cur.ended = "turnover";
      cur = null;
    }
  });

  // running score, then each drive's swing measured off it rather than
  // assumed — an extra point can miss, and a defensive touchdown belongs to
  // the team that didn't have the ball
  const flat = drives.flatMap((d) => d.plays);
  flat.forEach((p, i) => {
    p.scoreAfter = i + 1 < flat.length ? [...trace[i + 1]!.scoreBefore] : [finalScore[0], finalScore[1]];
  });
  let cursor = 0;
  for (const d of drives) {
    const before = trace[cursor]?.scoreBefore ?? [0, 0];
    cursor += d.plays.length;
    const after = d.plays.at(-1)?.scoreAfter ?? before;
    const mine = d.side === "home" ? 0 : 1;
    d.points = Math.max(0, after[mine]! - before[mine]!);
    d.pointsAgainst = Math.max(0, after[1 - mine]! - before[1 - mine]!);
  }
  return drives;
}

/**
 * Sim a game with the trace + injuries on and package it for a broadcast view.
 * Deterministic in `seed`. `drives` covers the *whole* game, in order —
 * `scoringDrives` is just a convenience index into it.
 */
export function broadcastGame(
  seed: number,
  home: string,
  away: string,
  opts: GameStaff = {},
): GameBroadcast {
  const g = simulateGame(seed, home, away, { ...opts, trace: true, injuries: true });
  const injuries = g.injuryLog ?? [];
  const log = g.eventLog ?? [];
  const drives = toDrives(g.playTrace ?? [], injuries, home, away, [g.score[0], g.score[1]], log);
  const returnScores = log.filter((e): e is ScoreEvent => e.type === "score" && e.playIndex === null);
  return {
    home,
    away,
    finalScore: [g.score[0], g.score[1]],
    drives,
    scoringDrives: drives.flatMap((d, i) => (d.points > 0 || d.pointsAgainst > 0 ? [i] : [])),
    injuries,
    ...(returnScores.length ? { returnScores } : {}),
  };
}
