/**
 * Play-by-play narration: one place that turns a traced play (and the events
 * the engine logged around it) into words.
 *
 * It used to exist twice, `describe()` in `broadcast.ts` (no names) and
 * `PlayDesc` in `Gamecast.tsx` (names, a different vocabulary, and no idea a
 * touchdown could be scored by the defence), so the stored `desc` and what
 * the screen said could disagree. Both now come from here.
 *
 * Ground rules, all of which the tests hold it to:
 *
 * - **Only what the data says.** Every clause is read off a field of the play,
 *   or off a score/penalty event the engine logged. Where the engine does not
 *   know something (who recovered a fumble, how far an interception was
 *   returned) the text does not say it.
 * - **Deterministic.** Variety comes from a hash of the play's own numbers, never
 *   from `Math.random`, the play's position in the game, or the clock of the
 *   machine. The same play reads the same on every device, on a replay, after a
 *   save/reload, and in single-player and online alike.
 * - **Old data still reads.** A game saved before the engine logged scores has no
 *   `scores`; a defensive touchdown is then recovered from the running score
 *   (`scoreAfter` against the previous play's), which is a measurement and not
 *   a guess. No field is required beyond what a broadcast has always carried.
 * - **Pure.** No imports from the simulation, so the UI can use it as is.
 *
 * Text is built as segments so a screen can style a player's name without
 * parsing the sentence: a segment is a string, or `{ name }`.
 */

export type Seg = string | { name: string };

/** The fields of a broadcast play the narration reads. Structural, so the engine's and the UI's mirror both fit. */
export interface NarratedPlay {
  down: number;
  ydstogo: number;
  /** yards to the possessing team's target end zone, pre-snap. */
  ballOn: number;
  quarter: number;
  clock: string;
  call: "pass" | "run" | "sack" | "scramble" | "punt" | "field_goal";
  depth: string;
  gained: number;
  outcome: string;
  firstDown: boolean;
  touchdown: boolean;
  turnover: boolean;
  passer?: string | undefined;
  targetOrRusher?: string | undefined;
  defender?: string | undefined;
  tackler?: string | undefined;
  kicker?: string | undefined;
  returner?: string | undefined;
  distance?: number | undefined;
  scoreAfter?: readonly [number, number] | undefined;
  /** the engine's own record of what this play scored (PBP-1); absent on older games. */
  scores?: readonly { kind: string; scorer?: string | undefined }[] | undefined;
}

/** What the narration cannot get from the play alone. */
export interface NarrationContext {
  /** the running score after the previous play, to recover a defensive score on a game saved without `scores`. */
  prevScoreAfter?: readonly [number, number] | undefined;
  /** which side has the ball on this play. */
  side?: "home" | "away" | undefined;
}

/** An accepted penalty, spike or kneel the engine logged between two snaps (structural view of `PenaltyEvent` / `ClockPlayEvent`). */
export interface NarratedEvent {
  type: string;
  team: 0 | 1;
  onOffense?: boolean;
  bucket?: string;
  yards?: number;
  before?: { down: number; ydstogo: number; yardline100: number };
  after?: { down: number; ydstogo: number; yardline100: number };
  automaticFirstDown?: boolean;
  down?: number;
  quarter?: number;
  clock?: string;
}

// ---------------------------------------------------------------- helpers

/** FNV-1a: a stable 32-bit hash. Variety is picked from this and nothing else. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const keyOf = (p: NarratedPlay): string =>
  `${p.quarter}|${p.clock}|${p.down}|${p.ydstogo}|${p.ballOn}|${p.gained}|${p.call}|${p.outcome}`;

const choose = <T>(p: NarratedPlay, salt: string, options: readonly T[]): T =>
  options[hash(keyOf(p) + salt) % options.length]!;

const ordinal = (n: number): string => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/** "the opp 35", "their own 21", "midfield" — from the offence's end of the field. */
export function spotPhrase(ballOn: number): string {
  if (Math.abs(ballOn - 50) < 0.5) return "midfield";
  const yd = Math.round(ballOn > 50 ? 100 - ballOn : ballOn);
  return ballOn > 50 ? `their own ${yd}` : `the opp ${yd}`;
}

