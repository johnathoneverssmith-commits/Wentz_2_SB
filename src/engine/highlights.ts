/**
 * Game highlights and drive summaries (PBP-3).
 *
 * Pure functions of a broadcast (`GameBroadcast`): no simulation imports, no
 * RNG, no clock, no I/O. The same game gives the same answer on every device,
 * after a save and reload, and in single-player and online alike, and nothing
 * here can change a game because nothing here runs one.
 *
 * What it reads, and nothing else:
 *
 * - the plays and their attribution (PBP-1's trace),
 * - the engine's score log carried on each play (`scores`, PBP-1) and the
 *   scores no play caused (`returnScores`),
 * - the narration of each play (PBP-2), reused rather than re-worded.
 *
 * A game saved before the engine logged scores has none of those events. It is
 * then read off the running score (`scoreAfter` against the previous play's),
 * which is a measurement, so a highlight still rests on something that
 * happened.
 *
 * **Significance.** A moment's rank is how much it moved the game, not how far
 * it went. A score is weighted by how much it moved the chance of winning
 * (a margin and the time left, through a normal approximation: it ranks moments,
 * it is never shown as a statistic); a turnover, a fourth-down snap or a miss by how
 * close and late the game was and where on the field it happened; yardage only
 * counts for a long gain, and counts for little next to a score.
 */
import {
  type NarratedEvent,
  type NarratedPlay,
  type Seg,
  narrateBroadcast,
  narrationText,
  narrateScoreLine,
  playScoreKinds,
  spotPhrase,
} from "./narration.js";

// ------------------------------------------------------------------ input

/** The engine's score record as a play or a broadcast carries it (structural: the engine's and the UI's mirror both fit). */
export interface ScoreLike {
  kind: string;
  points: number;
  side: 0 | 1;
  quarter: number;
  clock: string;
  scorer?: string | undefined;
  scoreAfter: readonly [number, number];
}

export interface GamePlay extends NarratedPlay {
  scores?: readonly ScoreLike[] | undefined;
  scoreAfter: readonly [number, number];
  eventsBefore?: readonly NarratedEvent[] | undefined;
}

export interface GameDrive {
  team: string;
  side: "home" | "away";
  quarter: number;
  startClock: string;
  startBallOn: number;
  plays: readonly GamePlay[];
  ended: string;
  points: number;
  pointsAgainst: number;
}

export interface GameCast {
  home: string;
  away: string;
  finalScore: readonly [number, number];
  drives: readonly GameDrive[];
  /** scores no traced play caused: a kickoff returned for a touchdown, and the kick after it. */
  returnScores?: readonly ScoreLike[] | undefined;
}

// ------------------------------------------------------------------ output

export type HighlightKind =
  | "defensive_td"
  | "special_teams_td"
  | "touchdown"
  | "safety"
  | "interception"
  | "fumble_lost"
  | "fourth_down_stop"
  | "fourth_down_conversion"
  | "field_goal"
  | "explosive_play"
  | "missed_field_goal";

export type HighlightTag =
  | "lead_change"
  | "go_ahead"
  | "tying"
  | "opens_scoring"
  | "extends_lead"
  | "cuts_deficit"
  | "late"
  | "overtime"
  | "game_winning"
  | "final_lead"
  | "puts_away"
  | "fourth_down"
  | "red_zone"
  | "goal_line_stand"
  | "long_gain"
  | "missed_chance"
  | "go_ahead_for_good";

export interface Highlight {
  /** stable for a given game: `d{drive}p{play}` (a return score before a snap carries `r` and its order). */
  id: string;
  drive: number;
  play: number;
  quarter: number;
  clock: string;
  /** the team the moment favoured (the scorer, the defence on a takeaway, the offence on a conversion). */
  team: string;
  side: "home" | "away";
  kind: HighlightKind;
  /** 0–100; higher is bigger. Ranks moments within a game and says nothing outside it. */
  significance: number;
  tags: HighlightTag[];
  /** the play, as the shared narration words it. */
  text: Seg[];
  /** why it mattered, in plain words, from the score and the clock. */
  context: string;
  /** [home, away] once the play is over. */
  scoreAfter: [number, number];
  /** selected for the game's short list: 1 is the biggest. Absent on moments that were considered and left out. */
  rank?: number;
  /** "major" is the handful that carried the game; "notable" the rest of the short list. */
  tier?: "major" | "notable";
}

export type DriveResult =
  | "touchdown"
  | "field_goal"
  | "missed_field_goal"
  | "punt"
  | "interception"
  | "fumble"
  | "downs"
  | "safety"
  | "interception_return_td"
  | "fumble_return_td"
  | "punt_return_td"
  | "end_of_half"
  | "end_of_regulation"
  | "end_of_game";

