/**
 * Postgame recap (PBP-4).
 *
 * A pure function of a finished game's record: what the box score already
 * keeps (final score, scoring by quarter, the scoring summary, each player's
 * recorded line) and, when the game still has it, the full broadcast. It runs
 * nothing, draws nothing and reads no clock, so it can be rebuilt from a stored
 * record without replaying the game, and the same record gives the same recap in
 * single-player and online and after a reload.
 *
 * Every sentence is built from a fact in the record:
 *
 * - **Scores and times** come from the score timeline (the engine's own score
 *   log on a broadcast, the scoring summary otherwise).
 * - **Names and numbers** come from the recorded player lines and the scoring
 *   plays' own descriptions. A statistic is quoted as recorded and never derived,
 *   rounded up, or ranked on anything the record does not carry.
 * - **Nothing about motive or feeling.** "Rallied" means the winner trailed by
 *   the amount stated; "put it away" means the lead stayed beyond a score to the
 *   end; no one "wanted" anything.
 *
 * The depth follows the data. A game kept with its plays gets its key moments
 * from the highlight analysis; one kept with only a scoring summary gets them
 * from the summary; one kept with only a final score gets the result and, if
 * the quarter scores are there, the shape of the scoring.
 */
import {
  type GameCast,
  type Highlight,
  type LeadStory,
  type ScoreStep,
  analyzeGame,
  highlightText,
  leadStory,
  stepContext,
  stepTags,
  timelineFromScoringPlays,
} from "./highlights.js";
import { narrateScoreLine } from "./narration.js";

// ------------------------------------------------------------------ input

/** A player's recorded game line (structural: the box score's `PlayerGameLine`). */
export interface RecapLine {
  name: string;
  position: string;
  passCmp?: number | undefined;
  passAtt?: number | undefined;
  passYds?: number | undefined;
  passTd?: number | undefined;
  passInt?: number | undefined;
  rushAtt?: number | undefined;
  rushYds?: number | undefined;
  rushTd?: number | undefined;
  rec?: number | undefined;
  recYds?: number | undefined;
  recTd?: number | undefined;
  tackles?: number | undefined;
  sacks?: number | undefined;
  defInt?: number | undefined;
  passDef?: number | undefined;
  ffum?: number | undefined;
  fgm?: number | undefined;
  fga?: number | undefined;
}

export interface RecapSource {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** "PRE" | "REG" | "WC" | "DIV" | "CONF" | "SB" */
  phase?: string | undefined;
  week?: number | undefined;
  totals?: { home: { byQuarter: readonly number[] }; away: { byQuarter: readonly number[] } } | undefined;
  scoringPlays?: readonly { quarter: number; team: string; description: string; homeScore: number; awayScore: number }[] | undefined;
  playerLines?: { home: readonly RecapLine[]; away: readonly RecapLine[] } | undefined;
  /** the play-by-play, when the record still has it. */
  broadcast?: GameCast | undefined;
}

export interface RecapOptions {
  /** how to name a team in prose; defaults to its code. */
  teamName?: ((code: string) => string) | undefined;
}

// ------------------------------------------------------------------ output

export type RecapKind =
  | "tie"
  | "overtime"
  | "comeback"
  | "blowout"
  | "shootout"
  | "defensive_struggle"
  | "close"
  | "defensive_score"
  | "special_teams_score"
  | "wire_to_wire";

export interface Standout {
  team: string;
  name: string;
  position: string;
  role: "passing" | "rushing" | "receiving" | "defense" | "kicking";
  /** the recorded line, e.g. "24/35, 312 yds, 3 TD, 1 INT". */
  line: string;
}

export interface KeyMoment {
  quarter: number;
  clock?: string | undefined;
  team: string;
  /** the play in plain words (the shared narration, or the scoring summary's line). */
  text: string;
  /** why it mattered, in the score and the clock. */
  why: string;
}