const yardsWord = (n: number): string => `${n} ${n === 1 ? "yard" : "yards"}`;

const who = (name: string | undefined, fallback: string): Seg => (name ? { name } : fallback);

/** A segment list as plain text. */
export function narrationText(segs: readonly Seg[]): string {
  return segs.map((s) => (typeof s === "string" ? s : s.name)).join("");
}

const DEPTH: Record<string, string> = {
  BEHIND_LOS: "behind the line of scrimmage",
  SHORT: "a short throw",
  INTERMEDIATE: "an intermediate throw",
  DEEP: "a deep throw",
};

/**
 * What this play scored for the defence or on special teams, from the engine's
 * record where it has one and from the running score where it doesn't.
 */
function scoredKinds(p: NarratedPlay, ctx: NarrationContext): { kinds: Set<string>; scorer: string | undefined } {
  const kinds = new Set<string>();
  let scorer: string | undefined;
  if (p.scores) {
    for (const s of p.scores) {
      kinds.add(s.kind);
      if (s.scorer && (s.kind === "interception_return_td" || s.kind === "punt_return_td")) scorer = s.scorer;
    }
    return { kinds, scorer };
  }
  // an older game: the defence's points on this play, read off the scoreboard
  const prev = ctx.prevScoreAfter;
  if (prev && p.scoreAfter && ctx.side) {
    const d = ctx.side === "home" ? 1 : 0;
    const got = p.scoreAfter[d]! - prev[d]!;
    if (p.outcome === "interception" && got >= 6) kinds.add("interception_return_td");
    else if (p.outcome === "fumble" && got >= 6) kinds.add("fumble_return_td");
    else if (got === 2 && p.call !== "punt" && p.call !== "field_goal" && !p.touchdown) kinds.add("safety");
  }
  return { kinds, scorer };
}

// ------------------------------------------------------------- one play

/**
 * Narrate one play as segments.
 *
 * Every number comes from the play (`gained`, `distance`, `ydstogo`, the spot
 * from `ballOn - gained`); every name from the attribution the engine
 * recorded, which is the same attribution the box score is built from.
 */