export interface DriveSummary {
  index: number;
  team: string;
  side: "home" | "away";
  quarter: number;
  startClock: string;
  /** where it started, e.g. "their own 25". */
  startSpot: string;
  /** scrimmage snaps (runs, passes, sacks, scrambles); a punt or a kick is not one. A penalty that wiped a snap out is not either. */
  snaps: number;
  /** net yards: the field the drive covered, from where it started to where it ended (penalties included). */
  yards: number;
  /** snaps that earned a first down. */
  firstDowns: number;
  result: DriveResult;
  /** what this team scored on the drive, and what the other side scored during it (a pick-six, a punt returned). */
  points: number;
  pointsAgainst: number;
  /** [home, away] when the drive was over; null on a game saved before the running score was recorded. */
  scoreAfter: [number, number] | null;
  /** one readable line: "9 plays, 61 yards, field goal". */
  summary: string;
  /** the scoring plays in the drive's own words (the narration's scoring-summary lines). */
  scoreLines: string[];
  /** ids of selected highlights that happened on this drive. */
  highlightIds: string[];
  /** worth a second look: a score or a turnover that mattered, or a drive with a major highlight. */
  key: boolean;
}

/** One scoring step, in the order it happened (an extra point folded into its touchdown). */
export interface ScoreStep {
  side: "home" | "away";
  points: number;
  kind: string;
  quarter: number;
  clock?: string | undefined;
  /** the score once it is on the board. */
  home: number;
  away: number;
  /** where it sits in the broadcast, when it came from one. */
  drive?: number | undefined;
  play?: number | undefined;
  scorer?: string | undefined;
}

export interface LeadStory {
  winner: "home" | "away" | null;
  leadChanges: number;
  /** times the score went level after one side led. */
  ties: number;
  /** the most the winner ever trailed by, and in which quarter that deficit was reached. */
  winnerTrailedBy: { amount: number; quarter: number } | null;
  /** index in `steps` of the score that gave the winner the lead for good, unless it opened the scoring and never lost it. */
  finalLeadStep: number | null;
  /** the winner's last step to push a late lead beyond one score for good, when the game was in its closing minutes. */
  putAwayStep: number | null;
  /** score at the half and after three quarters, as [home, away]. */
  half: [number, number];
  threeQuarters: [number, number];
  overtime: boolean;
}

export interface GameAnalysis {
  steps: ScoreStep[];
  story: LeadStory;
  /** the short list, chronological, with `rank` and `tier`. */
  highlights: Highlight[];
  /** every moment that was scored, chronological, whether or not it made the list. */
  candidates: Highlight[];
  drives: DriveSummary[];
}

// ----------------------------------------------------------------- helpers

const clockSecs = (c: string): number => {
  const [m, s] = c.split(":");
  return (Number(m) || 0) * 60 + (Number(s) || 0);
};

/** seconds left in regulation; overtime is sudden death and has none. */
const regulationLeft = (quarter: number, clock: string): number =>
  quarter >= 5 ? 0 : (4 - Math.min(4, Math.max(1, quarter))) * 900 + clockSecs(clock);