export interface Recap {
  headline: string;
  kinds: RecapKind[];
  /** what the recap rests on: the full broadcast, the scoring summary, or the final score alone. */
  basis: "broadcast" | "scoring_summary" | "final_score";
  paragraphs: string[];
  standouts: Standout[];
  keyMoments: KeyMoment[];
  facts: {
    winner: string | null;
    margin: number;
    total: number;
    overtime: boolean;
    leadChanges: number;
    winnerTrailedBy: number | null;
  };
}

// ---------------------------------------------------------------- helpers

/** FNV-1a: the same stable hash the narration picks wording with. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const quarterWord = (q: number): string =>
  q >= 5 ? "overtime" : `the ${q === 1 ? "first" : q === 2 ? "second" : q === 3 ? "third" : "fourth"} quarter`;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function roundPhrase(phase: string | undefined, week: number | undefined): string {
  switch (phase) {
    case "SB":
      return " in the Super Bowl";
    case "CONF":
      return " in the conference championship game";
    case "DIV":
      return " in the divisional round";
    case "WC":
      return " in the wild-card round";
    case "PRE":
      return week ? ` (preseason week ${week})` : " (preseason)";
    case "REG":
      return week ? ` (Week ${week})` : "";
    default:
      return "";
  }
}

// -------------------------------------------------------------- standouts

const num = (n: number | undefined): number => n ?? 0;

function passingLine(l: RecapLine): string {
  const parts = [`${num(l.passCmp)}/${num(l.passAtt)}`, `${num(l.passYds)} yds`];
  if (num(l.passTd)) parts.push(`${l.passTd} TD`);
  if (num(l.passInt)) parts.push(`${l.passInt} INT`);
  return parts.join(", ");
}
function rushingLine(l: RecapLine): string {
  const parts = [`${num(l.rushAtt)} carries`, `${num(l.rushYds)} yds`];
  if (num(l.rushTd)) parts.push(`${l.rushTd} TD`);
  return parts.join(", ");
}
function receivingLine(l: RecapLine): string {
  const parts = [`${num(l.rec)} catches`, `${num(l.recYds)} yds`];
  if (num(l.recTd)) parts.push(`${l.recTd} TD`);
  return parts.join(", ");
}
function defenseLine(l: RecapLine): string {
  const parts: string[] = [];
  if (num(l.sacks)) parts.push(plural(num(l.sacks), "sack"));
  if (num(l.defInt)) parts.push(plural(num(l.defInt), "interception"));
  if (num(l.ffum)) parts.push(plural(num(l.ffum), "forced fumble"));
  if (num(l.passDef)) parts.push(plural(num(l.passDef), "pass defended", "passes defended"));
  if (num(l.tackles)) parts.push(plural(num(l.tackles), "tackle"));
  return parts.join(", ");
}

/**
 * Who stood out, from the recorded lines only: each team's top passer, top
 * rusher and top receiver when the numbers are worth a mention, and a defender
 * with sacks, takeaways or forced fumbles. Ties break on the name, so the same
 * lines always give the same list.
 */
export function standoutsFrom(
  lines: { home: readonly RecapLine[]; away: readonly RecapLine[] },
  teams: { home: string; away: string },
): Standout[] {
  const out: Standout[] = [];
  for (const side of ["home", "away"] as const) {
    const team = teams[side];
    const ls = lines[side];
    const best = (score: (l: RecapLine) => number, keep: (l: RecapLine) => boolean): RecapLine | undefined =>
      [...ls].filter(keep).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0];
    const qb = best((l) => num(l.passYds), (l) => num(l.passAtt) >= 8);
    if (qb) out.push({ team, name: qb.name, position: qb.position, role: "passing", line: passingLine(qb) });
    const rb = best((l) => num(l.rushYds) + 40 * num(l.rushTd), (l) => num(l.rushYds) >= 40 || num(l.rushTd) >= 1);
    if (rb) out.push({ team, name: rb.name, position: rb.position, role: "rushing", line: rushingLine(rb) });
    const wr = best((l) => num(l.recYds) + 40 * num(l.recTd), (l) => num(l.recYds) >= 60 || num(l.recTd) >= 2);
    if (wr) out.push({ team, name: wr.name, position: wr.position, role: "receiving", line: receivingLine(wr) });
    const worth = (l: RecapLine): number => 2 * num(l.sacks) + 3 * num(l.defInt) + 2 * num(l.ffum);
    const d = best(worth, (l) => num(l.sacks) >= 2 || num(l.defInt) >= 1 || num(l.ffum) >= 2);
    if (d) out.push({ team, name: d.name, position: d.position, role: "defense", line: defenseLine(d) });
  }
  return out;
}