export function narratePlay(p: NarratedPlay, ctx: NarrationContext = {}): Seg[] {
  const { kinds, scorer } = scoredKinds(p, ctx);
  const g = Math.round(p.gained);
  const ag = Math.abs(g);
  const safety = kinds.has("safety");
  // "to the opp 35" / "at the opp 35"; a safety ends in the offence's own end zone
  const place = safety ? "their own end zone" : spotPhrase(Math.max(1, p.ballOn - p.gained));
  const to = `to ${place}`;
  const at = safety ? `in ${place}` : `at ${place}`;
  const pick = <T,>(salt: string, options: readonly T[]): T => choose(p, salt, options);

  if (p.call === "field_goal") return narrateKick(p, pick);
  if (p.call === "punt") return narratePunt(p, scorer);

  const Q = who(p.passer, "The quarterback");
  const R = who(p.targetOrRusher, "the receiver");
  const C = who(p.targetOrRusher, "The ball carrier");
  const D = p.defender ? { name: p.defender } : undefined;
  const T = p.tackler ? { name: p.tackler } : undefined;
  const body: Seg[] = [];
  const add = (...s: Seg[]): void => void body.push(...s);

  if (p.outcome === "interception") {
    const taken = kinds.has("interception_return_td");
    if (taken && D && scorer === D.name) add(...pick("i", [[D, " intercepts ", Q, " and returns it for a touchdown"], [D, " picks off ", Q, " and takes it back for a touchdown"]] as Seg[][]));
    else {
      if (D) add(...pick("i", [[Q, "'s pass is intercepted by ", D], [D, " intercepts ", Q], [D, " picks off ", Q]] as Seg[][]));
      else add(Q, "'s pass is intercepted");
      if (taken) add(...(scorer ? [" — ", { name: scorer }, " returns it for a touchdown"] : [" — returned for a touchdown"]));
    }
    return withTail(body, p, kinds);
  }

  if (p.outcome === "fumble") {
    if (p.call === "sack") {
      if (D) add(D, " sacks ", Q, " and forces a fumble");
      else add(Q, " is sacked and fumbles");
    } else {
      const carrier = p.call === "pass" ? R : p.call === "scramble" ? Q : C;
      add(carrier, g > 0 ? ` fumbles after a gain of ${yardsWord(ag)}` : " fumbles");
      if (D) add(", forced by ", D);
    }
    add(" — the defense recovers");
    if (kinds.has("fumble_return_td")) add(" and returns it for a touchdown");
    return withTail(body, p, kinds);
  }

  switch (p.call) {
    case "sack": {
      const loss = g < 0 ? `a loss of ${yardsWord(ag)}` : "no gain";
      if (D) add(...pick("s", [[D, " sacks ", Q, ` for ${loss}`], [Q, " is sacked by ", D, ` for ${loss}`], [D, " brings down ", Q, ` behind the line, ${loss}`]] as Seg[][]));
      else add(Q, ` is sacked for ${loss}`);
      if (!safety) add(`, back ${to}`);
      break;
    }
    case "scramble":
      if (p.touchdown) add(...pick("c", [[Q, ` scrambles ${yardsWord(ag)} for a touchdown`], [Q, ` keeps it and scores on a ${ag}-yard touchdown run`]] as Seg[][]));
      else add(...pick("c", [[Q, ` scrambles for ${gainText(g)} ${to}`], [Q, ` scrambles ${g >= 0 ? `for ${yardsWord(ag)}` : `for a loss of ${yardsWord(ag)}`}, ${to}`]] as Seg[][]));
      break;
    case "run":
      if (p.touchdown) add(...pick("r", [[C, ` scores on a ${ag}-yard touchdown run`], [C, ` takes it in for a ${ag}-yard touchdown`], [C, ` runs ${yardsWord(ag)} for the touchdown`]] as Seg[][]));
      else if (g > 0)
        add(
          ...pick("r", [
            [C, ` runs for ${yardsWord(ag)} ${to}`],
            [C, ` carries for a gain of ${yardsWord(ag)} ${to}`],
            [C, ` picks up ${yardsWord(ag)} on the ground ${to}`],
            ...(T ? [[C, ` rushes for ${yardsWord(ag)}, brought down by `, T, ` ${at}`] as Seg[]] : []),
          ] as Seg[][]),
        );
      else if (g === 0) add(...pick("r", [[C, ` is stopped for no gain ${at}`], [C, ` is held to no gain ${at}`]] as Seg[][]));
      else add(...pick("r", [[C, ` is stopped for a loss of ${yardsWord(ag)} ${at}`], [C, ` loses ${yardsWord(ag)} on the carry, back ${to}`]] as Seg[][]));
      break;
    default: {
      // a pass
      const incomplete = g === 0 && !p.touchdown && p.outcome === "incomplete";
      if (p.touchdown)
        add(...pick("t", [[Q, ` throws a ${ag}-yard touchdown pass to `, R], [Q, " finds ", R, ` for a ${ag}-yard touchdown`], [Q, " hits ", R, ` in the end zone, a ${ag}-yard touchdown`]] as Seg[][]));
      else if (incomplete) {
        const how = DEPTH[p.depth];
        const miss = D ? [", broken up by ", D] : [];
        add(
          ...pick("p", [
            [Q, "'s pass for ", R, " falls incomplete", ...(how ? [` (${how})`] : []), ...miss],
            [Q, " throws incomplete for ", R, ...(how ? [`, ${how}`] : []), ...miss],
            [Q, " cannot connect with ", R, ...miss],
          ] as Seg[][]),
        );
      } else {
        const gain = g > 0 ? `for ${yardsWord(ag)}` : g === 0 ? "for no gain" : `for a loss of ${yardsWord(ag)}`;
        add(
          ...pick("p", [
            [Q, " completes a pass to ", R, ` ${gain} ${to}`],
            [Q, " finds ", R, ` ${gain}, ${to}`],
            [Q, " connects with ", R, ` ${gain} ${to}`],
            ...(T ? [[Q, " to ", R, ` ${gain}, tackled by `, T, ` ${at}`] as Seg[]] : []),
          ] as Seg[][]),
        );
      }
    }
  }
  if (safety) add(" — SAFETY");
  return withTail(body, p, kinds);
}

