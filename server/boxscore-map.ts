/**
 * Maps one simulated game onto the shapes the franchise UI's box score and
 * stats screens read (`ui-source/src/domain/game.ts`): team totals, a scoring
 * summary, and per-player lines.
 *
 * Adapter-side on purpose — this is presentation, not simulation. The engine
 * already produces everything here; it just doesn't package it this way.
 *
 * Two things worth knowing about the inputs:
 *
 * - The play trace has no extra-point plays, so team totals from touchdowns
 *   and field goals alone land short by exactly the made XPs / two-point
 *   conversions. `quarterScores` reconciles against the engine's own final
 *   score and pins the missing points to the quarter of the touchdown that
 *   earned them.
 * - Per-play player attribution (`passer`, `targetOrRusher`, `defender`, …)
 *   is documented in `sim.ts` as *cosmetic*: it's picked deterministically
 *   from the on-field lineup and the play's already-rolled numbers, not from
 *   a modeled usage share, and it costs no extra RNG draws. The player lines
 *   built from it are therefore a readable account of the game that was
 *   played, not a calibrated stat model — the UI says as much where it shows
 *   season leaderboards.
 */
import type { TeamBox } from "../src/engine/boxscore.js";
import type { DriveRecord, GameEvent, PlayRec, ScoreEvent as LoggedScore } from "../src/engine/sim.js";
import type { Player } from "../src/schema/player.js";

export interface TeamGameTotals {
  points: number;
  totalYards: number;
  passYards: number;
  rushYards: number;
  plays: number;
  thirdDownMade: number;
  thirdDownAtt: number;
  topSeconds: number;
  penalties: number;
  penaltyYards: number;
  turnovers: number;
  byQuarter: number[];
  // what the matchup comparison reads (mirrors `ui-source/src/domain/game.ts`)
  passAtt?: number;
  passComp?: number;
  sacksAllowed?: number;
  qbHits?: number;
  intThrown?: number;
  fumblesLost?: number;
  krTd?: number;
  prTd?: number;
  kickPoints?: number;
  startSum?: number;
  startN?: number;
  sepSum?: number;
  sepN?: number;
}

export interface ScoringPlay {
  quarter: number;
  team: string;
  description: string;
  homeScore: number;
  awayScore: number;
}

export interface PlayerGameLine {
  playerId: string;
  name: string;
  position: string;
  passCmp?: number;
  passAtt?: number;
  passYds?: number;
  passTd?: number;
  passInt?: number;
  rushAtt?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  tackles?: number;
  sacks?: number;
  defInt?: number;
  passDef?: number;
  ffum?: number;
  fgm?: number;
  fga?: number;
  xpm?: number;
  xpa?: number;
}

/** Which side actually put the points on the board for a scoring play. */
function scoringSide(p: PlayRec): 0 | 1 {
  const other = (1 - p.team) as 0 | 1;
  if (p.call === "punt") return other; // a punt only scores on a return TD
  if (p.touchdown && p.turnover) return other; // pick-6 / scoop-and-score
  return p.team as 0 | 1;
}

interface ScoreEvent {
  quarter: number;
  side: 0 | 1;
  points: number;
  isTd: boolean;
  play: PlayRec;
  /** a turnover returned for a score — not a traced play, see `scoreEvents` */
  defensive?: boolean;
  /** a safety — likewise untraced */
  safety?: boolean;
}