/** Abramowitz–Stegun 7.1.26. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

/** the home side's chance of winning from a margin and the regulation time left: a ranking device, never shown. */
function homeWinChance(margin: number, left: number, overtime: boolean): number {
  if (overtime || left <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return 0.5 * (1 + erf(margin / (13.5 * Math.sqrt(left / 3600)) / Math.SQRT2));
}

const sideOf = (n: 0 | 1): "home" | "away" => (n === 0 ? "home" : "away");
const other = (s: "home" | "away"): "home" | "away" => (s === "home" ? "away" : "home");
const quarterWord = (q: number): string =>
  q >= 5 ? "overtime" : `the ${q === 1 ? "1st" : q === 2 ? "2nd" : q === 3 ? "3rd" : "4th"} quarter`;
const clockWord = (quarter: number, clock: string | undefined): string => {
  if (clock === undefined) return `in ${quarterWord(quarter)}`;
  if (quarter >= 5) return "in overtime";
  return quarter === 4 && clockSecs(clock) <= 600 ? `with ${clock} left` : `in ${quarterWord(quarter)}`;
};

// ---------------------------------------------------------------- timeline

const FOLDS = new Set(["extra_point", "two_point"]);
const PLAY_SCORE_KINDS: [string, string][] = [
  ["interception_return_td", "interception_return_td"],
  ["fumble_return_td", "fumble_return_td"],
  ["punt_return_td", "punt_return_td"],
  ["safety", "safety"],
];

/**
 * Every score of a game in order, with the extra point folded into its
 * touchdown. From the engine's score log where the broadcast has one; from the
 * running score where it does not.
 */
export function timelineFromCast(cast: GameCast): ScoreStep[] {
  const flat: { d: number; i: number; p: GamePlay; side: "home" | "away" }[] = [];
  cast.drives.forEach((dr, d) => dr.plays.forEach((p, i) => flat.push({ d, i, p, side: dr.side })));
  const logged = cast.drives.some((dr) => dr.plays.some((p) => p.scores !== undefined)) || (cast.returnScores?.length ?? 0) > 0;

  type Keyed = { key: number; step: ScoreStep };
  const keyed: Keyed[] = [];

  if (logged) {
    flat.forEach(({ d, i, p }, f) => {
      for (const e of p.scores ?? []) keyed.push({ key: f * 2 + 1, step: stepOf(e, d, i) });
    });
    // a score no play caused happens at a kickoff: before the first snap that follows it
    for (const e of cast.returnScores ?? []) {
      let f = flat.findIndex(({ p }) => p.scoreAfter[0] >= e.scoreAfter[0] && p.scoreAfter[1] >= e.scoreAfter[1]);
      f = f < 0 ? flat.length - 1 : Math.min(f + 1, flat.length - 1);
      const at = flat[f];
      keyed.push({ key: f * 2, step: stepOf(e, at?.d, at?.i) });
    }
  } else {
    let prev: readonly [number, number] = [0, 0];
    flat.forEach(({ d, i, p, side }, f) => {
      const dh = p.scoreAfter[0] - prev[0];
      const da = p.scoreAfter[1] - prev[1];
      const ctx = { prevScoreAfter: prev, side };
      prev = p.scoreAfter;
      for (const [n, side2] of [[dh, "home"], [da, "away"]] as const) {
        if (n <= 0) continue;
        const { kinds, scorer } = playScoreKinds(p, ctx);
        const derived = PLAY_SCORE_KINDS.find(([k]) => kinds.has(k))?.[1];
        const own = side2 === side;
        const kind = derived ?? (own ? (p.call === "field_goal" ? "field_goal" : p.touchdown ? "touchdown" : "score") : "score");
        keyed.push({
          key: f * 2 + 1,
          step: { side: side2, points: n, kind, quarter: p.quarter, clock: p.clock, home: p.scoreAfter[0], away: p.scoreAfter[1], drive: d, play: i, scorer },
        });
      }
    });
  }

  keyed.sort((a, b) => a.key - b.key);
  const out: ScoreStep[] = [];
  for (const { step } of keyed) {
    const last = out.at(-1);
    if (FOLDS.has(step.kind) && last && last.side === step.side) {
      last.points += step.points;
      last.home = step.home;
      last.away = step.away;
      continue;
    }
    out.push(step);
  }
  return out;
}

function stepOf(e: ScoreLike, drive: number | undefined, play: number | undefined): ScoreStep {
  return { side: sideOf(e.side), points: e.points, kind: e.kind, quarter: e.quarter, clock: e.clock, home: e.scoreAfter[0], away: e.scoreAfter[1], drive, play, scorer: e.scorer };
}

/** The same steps from a scoring summary (a game kept without its plays): no clocks, no plays. */
export function timelineFromScoringPlays(
  rows: readonly { quarter: number; team: string; description: string; homeScore: number; awayScore: number }[],
  homeTeam: string,
): ScoreStep[] {
  let prev: [number, number] = [0, 0];
  const out: ScoreStep[] = [];
  for (const r of rows) {
    const dh = r.homeScore - prev[0];
    const da = r.awayScore - prev[1];
    prev = [r.homeScore, r.awayScore];
    const side = r.team === homeTeam ? "home" : "away";
    out.push({ side, points: side === "home" ? dh : da, kind: kindFromDescription(r.description), quarter: r.quarter, home: r.homeScore, away: r.awayScore, scorer: scorerFromDescription(r.description) });
  }
  return out.filter((s) => s.points > 0);
}

/** The player a scoring row names where the engine knew who scored (`narrateScoreLine` words those rows). */
export function scorerFromDescription(d: string): string | undefined {
  return /^(.+?) returns the interception for a touchdown$/.exec(d)?.[1] ?? /^(.+?) punt return for a touchdown$/.exec(d)?.[1];
}

/** A scoring row's kind, from the scoring summary's own wording (`narrateScoreLine`). */
export function kindFromDescription(d: string): string {
  if (/returns the interception|Interception returned/.test(d)) return "interception_return_td";
  if (/Fumble returned/.test(d)) return "fumble_return_td";
  if (/punt return|Punt returned/.test(d)) return "punt_return_td";
  if (/Kickoff returned/.test(d)) return "kick_return_td";
  if (/^Safety/.test(d)) return "safety";
  if (/field goal/i.test(d)) return "field_goal";
  return "touchdown";
}

// -------------------------------------------------------------- lead story

export function leadStory(steps: readonly ScoreStep[], final: readonly [number, number]): LeadStory {
  const winner: "home" | "away" | null = final[0] === final[1] ? null : final[0] > final[1] ? "home" : "away";
  const margin = (s: { home: number; away: number }, who: "home" | "away"): number => (who === "home" ? s.home - s.away : s.away - s.home);
  let leadChanges = 0;
  let ties = 0;
  let lastLeader: "home" | "away" | null = null;
  let prevMargin = 0;
  let trailed: { amount: number; quarter: number } | null = null;
  let finalLeadStep: number | null = null;
  const w = winner ?? "home";
  steps.forEach((s, i) => {
    const m = s.home - s.away;
    const leader = m > 0 ? "home" : m < 0 ? "away" : null;
    if (leader && lastLeader && leader !== lastLeader) leadChanges++;
    if (leader) lastLeader = leader;
    if (m === 0 && prevMargin !== 0) ties++;
    const wm = margin(s, w);
    if (winner && wm < 0 && (!trailed || -wm > trailed.amount)) trailed = { amount: -wm, quarter: s.quarter };
    const before = i === 0 ? 0 : margin(steps[i - 1]!, w);
    if (winner && before <= 0 && wm > 0) finalLeadStep = i;
    prevMargin = m;
  });
  if (finalLeadStep === 0 && steps[0] && margin({ home: 0, away: 0 }, w) === 0) finalLeadStep = null; // opened the scoring and never gave it up
  // the winner's step that put the game away: ahead by more than a score from here to the end, in the closing minutes
  let putAwayStep: number | null = null;
  if (winner) {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (margin(steps[i]!, w) < 9) break;
      if (steps[i]!.side === winner) putAwayStep = i;
    }
    if (putAwayStep !== null) {
      const s = steps[putAwayStep]!;
      const left = s.clock === undefined ? (s.quarter >= 4 ? 600 : 3600) : regulationLeft(s.quarter, s.clock);
      if (s.quarter < 4 || left > 600) putAwayStep = null;
    }
  }
  const upTo = (q: number): [number, number] => {
    let h = 0;
    let a = 0;
    for (const s of steps) if (s.quarter <= q) [h, a] = [s.home, s.away];
    return [h, a];
  };
  return {
    winner,
    leadChanges,
    ties,
    winnerTrailedBy: trailed,
    finalLeadStep,
    putAwayStep,
    half: upTo(2),
    threeQuarters: upTo(3),
    overtime: steps.some((s) => s.quarter >= 5),
  };
}