// --------------------------------------------------------------- the recap

/** The score at the end of regulation, from the steps. */
function regulationScore(steps: readonly ScoreStep[]): [number, number] {
  let h = 0;
  let a = 0;
  for (const s of steps) if (s.quarter <= 4) [h, a] = [s.home, s.away];
  return [h, a];
}

export function buildRecap(src: RecapSource, opts: RecapOptions = {}): Recap {
  const name = (c: string): string => opts.teamName?.(c) ?? c;
  const teamOfSide = (s: "home" | "away"): string => (s === "home" ? src.homeTeam : src.awayTeam);
  const final: [number, number] = [src.homeScore, src.awayScore];
  const winnerSide: "home" | "away" | null = final[0] === final[1] ? null : final[0] > final[1] ? "home" : "away";
  const loserSide = winnerSide === null ? null : winnerSide === "home" ? "away" : "home";
  const hiScore = Math.max(...final);
  const loScore = Math.min(...final);
  const margin = hiScore - loScore;
  const total = hiScore + loScore;
  const cast = src.broadcast;
  const rows = src.scoringPlays;

  const basis: Recap["basis"] = cast ? "broadcast" : rows && rows.length > 0 ? "scoring_summary" : "final_score";
  const analysis = cast ? analyzeGame(cast) : null;
  const steps: ScoreStep[] = analysis ? analysis.steps : rows ? timelineFromScoringPlays(rows, src.homeTeam) : [];
  const story: LeadStory = analysis ? analysis.story : leadStory(steps, final);
  const overtime = story.overtime || (src.totals?.home.byQuarter.length ?? 4) > 4;

  // ---- what kind of game it was
  const kinds: RecapKind[] = [];
  if (winnerSide === null) kinds.push("tie");
  if (overtime) kinds.push("overtime");
  const trailed = story.winnerTrailedBy;
  if (trailed && trailed.amount >= 10) kinds.push("comeback");
  if (margin >= 21) kinds.push("blowout");
  if (total >= 65) kinds.push("shootout");
  if (total <= 24) kinds.push("defensive_struggle");
  if (winnerSide && margin <= 3 && !overtime) kinds.push("close");
  const stepKinds = steps.map((s) => s.kind);
  if (stepKinds.some((k) => k === "interception_return_td" || k === "fumble_return_td" || k === "safety")) kinds.push("defensive_score");
  if (stepKinds.some((k) => k === "punt_return_td" || k === "kick_return_td")) kinds.push("special_teams_score");
  if (winnerSide && steps.length > 0 && story.finalLeadStep === null && story.leadChanges === 0 && story.ties === 0 && steps[0]!.side === winnerSide && !overtime) kinds.push("wire_to_wire");

  const seed = `${src.homeTeam}|${src.awayTeam}|${src.homeScore}|${src.awayScore}|${src.week ?? ""}|${src.phase ?? ""}`;
  const pick = <T>(salt: string, options: readonly T[]): T => options[hash(seed + salt) % options.length]!;

  // ---- how a step reads in the winner's words
  const describeStep = (i: number): string => {
    const s = steps[i]!;
    if (cast && s.drive !== undefined && s.play !== undefined) {
      const p = cast.drives[s.drive]?.plays[s.play];
      return narrateScoreLine({ kind: s.kind, points: s.points, scorer: s.scorer }, s.kind === "kick_return_td" ? undefined : p);
    }
    return rows ? (rows.find((r) => r.homeScore === s.home && r.awayScore === s.away && r.quarter === s.quarter)?.description ?? "a score") : "a score";
  };
  const whenOf = (s: ScoreStep): string =>
    s.quarter >= 5 ? "in overtime" : s.quarter === 4 && s.clock !== undefined && toSecs(s.clock) <= 600 ? `with ${s.clock} left` : `in ${quarterWord(s.quarter)}`;

  // ---- headline
  const W = winnerSide ? name(teamOfSide(winnerSide)) : "";
  const L = loserSide ? name(teamOfSide(loserSide)) : "";
  const score = `${hiScore}–${loScore}`;
  let headline: string;
  if (winnerSide === null) headline = `${name(src.homeTeam)} and ${name(src.awayTeam)} play to a ${src.homeScore}–${src.awayScore} tie`;
  else if (kinds.includes("overtime")) headline = pick("h", [`${W} outlast ${L} ${score} in overtime`, `${W} beat ${L} ${score} in overtime`]);
  else if (kinds.includes("comeback")) headline = pick("h", [`${W} rally from ${trailed!.amount} down to beat ${L}, ${score}`, `${W} come back to beat ${L} ${score}`]);
  else if (kinds.includes("blowout")) headline = pick("h", [`${W} roll past ${L}, ${score}`, `${W} cruise past ${L} ${score}`, `${W} rout ${L}, ${score}`]);
  else if (kinds.includes("shootout")) headline = pick("h", [`${W} win a ${total}-point shootout over ${L}, ${score}`, `${W} outscore ${L} ${score} in a shootout`]);
  else if (kinds.includes("defensive_struggle")) headline = pick("h", [`${W} win a defensive struggle over ${L}, ${score}`, `${W} edge ${L} ${score} in a low-scoring game`]);
  else if (kinds.includes("close")) headline = pick("h", [`${W} hold off ${L}, ${score}`, `${W} edge ${L} ${score}`]);
  else headline = pick("h", [`${W} beat ${L} ${score}`, `${W} top ${L} ${score}`, `${W} defeat ${L}, ${score}`]);

  const paragraphs: string[] = [];

  // ---- the result
  const round = roundPhrase(src.phase, src.week);
  if (winnerSide === null) {
    paragraphs.push(`${name(src.homeTeam)} and ${name(src.awayTeam)} finished level at ${src.homeScore}${round}${overtime ? ", with overtime unable to separate them" : ""}.`);
  } else {
    const verb = pick("v", ["beat", "defeated", "topped"]);
    const playoff = src.phase === "SB" || src.phase === "CONF" || src.phase === "DIV" || src.phase === "WC";
    const title = src.phase === "SB" ? " and are the champions" : "";
    paragraphs.push(
      playoff
        ? `${W} ${verb} ${L} ${score}${overtime ? " in overtime" : ""}${round}${title}.`
        : `${W} ${verb} ${L} ${score}${overtime ? " in overtime" : ""}${round}.`,
    );
  }

  // ---- how it unfolded
  const flow: string[] = [];
  if (steps.length > 0) {
    flow.push(`${name(teamOfSide(steps[0]!.side))} scored first, ${steps[0]!.side === "home" ? `${steps[0]!.home}–${steps[0]!.away}` : `${steps[0]!.away}–${steps[0]!.home}`}.`);
    const [hh, ha] = story.half;
    const halfText = hh === ha ? `The teams were level at ${hh} at the half.` : `${name(teamOfSide(hh > ha ? "home" : "away"))} led ${Math.max(hh, ha)}–${Math.min(hh, ha)} at the half.`;
    flow.push(halfText);
    const changes = story.leadChanges;
    if (changes >= 2) flow.push(`The lead changed hands ${changes} times${story.ties ? ` and the score was level ${plural(story.ties, "time")}` : ""}.`);
    else if (changes === 1) flow.push(story.ties ? `The lead changed hands once and the score was level ${plural(story.ties, "time")}.` : "The lead changed hands once.");
    else if (story.ties >= 2) flow.push(`The score was level ${plural(story.ties, "time")} without the lead ever changing hands.`);
  } else if (src.totals) {
    const h = src.totals.home.byQuarter;
    const a = src.totals.away.byQuarter;
    const hHalf = (h[0] ?? 0) + (h[1] ?? 0);
    const aHalf = (a[0] ?? 0) + (a[1] ?? 0);
    flow.push(hHalf === aHalf ? `The teams were level at ${hHalf} at the half.` : `${name(hHalf > aHalf ? src.homeTeam : src.awayTeam)} led ${Math.max(hHalf, aHalf)}–${Math.min(hHalf, aHalf)} at the half.`);
  }
  if (winnerSide && trailed && trailed.amount >= 7) {
    flow.push(`${W} trailed by ${trailed.amount} in ${quarterWord(trailed.quarter)} before coming back.`);
  }
  if (winnerSide && story.finalLeadStep !== null && !overtime) {
    const s = steps[story.finalLeadStep]!;
    if (s.quarter >= 4) flow.push(`The go-ahead score came ${whenOf(s)}: ${describeStep(story.finalLeadStep)}.`);
    else flow.push(`${W} took the lead for good in ${quarterWord(s.quarter)}.`);
  } else if (winnerSide && story.putAwayStep !== null && !overtime) {
    const s = steps[story.putAwayStep]!;
    flow.push(`${W} put it away ${whenOf(s)}: ${describeStep(story.putAwayStep)}, making it ${s.side === winnerSide ? Math.max(s.home, s.away) : Math.min(s.home, s.away)}–${s.side === winnerSide ? Math.min(s.home, s.away) : Math.max(s.home, s.away)}.`);
  }
  if (flow.length) paragraphs.push(flow.join(" "));

  // ---- the finish
  const finish: string[] = [];
  if (overtime && steps.length) {
    const [rh, ra] = regulationScore(steps);
    finish.push(`The teams were tied at ${Math.min(rh, ra) === Math.max(rh, ra) ? rh : `${rh}–${ra}`} after regulation.`);
    const last = steps.length - 1;
    if (winnerSide && steps[last]!.quarter >= 5) finish.push(`${W} won it ${whenOf(steps[last]!)}: ${describeStep(last)}.`);
  } else if (steps.length && winnerSide) {
    const [h3, a3] = story.threeQuarters;
    if (Math.abs(h3 - a3) <= 8 && margin <= 8) finish.push("It was still a one-score game entering the fourth quarter.");
    else if (Math.abs(h3 - a3) <= 8 && margin > 8) finish.push("It was a one-score game entering the fourth quarter before one side pulled away.");
  }
  const q4 = steps.filter((s) => s.quarter === 4);
  if (q4.length > 0 && winnerSide && !overtime) {
    const pts = { home: 0, away: 0 };
    for (const s of q4) pts[s.side] += s.points;
    const lastQ4 = steps.indexOf(q4[q4.length - 1]!);
    const leaderSide = pts.home === pts.away ? null : pts.home > pts.away ? "home" : "away";
    finish.push(
      leaderSide
        ? `${name(teamOfSide(leaderSide))} outscored ${name(teamOfSide(leaderSide === "home" ? "away" : "home"))} ${Math.max(pts.home, pts.away)}–${Math.min(pts.home, pts.away)} in the fourth quarter.`
        : `The fourth quarter was even, ${pts.home}–${pts.away}.`,
    );
    finish.push(`The last score of the game came ${whenOf(steps[lastQ4]!)}: ${describeStep(lastQ4)}.`);
  }
  if (finish.length) paragraphs.push(finish.join(" "));

  // ---- defensive and special-teams scores
  const odd = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => ["interception_return_td", "fumble_return_td", "punt_return_td", "kick_return_td", "safety"].includes(s.kind))
    .slice(0, 3);
  if (odd.length) {
    const sentences = odd.map(({ s }) => {
      const T = name(teamOfSide(s.side));
      const when = `in ${quarterWord(s.quarter)}`;
      switch (s.kind) {
        case "interception_return_td":
          return s.scorer ? `${s.scorer} returned an interception for a touchdown ${when}` : `${T} scored on an interception return ${when}`;
        case "fumble_return_td":
          return `${T} scored on a fumble return ${when}`;
        case "punt_return_td":
          return s.scorer ? `${s.scorer} returned a punt for a touchdown ${when}` : `${T} scored on a punt return ${when}`;
        case "kick_return_td":
          return `${T} returned a kickoff for a touchdown ${when}`;
        default:
          return `${T} added a safety ${when}`;
      }
    });
    paragraphs.push(`${sentences.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()));
  }

  // ---- standouts, from the recorded lines
  const standouts = src.playerLines ? standoutsFrom(src.playerLines, { home: src.homeTeam, away: src.awayTeam }) : [];
  const lead = standouts.find((x) => x.role === "passing" && x.team === (winnerSide ? teamOfSide(winnerSide) : src.homeTeam)) ?? standouts.find((x) => x.role === "passing");
  if (lead) paragraphs.push(`${lead.name} finished ${lead.line} for ${name(lead.team)}.`);

  // ---- key moments
  const keyMoments = analysis ? momentsFromAnalysis(analysis.highlights, analysis.candidates) : momentsFromSteps(steps, story, name, teamOfSide, describeStep);

  return {
    headline,
    kinds,
    basis,
    paragraphs,
    standouts,
    keyMoments,
    facts: { winner: winnerSide ? teamOfSide(winnerSide) : null, margin, total, overtime, leadChanges: story.leadChanges, winnerTrailedBy: trailed ? trailed.amount : null },
  };
}

const toSecs = (c: string): number => {
  const [m, s] = c.split(":");
  return (Number(m) || 0) * 60 + (Number(s) || 0);
};

/** Three to five moments from the highlight analysis, in the order they happened. */
function momentsFromAnalysis(selected: readonly Highlight[], all: readonly Highlight[]): KeyMoment[] {
  const picked: Highlight[] = [...selected].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5);
  // a game that ended in the fourth quarter or overtime shows at least one moment from there, the biggest one
  if (picked.length > 1 && !picked.some((h) => h.quarter >= 4)) {
    const late = [...all].filter((h) => h.quarter >= 4).sort((a, b) => b.significance - a.significance)[0];
    if (late && late.significance >= 30) picked.splice(picked.length - 1, 1, late);
  }
  // a short list of fewer than three is topped up with the next biggest moments, whatever their size
  if (picked.length < 3) {
    for (const h of [...all].sort((a, b) => b.significance - a.significance)) {
      if (picked.length >= 3) break;
      if (!picked.includes(h)) picked.push(h);
    }
  }
  return picked
    .sort((a, b) => all.indexOf(a) - all.indexOf(b))
    .map((h) => ({ quarter: h.quarter, clock: h.clock, team: h.team, text: highlightText(h), why: h.context }));
}

/** The same, from a scoring summary alone: the scores that changed the lead, then the biggest of the rest. */
function momentsFromSteps(
  steps: readonly ScoreStep[],
  story: LeadStory,
  name: (c: string) => string,
  teamOfSide: (s: "home" | "away") => string,
  describe: (i: number) => string,
): KeyMoment[] {
  if (steps.length === 0) return [];
  const scored = steps.map((s, i) => {
    const tags = stepTags(steps, i);
    let v = 10 + s.points + s.quarter * 2;
    if (i === story.finalLeadStep) v += 60;
    if (story.overtime && i === steps.length - 1) v += 70;
    if (tags.includes("lead_change")) v += 30;
    if (tags.includes("tying")) v += 22;
    if (i === story.putAwayStep) v += 25;
    if (["interception_return_td", "fumble_return_td", "punt_return_td", "kick_return_td", "safety"].includes(s.kind)) v += 25;
    return { s, i, v, tags };
  });
  const top = [...scored].sort((a, b) => b.v - a.v || a.i - b.i).slice(0, Math.min(5, Math.max(3, steps.length >= 3 ? 3 : steps.length)));
  return top
    .sort((a, b) => a.i - b.i)
    .map(({ s, i, tags }) => ({
      quarter: s.quarter,
      clock: s.clock,
      team: teamOfSide(s.side),
      text: describe(i),
      why: stepContext(steps, i, (side) => name(teamOfSide(side)), tags, story),
    }));
}