function scoreEvents(trace: PlayRec[], drives: DriveRecord[] = []): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (const p of trace) {
    const side = scoringSide(p);
    if (p.touchdown) out.push({ quarter: p.quarter, side, points: 6, isTd: true, play: p });
    else if (p.call === "field_goal" && p.outcome === "made")
      out.push({ quarter: p.quarter, side, points: 3, isTd: false, play: p });
    else if (p.call === "punt" && p.outcome === "return_td")
      out.push({ quarter: p.quarter, side, points: 6, isTd: true, play: p });
  }

  // A defence that returns a turnover for a score never shows up in the play
  // trace — the sim records it on the *offence's* drive as `opp_touchdown`,
  // and the points land in the team totals without a play to hang them on.
  // Without this, a pick-six is missing from the scoring summary entirely and
  // the line score can't add up. The drive log gives the exact count and which
  // side scored; the quarter is taken from that offence's turnover plays, in
  // order, which is where the return almost always happened.
  for (const side of [0, 1] as const) {
    const conceded = drives.filter((d) => d.team === side && d.result === "opp_touchdown").length;
    if (conceded === 0) continue;
    // some returns *are* traced (the play carries touchdown + turnover, or is
    // a punt return TD) — only synthesize the ones that aren't, or the score
    // gets counted twice
    const alreadyTraced = trace.filter(
      (p) =>
        p.team === side &&
        ((p.touchdown && p.turnover) || (p.call === "punt" && (p.touchdown || p.outcome === "return_td"))),
    ).length;
    const missing = conceded - alreadyTraced;
    if (missing <= 0) continue;
    const turnovers = trace.filter((p) => p.team === side && p.turnover && !p.touchdown);
    for (let i = 0; i < missing; i++) {
      const p = turnovers[turnovers.length - missing + i] ?? turnovers[turnovers.length - 1];
      const scorer = (1 - side) as 0 | 1;
      out.push({
        quarter: p?.quarter ?? 4,
        side: scorer,
        points: 6,
        isTd: true,
        play: p ?? trace[trace.length - 1]!,
        defensive: true,
      });
    }
  }
  // A safety is the same story: booked on the conceding team's drive, worth
  // two to the other side, with no play of its own. The deepest snap that
  // team took is where it happened, near enough — `ballOn` is distance to
  // their target end zone, so the largest value is the one closest to their
  // own goal line.
  for (const side of [0, 1] as const) {
    const safeties = drives.filter((d) => d.team === side && d.result === "safety").length;
    if (safeties === 0) continue;
    const deepest = trace
      .filter((p) => p.team === side)
      .sort((a, b) => b.ballOn - a.ballOn)[0];
    for (let i = 0; i < safeties; i++) {
      out.push({
        quarter: deepest?.quarter ?? 4,
        side: (1 - side) as 0 | 1,
        points: 2,
        isTd: false,
        play: deepest ?? trace[trace.length - 1]!,
        safety: true,
      });
    }
  }

  out.sort((a, b) => a.quarter - b.quarter);
  return out;
}

/**
 * Final point value of every scoring event, with the untraced extra points
 * folded back in, plus whatever couldn't be attached to a touchdown at all.
 *
 * Extra points are awarded a round at a time rather than greedily: every
 * touchdown gets its kick before any of them is credited with a two-point
 * conversion, which is both the common case and what keeps a 7-0 game from
 * being reported as 8-0. Anything still left over (a safety, say, which has
 * no traced play) is returned separately so the line score can still add up.
 */
function reconcile(
  events: ScoreEvent[],
  finalScore: [number, number],
): { perEvent: number[]; unattached: [number, number] } {
  const perEvent = events.map((e) => e.points);
  const unattached: [number, number] = [0, 0];
  // a synthesized defensive score must never push a side past the engine's
  // own final — if it would, the trace already accounted for those points
  for (const side of [0, 1] as const) {
    let running = 0;
    events.forEach((e, i) => {
      if (e.side !== side) return;
      if (e.defensive && running + perEvent[i]! > finalScore[side]) perEvent[i] = 0;
      running += perEvent[i]!;
    });
  }
  for (const side of [0, 1] as const) {
    // only events that still carry points can take an extra point
    const tdIdx = events.flatMap((e, i) => (e.side === side && e.isTd && perEvent[i]! > 0 ? [i] : []));
    const scored = events.reduce((n, e, i) => (e.side === side ? n + perEvent[i]! : n), 0);
    let leftover = finalScore[side] - scored;
    // Round one is the kick after each touchdown. Round two would make some of
    // them two-point conversions, which is only a credible reading while the
    // remainder is no bigger than the number of touchdowns — beyond that it's
    // a whole separate score (a kick return, say) that just isn't in the trace,
    // and inflating touchdowns to 8 to absorb it would be a lie.
    for (const i of tdIdx) {
      if (leftover <= 0) break;
      perEvent[i] = (perEvent[i] ?? 0) + 1;
      leftover -= 1;
    }
    if (leftover > 0 && leftover <= tdIdx.length) {
      for (const i of tdIdx) {
        if (leftover <= 0) break;
        perEvent[i] = (perEvent[i] ?? 0) + 1;
        leftover -= 1;
      }
    }
    unattached[side] = Math.max(0, leftover);
  }
  return { perEvent, unattached };
}