/** What a step did to the lead, from the scorer's side. */
export function stepTags(steps: readonly ScoreStep[], i: number): HighlightTag[] {
  const s = steps[i]!;
  const mine = (x: { home: number; away: number }): number => (s.side === "home" ? x.home - x.away : x.away - x.home);
  const after = mine(s);
  const before = i === 0 ? 0 : mine(steps[i - 1]!);
  const tags: HighlightTag[] = [];
  const everScored = i > 0;
  if (before < 0 && after > 0) tags.push("lead_change", "go_ahead");
  else if (before < 0 && after === 0) tags.push("tying");
  else if (before === 0 && after > 0) tags.push(everScored ? "go_ahead" : "opens_scoring");
  else if (before > 0) tags.push("extends_lead");
  else if (before < 0 && after < 0) tags.push("cuts_deficit");
  if (s.quarter >= 5) tags.push("overtime");
  else if (s.quarter === 4 && s.clock !== undefined && clockSecs(s.clock) <= 300) tags.push("late");
  return tags;
}

export function stepContext(steps: readonly ScoreStep[], i: number, team: (side: "home" | "away") => string, tags: readonly HighlightTag[], story: LeadStory): string {
  const s = steps[i]!;
  const who = team(s.side);
  const mineScore = s.side === "home" ? s.home : s.away;
  const theirScore = s.side === "home" ? s.away : s.home;
  const when = clockWord(s.quarter, s.clock);
  // only a game with a winner is won in overtime: the last score of a tie is a tying score, not a winning one
  const walkoff = story.overtime && story.winner !== null && s.side === story.winner && i === steps.length - 1;
  if (walkoff) return `${who} win it in overtime, ${mineScore}–${theirScore}`;
  if (tags.includes("lead_change")) return `${who} take the lead, ${mineScore}–${theirScore}, ${when}`;
  if (tags.includes("tying")) return `${who} tie it at ${mineScore}, ${when}`;
  if (tags.includes("opens_scoring")) return `${who} open the scoring, ${mineScore}–${theirScore}`;
  if (tags.includes("go_ahead")) return `${who} go ahead ${mineScore}–${theirScore}, ${when}`;
  if (tags.includes("extends_lead")) return `${who} extend the lead to ${mineScore}–${theirScore}, ${when}`;
  return `${who} cut it to ${theirScore - mineScore}, ${mineScore}–${theirScore}, ${when}`;
}

// -------------------------------------------------------------- highlights

const BASE: Record<HighlightKind, number> = {
  defensive_td: 62,
  special_teams_td: 58,
  touchdown: 48,
  safety: 40,
  interception: 40,
  fumble_lost: 40,
  fourth_down_stop: 34,
  fourth_down_conversion: 30,
  field_goal: 28,
  explosive_play: 22,
  missed_field_goal: 20,
};