function gainText(g: number): string {
  return g > 0 ? yardsWord(g) : g === 0 ? "no gain" : `a loss of ${yardsWord(Math.abs(g))}`;
}

/**
 * The ending every scrimmage play shares: what the play did to the series.
 * A touchdown, a pick-six and a fumble return already say so in the sentence.
 */
function withTail(body: Seg[], p: NarratedPlay, kinds: Set<string>): Seg[] {
  const out = [...body];
  if (p.touchdown) return out;
  if (kinds.has("interception_return_td") || kinds.has("fumble_return_td")) return out;
  if (p.firstDown) out.push(p.down >= 3 ? ` — converts ${ordinal(p.down)}-and-${Math.round(p.ydstogo)}` : " (1st down)");
  else if (!p.turnover && p.down === 4 && !kinds.has("safety")) out.push(" — turnover on downs"); // a fourth-down snap that did not move the chains hands the ball over
  return out;
}

function narrateKick(p: NarratedPlay, pick: <T>(salt: string, o: readonly T[]) => T): Seg[] {
  const K = who(p.kicker, "The kicker");
  const d = p.distance;
  const made = p.outcome === "made";
  if (d === undefined) return made ? [K, " kicks a field goal — it is good"] : [K, " misses the field goal"];
  return made
    ? pick("f", [[K, ` kicks a ${d}-yard field goal — it is good`], [`${d}-yard field goal by `, K, " is good"], [K, ` makes it from ${d} yards — the field goal is good`]] as Seg[][])
    : pick("f", [[K, ` misses a ${d}-yard field goal`], [`${d}-yard field goal attempt by `, K, " is no good"]] as Seg[][]);
}

function narratePunt(p: NarratedPlay, scorer: string | undefined): Seg[] {
  const P = who(p.kicker, "The punter");
  const R = who(scorer ?? p.returner, "the returner");
  const head: Seg[] = p.distance === undefined ? [P, " punts"] : [P, ` punts ${p.distance} yards`];
  switch (p.outcome) {
    case "touchback":
      return [...head, " — touchback"];
    case "return_td":
      return [...head, ", returned by ", R, " for a touchdown"];
    case "downed":
      return [...head, `, downed at ${receivingSpot(p)}`];
    case "fumbled":
      return [...head, ", and ", who(p.returner, "the returner"), " fumbles the return — recovered by the punting team"];
    default:
      return [...head, ", returned by ", who(p.returner, "the returner"), ` to ${receivingSpot(p)}`];
  }
}

/** Where a punt came to rest, named from the receiving team's end of the field (`gained` is measured to that spot). */
function receivingSpot(p: NarratedPlay): string {
  return spotPhrase(100 - p.ballOn + p.gained);
}

// ------------------------------------------------- events between snaps

const BUCKET_LABEL: Record<string, string> = {
  roughing_personal: "personal foul",
  defensive_presnap: "defensive pre-snap foul",
  offensive_procedure: "offensive procedure foul",
  other: "penalty",
};

const humanize = (bucket: string): string => BUCKET_LABEL[bucket] ?? bucket.replace(/_/g, " ");

const stateText = (s: { down: number; ydstogo: number; yardline100: number }): string => {
  const togo = Math.round(s.ydstogo);
  const dist = togo === 0 || togo >= Math.round(s.yardline100) ? "goal" : String(togo);
  return `${ordinal(s.down)} & ${dist} at ${spotPhrase(s.yardline100)}`;
};