/**
 * The engine's own scoring record, if it agrees with the final score.
 *
 * The final score is authoritative. When the engine logged its scores
 * (`Game.eventLog`) and they add up to it exactly, the summary is built from
 * them and nothing is inferred. If they don't (a Game from an older engine,
 * or a log that wasn't collected) the caller falls back to reconstructing the
 * summary from the trace, which is the only thing that can be done and which
 * is known to misplace defensive scores.
 */
export function authoritativeScores(
  events: readonly GameEvent[] | undefined,
  finalScore: readonly [number, number],
): LoggedScore[] | null {
  if (!events) return null;
  const scores = events.filter((e): e is LoggedScore => e.type === "score");
  const total: [number, number] = [0, 0];
  for (const e of scores) total[e.side] += e.points;
  if (total[0] !== finalScore[0] || total[1] !== finalScore[1]) return null;
  return scores;
}

/** Points per quarter for [home, away], reconciled to the engine's final score. */
export function quarterScores(
  trace: PlayRec[],
  finalScore: [number, number],
  drives: DriveRecord[] = [],
  log?: readonly GameEvent[],
): number[][] {
  const logged = authoritativeScores(log, finalScore);
  if (logged) {
    const quarters = Math.max(4, ...logged.map((e) => e.quarter));
    const out = [0, 1].map(() => Array.from({ length: quarters }, () => 0));
    for (const e of logged) out[e.side]![e.quarter - 1]! += e.points;
    return out;
  }
  const events = scoreEvents(trace, drives);
  const quarters = Math.max(4, ...events.map((e) => e.quarter));
  const out: number[][] = [
    Array.from({ length: quarters }, () => 0),
    Array.from({ length: quarters }, () => 0),
  ];
  const add = (arr: number[], quarter: number, n: number): void => {
    const i = Math.min(Math.max(0, quarter - 1), arr.length - 1);
    arr[i] = (arr[i] ?? 0) + n;
  };

  const { perEvent, unattached } = reconcile(events, finalScore);
  events.forEach((e, i) => add(out[e.side]!, e.quarter, perEvent[i] ?? e.points));
  for (const side of [0, 1] as const) {
    if (unattached[side] > 0) add(out[side]!, quarters, unattached[side]);
  }
  return out;
}

export function toTeamTotals(
  box: TeamBox,
  byQuarter: number[],
  /** this side's drives, for where they started */
  drives: readonly DriveRecord[] = [],
): TeamGameTotals {
  // yards from its own goal line each drive began, 25 being the usual start
  const starts = drives.map((d) => 100 - d.startYl);
  return {
    points: box.points,
    totalYards: box.totalYards,
    passYards: box.passYards,
    rushYards: box.rushYards,
    plays: box.passAtt + box.rushAtt + box.sacksAllowed,
    thirdDownMade: box.thirdDown[0],
    thirdDownAtt: box.thirdDown[1],
    topSeconds: box.possessionSeconds,
    penalties: box.penalties,
    penaltyYards: box.penaltyYards,
    turnovers: box.turnovers,
    byQuarter,
    passAtt: box.passAtt,
    passComp: box.completions,
    sacksAllowed: box.sacksAllowed,
    qbHits: box.qbHits,
    intThrown: box.interceptionsThrown,
    fumblesLost: box.fumblesLost,
    krTd: box.kickReturnTds,
    prTd: box.puntReturnTds,
    // field goals and extra points: the kicker's scoring
    kickPoints: box.fieldGoals[0] * 3 + box.extraPoints,
    ...(starts.length ? { startSum: Math.round(starts.reduce((a, b) => a + b, 0)), startN: starts.length } : {}),
    ...(box.separationN > 0 ? { sepSum: box.separationSum, sepN: box.separationN } : {}),
  };
}

function describeScore(e: ScoreEvent): string {
  const p = e.play;
  const yds = Math.round(p.gained);
  const who = (n: string | undefined) => n ?? "the offense";
  if (e.safety) return "Safety";
  if (e.defensive)
    return `${who(p.defender)} returns the ${p.outcome === "interception" ? "interception" : "fumble"} for a touchdown`;
  if (p.call === "field_goal") return `${p.distance ?? yds}-yard field goal, ${who(p.kicker)}`;
  if (p.call === "punt") return `${who(p.returner)} ${yds}-yard punt return for a touchdown`;
  if (p.touchdown && p.turnover)
    return `${who(p.defender)} returns the ${p.outcome === "interception" ? "interception" : "fumble"} for a touchdown`;
  if (p.call === "pass") return `${who(p.passer)} ${yds}-yard touchdown pass to ${who(p.targetOrRusher)}`;
  return `${who(p.targetOrRusher)} ${yds}-yard touchdown run`;
}