const PRIORITY: HighlightKind[] = [
  "defensive_td",
  "special_teams_td",
  "touchdown",
  "safety",
  "interception",
  "fumble_lost",
  "fourth_down_stop",
  "fourth_down_conversion",
  "field_goal",
  "explosive_play",
  "missed_field_goal",
];

/** a long gain: thirty yards or more, which in this engine is a handful a game */
const EXPLOSIVE = 30;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function kindOfStep(k: string): HighlightKind | null {
  if (k === "interception_return_td" || k === "fumble_return_td") return "defensive_td";
  if (k === "punt_return_td" || k === "kick_return_td") return "special_teams_td";
  if (k === "touchdown") return "touchdown";
  if (k === "safety") return "safety";
  if (k === "field_goal") return "field_goal";
  return null;
}

/**
 * Score every moment of a game and pick the short list.
 *
 * `max` caps the list (default 8). Never more than two from one drive, so one
 * long possession cannot take the whole list, and the play that won the game
 * is always on it.
 */
export function analyzeGame(cast: GameCast, opts: { max?: number } = {}): GameAnalysis {
  const max = opts.max ?? 8;
  // The oldest saves carry no running score. Without it there is no score timeline to rank moments by, so such a
  // game gets its drive summaries (which need only the plays) and no highlights, rather than guesses.
  if (!cast.drives.every((d) => d.plays.every((p) => Array.isArray(p.scoreAfter)))) {
    return { steps: [], story: leadStory([], cast.finalScore), highlights: [], candidates: [], drives: summarizeDrives(cast, []) };
  }
  const teamOf = (s: "home" | "away"): string => (s === "home" ? cast.home : cast.away);
  const steps = timelineFromCast(cast);
  const story = leadStory(steps, cast.finalScore);
  const narration = narrateBroadcast(cast.drives, { home: cast.home, away: cast.away });
  const tagsByStep = steps.map((_, i) => stepTags(steps, i));

  // which step is the one that won it, and which put it away
  const lastStep = steps.length - 1;
  const winnerStep: number | null =
    story.overtime && story.winner !== null && steps[lastStep]?.side === story.winner
      ? lastStep
      : story.finalLeadStep !== null && steps[story.finalLeadStep]!.quarter >= 4
        ? story.finalLeadStep
        : null;

  // steps anchored to a play (those a play caused), and those before one (a kickoff returned)
  const byPlay = new Map<string, number[]>();
  const beforePlay = new Map<string, number[]>();
  const returnSet = new Set((cast.returnScores ?? []).map((r) => `${r.quarter}|${r.clock}|${r.scoreAfter.join("-")}`));
  steps.forEach((s, i) => {
    if (s.drive === undefined || s.play === undefined) return;
    const k = `${s.drive}:${s.play}`;
    const isReturn = s.kind === "kick_return_td" || returnSet.has(`${s.quarter}|${s.clock}|${s.home}-${s.away}`);
    const m = isReturn ? beforePlay : byPlay;
    m.set(k, [...(m.get(k) ?? []), i]);
  });

  const candidates: Highlight[] = [];
  let prev: readonly [number, number] = [0, 0];

  const scoreHighlight = (kind: HighlightKind, stepIdx: number, d: number, i: number, p: GamePlay | undefined, text: Seg[], idSuffix = ""): Highlight => {
    const s = steps[stepIdx]!;
    const tags = [...tagsByStep[stepIdx]!];
    if (stepIdx === winnerStep) tags.push("game_winning");
    else if (stepIdx === story.finalLeadStep) tags.push("final_lead", "go_ahead_for_good");
    if (stepIdx === story.putAwayStep) tags.push("puts_away");
    if (p && p.down === 4 && p.call !== "field_goal" && p.call !== "punt") tags.push("fourth_down");
    if (p && p.ballOn <= 20 && kind !== "field_goal" && kind !== "defensive_td") tags.push("red_zone");
    const left = regulationLeft(s.quarter, s.clock ?? "15:00");
    const ot = s.quarter >= 5;
    const bm = stepIdx === 0 ? 0 : steps[stepIdx - 1]!.home - steps[stepIdx - 1]!.away;
    const am = s.home - s.away;
    const leverage = Math.abs(homeWinChance(am, left, ot) - homeWinChance(bm, left, ot));
    let sig = BASE[kind] + 60 * leverage;
    if (tags.includes("lead_change")) sig += 10;
    if (tags.includes("tying")) sig += 8;
    if (tags.includes("fourth_down")) sig += 8;
    if (tags.includes("game_winning")) sig += 35;
    else if (tags.includes("final_lead")) sig += 6;
    if (tags.includes("puts_away")) sig += 12;
    if (ot) sig += 25;
    const clockText = s.clock ?? "";
    return {
      id: `d${d}p${i}${idSuffix}`,
      drive: d,
      play: i,
      quarter: s.quarter,
      clock: clockText,
      team: teamOf(s.side),
      side: s.side,
      kind,
      significance: Math.round(clamp(sig, 0, 100)),
      tags,
      text,
      context: stepContext(steps, stepIdx, teamOf, tags, story),
      scoreAfter: [s.home, s.away],
    };
  };

  cast.drives.forEach((dr, d) =>
    dr.plays.forEach((p, i) => {
      const key = `${d}:${i}`;
      const nar = narration[d]![i]!;
      // scores before this snap (a kickoff returned for a touchdown)
      (beforePlay.get(key) ?? []).forEach((idx, n) => {
        const s = steps[idx]!;
        const kind = kindOfStep(s.kind);
        if (!kind) return;
        const line = narrateScoreLine({ kind: s.kind, points: s.points, scorer: s.scorer }, undefined);
        candidates.push(scoreHighlight(kind, idx, d, i, undefined, [line], `r${n}`));
      });

      const own = dr.side;
      const offTeam = dr.team;
      const defSide = other(own);
      const defTeam = teamOf(defSide);
      const ctx = { prevScoreAfter: prev, side: own };
      const { kinds } = playScoreKinds(p, ctx);
      const idxs = byPlay.get(key) ?? [];
      const play = nar.play;
      const marginOff = prev[own === "home" ? 0 : 1]! - prev[own === "home" ? 1 : 0]!;
      const left = regulationLeft(p.quarter, p.clock);
      const ot = p.quarter >= 5;
      const situation = Math.exp(-Math.abs(marginOff) / 10) * (ot ? 1 : 0.15 + 0.85 * (1 - left / 3600) ** 2);

      // scores this play caused
      let primary: Highlight | null = null;
      for (const idx of idxs) {
        const s = steps[idx]!;
        const kind = kindOfStep(s.kind);
        if (!kind) continue;
        const h = scoreHighlight(kind, idx, d, i, p, play);
        if (!primary || PRIORITY.indexOf(h.kind) < PRIORITY.indexOf(primary.kind)) primary = h;
      }
      if (primary) {
        candidates.push(primary);
      } else if (p.call === "field_goal" && p.outcome !== "made") {
        const closeLate = marginOff >= -3 && marginOff <= 0 && (ot || left <= 120);
        let sig = BASE.missed_field_goal + 25 * situation + (closeLate ? 25 : 0);
        sig = clamp(sig, 0, 100);
        candidates.push(plain("missed_field_goal", sig, closeLate ? ["missed_chance"] : []));
      } else if (p.outcome === "interception" || p.outcome === "fumble") {
        const kind: HighlightKind = p.outcome === "interception" ? "interception" : "fumble_lost";
        // a takeaway that was returned for a score is the score's highlight
        if (!(kinds.has("interception_return_td") || kinds.has("fumble_return_td"))) {
          const tags: HighlightTag[] = [];
          let sig = BASE[kind] + 25 * situation + (p.ballOn <= 10 ? 18 : p.ballOn <= 25 ? 12 : 0);
          if (p.ballOn <= 25) tags.push("red_zone");
          if (p.down === 4) tags.push("fourth_down");
          if (ot) {
            sig += 15;
            tags.push("overtime");
          } else if (p.quarter === 4 && left <= 300) tags.push("late");
          candidates.push(plain(kind, clamp(sig, 0, 100), tags, defSide, defTeam));
        }
      } else if (p.down === 4 && p.call !== "punt" && p.call !== "field_goal" && !p.turnover) {
        if (p.firstDown) {
          const sig = BASE.fourth_down_conversion + 25 * situation + (p.ydstogo >= 5 ? 4 : 0) + (p.ballOn <= 10 ? 5 : 0);
          candidates.push(plain("fourth_down_conversion", clamp(sig, 0, 100), ["fourth_down", ...(ot ? (["overtime"] as const) : [])]));
        } else if (!kinds.has("safety")) {
          const goalLine = p.ballOn <= 5;
          const sig = BASE.fourth_down_stop + 25 * situation + (goalLine ? 12 : p.ballOn <= 20 ? 6 : 0);
          candidates.push(plain("fourth_down_stop", clamp(sig, 0, 100), ["fourth_down", ...(goalLine ? (["goal_line_stand"] as const) : []), ...(p.ballOn <= 20 ? (["red_zone"] as const) : []), ...(ot ? (["overtime"] as const) : [])], defSide, defTeam));
        }
      } else if (Math.round(p.gained) >= EXPLOSIVE && p.call !== "punt" && p.call !== "field_goal" && !p.touchdown) {
        const sig = BASE.explosive_play + Math.min(15, (Math.round(p.gained) - EXPLOSIVE) / 2) + 12 * situation;
        candidates.push(plain("explosive_play", clamp(sig, 0, 100), ["long_gain"]));
      }
      prev = p.scoreAfter;

      function plain(kind: HighlightKind, sig: number, tags: HighlightTag[], side: "home" | "away" = own, team: string = offTeam): Highlight {
        return {
          id: `d${d}p${i}`,
          drive: d,
          play: i,
          quarter: p.quarter,
          clock: p.clock,
          team,
          side,
          kind,
          significance: Math.round(sig),
          tags,
          text: play,
          context: plainContext(kind, p, team, tags, offTeam, defTeam),
          scoreAfter: [p.scoreAfter[0], p.scoreAfter[1]],
        };
      }
    }),
  );

  // chronological, stable
  const order = (h: Highlight): number => h.drive * 1000 + h.play * 2 + (h.id.includes("r") ? 0 : 1);
  candidates.sort((a, b) => order(a) - order(b));
  const highlights = selectHighlights(candidates, max, winnerStep === null ? null : steps[winnerStep]!);
  const selectedIds = new Set(highlights.map((h) => h.id));
  const marked = candidates.map((h) => (selectedIds.has(h.id) ? (highlights.find((x) => x.id === h.id) as Highlight) : h));

  return { steps, story, highlights, candidates: marked, drives: summarizeDrives(cast, highlights) };
}