/**
 * One line for something that happened between two traced snaps: an accepted
 * penalty, a spike, a kneel-down. `teams` names the home and away sides.
 */
export function narrateEvent(e: NarratedEvent, teams: { home: string; away: string }, playQuarter?: number): Seg[] {
  const team = e.team === 0 ? teams.home : teams.away;
  // a kneel that ends a half is logged before the next snap, which is in the next quarter: say when it was
  const when =
    e.quarter !== undefined && playQuarter !== undefined && e.quarter !== playQuarter
      ? `${e.quarter > 4 ? "OT" : `Q${e.quarter}`}${e.clock ? ` ${e.clock}` : ""} — `
      : "";
  if (e.type === "spike") return [`${when}${team} spike the ball to stop the clock`];
  if (e.type === "kneel") return [`${when}${team} take a knee`];
  if (e.type !== "penalty" || !e.before || !e.after) return [];
  const moved = Math.abs(e.after.yardline100 - e.before.yardline100);
  const side = e.onOffense ? "offense" : "defense";
  const label = humanize(e.bucket ?? "other");
  const yards = moved === 0 ? "no yardage" : yardsWord(moved);
  const result = e.automaticFirstDown ? `automatic first down, ${stateText(e.after)}` : stateText(e.after);
  return [`${when}Flag: ${label} on the ${team} ${side}, ${yards} — ${result}`];
}

/** A play with the lines that preceded it. */
export interface PlayNarration {
  /** accepted penalties, spikes and kneels since the previous snap, oldest first. */
  before: Seg[][];
  /** the play itself. */
  play: Seg[];
}

interface DriveLike {
  side: "home" | "away";
  plays: readonly (NarratedPlay & { eventsBefore?: readonly NarratedEvent[] | undefined })[];
}

/**
 * Narrate a whole broadcast: one `PlayNarration` per play, `[drive][play]`.
 *
 * This is the one entry point a screen or the engine needs. It supplies each
 * play's neighbour (the previous play's running score) so a game saved before
 * the engine logged scores still shows a defensive touchdown as one.
 */
export function narrateBroadcast(drives: readonly DriveLike[], teams: { home: string; away: string }): PlayNarration[][] {
  let prev: readonly [number, number] | undefined;
  return drives.map((d) =>
    d.plays.map((p) => {
      const out: PlayNarration = {
        before: (p.eventsBefore ?? []).map((e) => narrateEvent(e, teams, p.quarter)).filter((s) => s.length > 0),
        play: narratePlay(p, { prevScoreAfter: prev, side: d.side }),
      };
      prev = p.scoreAfter;
      return out;
    }),
  );
}

// ---------------------------------------------------- the scoring summary

/** The pieces of a logged score and its causing play that the summary line reads. */
export interface ScoreLineEvent {
  kind: string;
  points: number;
  scorer?: string | undefined;
}
export interface ScoreLinePlay {
  call: string;
  gained: number;
  passer?: string | undefined;
  targetOrRusher?: string | undefined;
  defender?: string | undefined;
  kicker?: string | undefined;
  distance?: number | undefined;
}

/** One line of the scoring summary for a logged score. Only what the event and its play carry. */
export function narrateScoreLine(e: ScoreLineEvent, p: ScoreLinePlay | undefined): string {
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
    case "safety":
      if (p?.call === "sack" && p.defender && p.passer) return `Safety — ${p.defender} sacks ${p.passer} in the end zone`;
      return "Safety";
    case "touchdown":
      if (p?.call === "pass") return `${p.passer ?? "The offense"} ${yds}-yard touchdown pass to ${p.targetOrRusher ?? "a receiver"}`;
      return `${p?.targetOrRusher ?? "The offense"} ${yds}-yard touchdown run`;
    default:
      return e.points === 1 ? "Extra point" : "Two-point conversion";
  }
}