/** One line of the scoring summary for a logged score, saying only what the trace and the event carry. */
function describeLogged(e: LoggedScore, trace: PlayRec[]): string {
  const p = e.playIndex === null ? undefined : trace[e.playIndex];
  const yds = p ? Math.round(p.gained) : 0;
  switch (e.kind) {
    case "field_goal":
      if (p?.distance === undefined) return "Field goal";
      return p.kicker ? `${p.distance}-yard field goal, ${p.kicker}` : `${p.distance}-yard field goal`;
    case "interception_return_td":
      return e.scorer ? `${e.scorer} returns the interception for a touchdown` : "Interception returned for a touchdown";
    case "fumble_return_td":
      return "Fumble returned for a touchdown";
    case "punt_return_td":
      return e.scorer ? `${e.scorer} punt return for a touchdown` : "Punt returned for a touchdown";
    case "kick_return_td":
      return "Kickoff returned for a touchdown";
    case "safety": {
      if (p?.call === "sack" && p.defender && p.passer) return `Safety — ${p.defender} sacks ${p.passer} in the end zone`;
      return "Safety";
    }
    case "touchdown":
      if (p?.call === "pass") return `${p.passer ?? "The offense"} ${yds}-yard touchdown pass to ${p.targetOrRusher ?? "a receiver"}`;
      return `${p?.targetOrRusher ?? "The offense"} ${yds}-yard touchdown run`;
    default:
      return e.points === 1 ? "Extra point" : "Two-point conversion";
  }
}

/**
 * The scoring summary straight from the engine's score log.
 *
 * One row per scoring play, in the order they happened; the extra point or
 * two-point try is folded into its touchdown's row, and every running score is
 * the engine's own `scoreAfter`, so the table cannot disagree with the
 * scoreboard. A touchdown whose kick isn't logged is shown at six points: no
 * extra point is assumed.
 */
function scoringPlaysFromLog(
  logged: LoggedScore[],
  trace: PlayRec[],
  homeTeam: string,
  awayTeam: string,
): ScoringPlay[] {
  const out: ScoringPlay[] = [];
  let last: LoggedScore | undefined;
  for (const e of logged) {
    const folds = (e.kind === "extra_point" || e.kind === "two_point") && last && last.side === e.side && last.playIndex === e.playIndex;
    if (folds) {
      const row = out.at(-1)!;
      row.homeScore = e.scoreAfter[0];
      row.awayScore = e.scoreAfter[1];
      if (e.kind === "two_point") row.description += " (two-point conversion good)";
      last = e;
      continue;
    }
    out.push({
      quarter: e.quarter,
      team: e.side === 0 ? homeTeam : awayTeam,
      description: describeLogged(e, trace),
      homeScore: e.scoreAfter[0],
      awayScore: e.scoreAfter[1],
    });
    last = e;
  }
  return out;
}

export function scoringPlaysFrom(
  trace: PlayRec[],
  homeTeam: string,
  awayTeam: string,
  finalScore: [number, number],
  drives: DriveRecord[] = [],
  log?: readonly GameEvent[],
): ScoringPlay[] {
  const logged = authoritativeScores(log, finalScore);
  if (logged) return scoringPlaysFromLog(logged, trace, homeTeam, awayTeam);
  const events = scoreEvents(trace, drives);
  // same reconciliation the line score uses, so the two always agree
  const { perEvent, unattached } = reconcile(events, finalScore);
  const lastQuarter = Math.max(4, ...events.map((e) => e.quarter));
  const score = [0, 0];
  const out: ScoringPlay[] = [];
  events.forEach((e, i) => {
    const pts = perEvent[i] ?? e.points;
    if (pts <= 0) return; // a synthesized score the trace already covered
    score[e.side] = (score[e.side] ?? 0) + pts;
    out.push({
      quarter: e.quarter,
      team: e.side === 0 ? homeTeam : awayTeam,
      description: describeScore(e),
      homeScore: score[0]!,
      awayScore: score[1]!,
    });
  });

  // A kick or punt returned to the house is neither a drive nor a scrimmage
  // play, so nothing above can place it. Rather than let the summary quietly
  // disagree with the scoreboard, book the remainder as its own line — named
  // for what the points can only have been.
  for (const side of [0, 1] as const) {
    if (unattached[side] <= 0) continue;
    const pts = unattached[side];
    score[side] = (score[side] ?? 0) + pts;
    out.push({
      quarter: lastQuarter,
      team: side === 0 ? homeTeam : awayTeam,
      description: pts === 2 ? "Safety" : pts >= 6 ? "Return touchdown" : "Additional scoring",
      homeScore: score[0]!,
      awayScore: score[1]!,
    });
  }
  return out;
}