/** "the PHI 46": a spot named by whose side of the field it is on, the same from either team's point of view. `ballOn` is yards to the offence's end zone. */
export function fieldSpot(ballOn: number, offTeam: string, defTeam: string): string {
  const b = Math.round(ballOn);
  if (b === 50) return "midfield";
  return b < 50 ? `the ${defTeam} ${Math.max(1, b)}` : `the ${offTeam} ${100 - b}`;
}

function plainContext(kind: HighlightKind, p: GamePlay, team: string, tags: readonly HighlightTag[], offTeam: string, defTeam: string): string {
  const where = ` at ${fieldSpot(p.ballOn, offTeam, defTeam)}`;
  const timing = p.quarter >= 5 ? " in overtime" : tags.includes("late") ? ` with ${p.clock} left` : "";
  switch (kind) {
    case "interception":
      return `${team} take it away${where}${timing}`;
    case "fumble_lost":
      return `${team} take it away${where}${timing}`;
    case "fourth_down_conversion":
      return `${team} convert 4th-and-${Math.max(1, Math.round(p.ydstogo))}${timing}`;
    case "fourth_down_stop":
      return `${team} stop 4th-and-${Math.max(1, Math.round(p.ydstogo))}${p.ballOn <= 5 ? " at the goal line" : ""}${timing}`;
    case "explosive_play":
      return `${Math.round(p.gained)} yards in one play${timing}`;
    case "missed_field_goal":
      return tags.includes("missed_chance") ? `A miss with the game in the balance${timing}` : `Missed ${p.distance ?? ""}-yard attempt`.replace("  ", " ");
    default:
      return "";
  }
}

