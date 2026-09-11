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
import { type GameStaff, type PlayRec, simulateGame } from "./sim.js";

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
  /** kicker (field_goal) or punter (punt) — cosmetic attribution. */
  kicker?: string | undefined;
  /** punt returner, when the punt is fielded and run back — cosmetic attribution. */
  returner?: string | undefined;
  /** field_goal attempt distance, or punt gross distance, in yards. */
  distance?: number | undefined;
  /** injuries that happened on this exact play (almost always empty). */
  injuries: InjuryEvent[];
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
  points: number;
}

export interface GameBroadcast {
  home: string;
  away: string;
  finalScore: [number, number];
  drives: BroadcastDrive[];
  /** indices into `drives` that put points on the board (touchdown or made field goal). */
  scoringDrives: number[];
  /** every injury in the game, in play order (also attached to its own play). */
  injuries: InjuryEvent[];
}

const yardLabel = (ballOn: number): string => {
  if (Math.abs(ballOn - 50) < 0.5) return "midfield";
  const yd = Math.round(ballOn > 50 ? 100 - ballOn : ballOn);
  return `${ballOn > 50 ? "own" : "opp"} ${yd}`;
};

function describe(p: {
  call: PlayRec["call"];
  depth: string;
  gained: number;
  ballOn: number;
  outcome: string;
  touchdown: boolean;
  turnover: boolean;
  firstDown: boolean;
  distance?: number | undefined;
}): string {
  const g = Math.round(p.gained);
  const to = p.touchdown ? "end zone" : yardLabel(Math.max(1, p.ballOn - p.gained));
  if (p.call === "field_goal") {
    return p.outcome === "made" ? `${p.distance}-yard field goal is GOOD` : `${p.distance}-yard field goal attempt is NO GOOD`;
  }
  if (p.call === "punt") {
    if (p.outcome === "touchback") return `${p.distance}-yard punt, touchback`;
    if (p.outcome === "return_td") return `${p.distance}-yard punt, returned for a TOUCHDOWN`;
    if (p.outcome === "downed") return `${p.distance}-yard punt, downed at the ${yardLabel(100 - p.ballOn + p.gained)}`;
    return `${p.distance}-yard punt, returned to the ${yardLabel(100 - p.ballOn + p.gained)}`;
  }
  let s: string;
  if (p.call === "sack") s = `sack for ${g} to the ${to}`;
  else if (p.call === "scramble") s = `scramble for ${g >= 0 ? "+" : ""}${g} to the ${to}`;
  else if (p.call === "run") s = `run for ${g >= 0 ? "+" : ""}${g} to the ${to}`;
  else if (p.turnover) s = "pass intercepted";
  else if (g === 0 && !p.touchdown) s = `pass incomplete (${p.depth.toLowerCase().replace("_", " ")})`;
  else s = `pass complete for ${g} to the ${to}`;
  if (p.touchdown) s += " — TOUCHDOWN";
  else if (p.firstDown) s += " (1st down)";
  else if (p.turnover && p.call !== "sack") s += " — TURNOVER";
  return s;
}

/** Group the flat trace into possessions; attach each injury to its exact play. */
function toDrives(trace: PlayRec[], injuries: InjuryEvent[], home: string, away: string): BroadcastDrive[] {
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
    if (!cur || cur.side !== (r.team === 0 ? "home" : "away")) {
      cur = {
        team: r.team === 0 ? home : away,
        side: r.team === 0 ? "home" : "away",
        quarter: r.quarter,
        startClock: r.clock,
        startBallOn: r.ballOn,
        plays: [],
        ended: "stalled",
        points: 0,
      };
      drives.push(cur);
    }
    cur.plays.push({
      down: r.down,
      ydstogo: r.ydstogo,
      ballOn: r.ballOn,
      quarter: r.quarter,
      clock: r.clock,
      call: r.call,
      depth: r.depth,
      gained: r.gained,
      outcome: r.outcome,
      desc: describe(r),
      firstDown: r.firstDown,
      touchdown: r.touchdown,
      turnover: r.turnover,
      passer: r.passer,
      targetOrRusher: r.targetOrRusher,
      defender: r.defender,
      kicker: r.kicker,
      returner: r.returner,
      distance: r.distance,
      injuries: byPlayIndex.get(i) ?? [],
    });
    if (r.call === "field_goal") {
      cur.ended = r.outcome === "made" ? "field_goal" : "missed_field_goal";
      cur.points = r.outcome === "made" ? 3 : 0;
      cur = null;
    } else if (r.call === "punt") {
      cur.ended = r.outcome === "return_td" ? "punt_return_td" : "punt";
      cur = null;
    } else if (r.touchdown) {
      cur.ended = "touchdown";
      cur.points = 7;
      cur = null;
    } else if (r.turnover) {
      cur.ended = "turnover";
      cur = null;
    }
  });
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
  const drives = toDrives(g.playTrace ?? [], injuries, home, away);
  return {
    home,
    away,
    finalScore: [g.score[0], g.score[1]],
    drives,
    scoringDrives: drives.flatMap((d, i) => (d.points > 0 ? [i] : [])),
    injuries,
  };
}