type LineMap = Map<string, PlayerGameLine>;

function lineFor(map: LineMap, name: string, roster: Map<string, Player>): PlayerGameLine {
  let line = map.get(name);
  if (!line) {
    const p = roster.get(name);
    line = { playerId: p?.id ?? `name:${name}`, name, position: p?.position ?? "—" };
    map.set(name, line);
  }
  return line;
}

const bump = (line: PlayerGameLine, key: keyof PlayerGameLine, by = 1): void => {
  (line[key] as number) = ((line[key] as number | undefined) ?? 0) + by;
};

/**
 * Per-player lines for both sides, aggregated from the trace's (cosmetic)
 * attribution. Offensive credit goes to the possessing team, defensive credit
 * to the other one.
 */
export function playerLinesFrom(
  trace: PlayRec[],
  homeTeam: string,
  awayTeam: string,
  rosters: Record<string, Player[]> | undefined,
): { home: PlayerGameLine[]; away: PlayerGameLine[] } {
  const byName = (team: string): Map<string, Player> =>
    new Map((rosters?.[team] ?? []).map((p) => [p.name, p]));
  const rosterOf = [byName(homeTeam), byName(awayTeam)];
  const maps: LineMap[] = [new Map(), new Map()];

  for (const p of trace) {
    const off = p.team as 0 | 1;
    const def = (1 - off) as 0 | 1;
    const yds = Math.round(p.gained);

    if (p.call === "pass") {
      if (p.passer) {
        const l = lineFor(maps[off]!, p.passer, rosterOf[off]!);
        bump(l, "passAtt");
        if (p.outcome === "complete") {
          bump(l, "passCmp");
          bump(l, "passYds", yds);
          if (p.touchdown) bump(l, "passTd");
        } else if (p.outcome === "interception") bump(l, "passInt");
      }
      if (p.targetOrRusher && p.outcome === "complete") {
        const l = lineFor(maps[off]!, p.targetOrRusher, rosterOf[off]!);
        bump(l, "rec");
        bump(l, "recYds", yds);
        if (p.touchdown) bump(l, "recTd");
      }
      if (p.defender) {
        const l = lineFor(maps[def]!, p.defender, rosterOf[def]!);
        if (p.outcome === "interception") bump(l, "defInt");
        else if (p.outcome === "incomplete") bump(l, "passDef");
        else if (p.outcome === "complete") bump(l, "tackles");
        // the engine credits the forcing defender on a fumble after the catch
        else if (p.outcome === "fumble") bump(l, "ffum");
      }
      if (p.tackler && p.outcome === "complete" && !p.touchdown) {
        bump(lineFor(maps[def]!, p.tackler, rosterOf[def]!), "tackles");
      }
    } else if (p.call === "run" || p.call === "scramble") {
      if (p.targetOrRusher) {
        const l = lineFor(maps[off]!, p.targetOrRusher, rosterOf[off]!);
        bump(l, "rushAtt");
        bump(l, "rushYds", yds);
        if (p.touchdown) bump(l, "rushTd");
      }
      if (p.defender) {
        const l = lineFor(maps[def]!, p.defender, rosterOf[def]!);
        bump(l, "tackles");
        if (p.outcome === "fumble") bump(l, "ffum");
      } else if (p.tackler && !p.touchdown) bump(lineFor(maps[def]!, p.tackler, rosterOf[def]!), "tackles");
    } else if (p.call === "sack") {
      if (p.defender) {
        const l = lineFor(maps[def]!, p.defender, rosterOf[def]!);
        bump(l, "sacks");
        bump(l, "tackles");
      }
    } else if (p.call === "field_goal" && p.kicker) {
      const l = lineFor(maps[off]!, p.kicker, rosterOf[off]!);
      bump(l, "fga");
      if (p.outcome === "made") bump(l, "fgm");
    }
  }
  return { home: [...maps[0]!.values()], away: [...maps[1]!.values()] };
}