/**
 * The short list. By significance, with no more than two from one drive and
 * at most three long gains; the game-winning play is always on it. Returned in
 * the order they happened, `rank` 1 being the biggest.
 */
export function selectHighlights(candidates: readonly Highlight[], max: number, winning?: ScoreStep | null): Highlight[] {
  const MIN = 34;
  const byValue = [...candidates].sort((a, b) => b.significance - a.significance || candidates.indexOf(a) - candidates.indexOf(b));
  const chosen: Highlight[] = [];
  const perDrive = new Map<number, number>();
  let explosive = 0;
  const take = (h: Highlight): void => {
    chosen.push(h);
    perDrive.set(h.drive, (perDrive.get(h.drive) ?? 0) + 1);
    if (h.kind === "explosive_play") explosive++;
  };
  // the play that won it is not optional
  const winner = winning ? candidates.find((h) => h.tags.includes("game_winning")) : undefined;
  if (winner) take(winner);
  for (const h of byValue) {
    if (chosen.length >= max) break;
    if (chosen.includes(h) || h.significance < MIN) continue;
    if ((perDrive.get(h.drive) ?? 0) >= 2) continue;
    if (h.kind === "explosive_play" && explosive >= 3) continue;
    take(h);
  }
  const at = (h: Highlight): number => candidates.indexOf(h);
  const ranked = [...chosen].sort((a, b) => b.significance - a.significance || at(a) - at(b));
  // the list is returned in the order the moments happened; `chosen` holds the originals, so the order is read from them
  return [...chosen]
    .sort((a, b) => at(a) - at(b))
    .map((h) => {
      const rank = ranked.indexOf(h) + 1;
      return { ...h, rank, tier: rank <= 3 || h.significance >= 75 ? ("major" as const) : ("notable" as const) };
    });
}

// ---------------------------------------------------------- drive summaries

const RESULT_WORDS: Record<DriveResult, string> = {
  touchdown: "touchdown",
  field_goal: "field goal",
  missed_field_goal: "missed field goal",
  punt: "punt",
  interception: "interception",
  fumble: "lost fumble",
  downs: "turnover on downs",
  safety: "safety",
  interception_return_td: "interception returned for a touchdown",
  fumble_return_td: "fumble returned for a touchdown",
  punt_return_td: "punt returned for a touchdown",
  end_of_half: "end of the half",
  end_of_regulation: "end of regulation",
  end_of_game: "end of the game",
};

/**
 * One summary per drive: where it began, the snaps and net yards, how it
 * ended, and what was scored. Everything is read off the drive's own plays and
 * the engine's score events.
 */
export function summarizeDrives(cast: GameCast, highlights: readonly Highlight[]): DriveSummary[] {
  const selected = new Map<number, Highlight[]>();
  for (const h of highlights) selected.set(h.drive, [...(selected.get(h.drive) ?? []), h]);
  const lastDrive = cast.drives.length - 1;
  return cast.drives.map((dr, index) => {
    const scrim = dr.plays.filter((p) => p.call !== "punt" && p.call !== "field_goal");
    const last = dr.plays.at(-1)!;
    const kinds = new Set(dr.plays.flatMap((p) => (p.scores ?? []).map((s) => s.kind)));
    const next = cast.drives[index + 1];
    let result: DriveResult;
    if (kinds.has("interception_return_td") && last.outcome === "interception") result = "interception_return_td";
    else if (kinds.has("fumble_return_td") && last.outcome === "fumble") result = "fumble_return_td";
    else if (dr.ended === "punt_return_td") result = "punt_return_td";
    else if (kinds.has("safety") || (dr.pointsAgainst === 2 && dr.ended === "stalled")) result = "safety";
    else if (dr.ended === "touchdown") result = "touchdown";
    else if (dr.ended === "field_goal") result = "field_goal";
    else if (dr.ended === "missed_field_goal") result = "missed_field_goal";
    else if (dr.ended === "punt") result = "punt";
    else if (dr.ended === "turnover") result = last.outcome === "interception" ? "interception" : "fumble";
    else if (last.down === 4 && last.call !== "punt" && last.call !== "field_goal" && !last.firstDown && !last.touchdown) result = "downs";
    else if (index === lastDrive) result = "end_of_game";
    else if (next && next.quarter >= 5 && dr.plays.at(-1)!.quarter <= 4) result = "end_of_regulation";
    else result = "end_of_half";
    // Net yards are the field a drive covered: where it started to where it ended, penalties included. The
    // trace's per-play `gained` is not summed, because the engine's recorded yardage on a long
    // touchdown can run past the end zone (a 91-yard score from the 46), and a drive cannot out-run the field.
    const lastScrim = scrim.at(-1);
    const endBallOn = lastScrim ? Math.max(0, Math.round(lastScrim.ballOn) - Math.round(lastScrim.gained)) : dr.startBallOn;
    const kickSpot = last.call === "punt" || last.call === "field_goal" ? Math.round(last.ballOn) : endBallOn;
    const yards = Math.round(dr.startBallOn) - Math.min(endBallOn, kickSpot);
    const firstDowns = scrim.filter((p) => p.firstDown && !p.touchdown).length;
    const scoreLines = dr.plays.flatMap((p) =>
      (p.scores ?? [])
        .filter((e) => !FOLDS.has(e.kind))
        .map((e) => narrateScoreLine({ kind: e.kind, points: e.points, scorer: e.scorer }, p)),
    );
    const snapsWord = `${scrim.length} ${scrim.length === 1 ? "play" : "plays"}`;
    const yardsWord = `${yards} ${Math.abs(yards) === 1 ? "yard" : "yards"}`;
    const summary = scrim.length === 0 ? RESULT_WORDS[result] : `${snapsWord}, ${yardsWord}, ${RESULT_WORDS[result]}`;
    const hl = selected.get(index) ?? [];
    return {
      index,
      team: dr.team,
      side: dr.side,
      quarter: dr.quarter,
      startClock: dr.startClock,
      startSpot: spotPhrase(dr.startBallOn),
      snaps: scrim.length,
      yards,
      firstDowns,
      result,
      points: dr.points,
      pointsAgainst: dr.pointsAgainst,
      scoreAfter: last.scoreAfter ? [last.scoreAfter[0], last.scoreAfter[1]] : null,
      summary,
      scoreLines,
      highlightIds: hl.map((h) => h.id),
      key: hl.some((h) => h.tier === "major") || (dr.points + dr.pointsAgainst > 0 && hl.length > 0),
    };
  });
}

/** The moment's headline in plain text. */
export const highlightText = (h: Highlight): string => narrationText(h.text);

/** Short label for a kind, for a badge. */
export const KIND_LABEL: Record<HighlightKind, string> = {
  defensive_td: "Defensive TD",
  special_teams_td: "Return TD",
  touchdown: "Touchdown",
  safety: "Safety",
  interception: "Interception",
  fumble_lost: "Fumble",
  fourth_down_stop: "4th-down stop",
  fourth_down_conversion: "4th-down conversion",
  field_goal: "Field goal",
  explosive_play: "Big play",
  missed_field_goal: "Missed FG",
};
