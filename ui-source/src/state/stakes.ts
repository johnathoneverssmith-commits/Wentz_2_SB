import type { LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ordinal } from "@/util/format";

import { raceFor } from "./roasts";
import { isHumansOnly } from "./leagueFormat";
import { playoffOdds } from "./selectors";

/**
 * What is riding on the moment for each GM, in a line: the thing a person
 * staring at a waiting screen wants to know about the others they are waiting
 * on. Built only from what this client may see (records and rosters, never an
 * unwatched result), so a GM who is behind on reveals reads the same league
 * they would see on their hub.
 */
export interface Stake {
  teamCode: string;
  gmName: string;
  line: string;
}

const label = (code: string): string => TEAMS_BY_CODE[code]?.label ?? code;

const recordOf = (s: LeagueState, code: string): { w: number; l: number; t: number; games: number; text: string } => {
  const t = s.teams[code];
  const w = t?.wins ?? 0;
  const l = t?.losses ?? 0;
  const ties = t?.ties ?? 0;
  return { w, l, t: ties, games: w + l + ties, text: ties ? `${w}-${l}-${ties}` : `${w}-${l}` };
};

const SEASON_STAGES = new Set([
  "regularSeason",
  "tradeDeadline",
  "tradeDeadlineSummary",
  "midseasonFreeAgency",
  "midseasonFreeAgencySummary",
  "midseasonDepthChart",
  "playoffs",
]);

const DRAFT_STAGES = new Set(["fantasyDraft", "fantasyDraftSummary", "offseasonDraft", "offseasonDraftSummary"]);
const MARKET_STAGES = new Set(["freeAgency", "freeAgencySummary", "offseasonFreeAgency"]);

/** The regular-season weeks everyone has played so far (the table is only as far along as this client has watched). */
function weeksPlayed(s: LeagueState): number {
  let w = 0;
  for (const g of s.games) if (g.phase === "REG" && g.played && g.week > w) w = g.week;
  return w;
}

function capSpace(s: LeagueState, code: string): number {
  const c = s.teams[code]?.cap;
  return c ? c.total - c.used - (c.dead ?? 0) : 0;
}

function rankByOverall(s: LeagueState, code: string): { rank: number; of: number } {
  const all = Object.entries(s.teams)
    .map(([c, t]) => ({ c, v: t.ratings.overall }))
    .sort((a, b) => b.v - a.v || a.c.localeCompare(b.c));
  return { rank: all.findIndex((x) => x.c === code) + 1, of: all.length };
}

/** A small stable hash, so the same team reads the same line on every client until its situation changes. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pickOne = (options: string[], seed: string): string => options[hash(seed) % options.length]!;

/** The current run: +n wins in a row, -n losses in a row, from the games this client has seen. */
function streakOf(s: LeagueState, code: string): number {
  const mine = s.games
    .filter((g) => g.phase === "REG" && g.played && (g.homeTeam === code || g.awayTeam === code))
    .sort((a, b) => a.week - b.week);
  let run = 0;
  for (let i = mine.length - 1; i >= 0; i--) {
    const g = mine[i]!;
    const [f, a] = g.homeTeam === code ? [g.homeScore, g.awayScore] : [g.awayScore, g.homeScore];
    const r = f > a ? 1 : f < a ? -1 : 0;
    if (r === 0 || (run !== 0 && Math.sign(run) !== r)) break;
    run += r;
  }
  return run;
}

/**
 * What a team has riding on a week of the season, from where it actually
 * stands: record, rank on paper, playoff odds, division, streak, how late it
 * is. Every line states a situation the team is really in, so each one is
 * guarded: nothing calls an 8-0 team a bubble team, nothing calls a 3-6 team
 * a contender, and an early-season record is never read as a trend.
 */
function inSeasonLine(s: LeagueState, code: string): string {
  const name = label(code);
  const rec = recordOf(s, code);
  const nextDraft = s.season + 1;
  const title = isHumansOnly(s) ? "the title" : "the Super Bowl";
  const { rank, of } = rankByOverall(s, code);
  const race = raceFor(s, code, weeksPlayed(s));
  const odds = playoffOdds(s, code);
  const pct = rec.games ? (rec.w + 0.5 * rec.t) / rec.games : 0.5;
  const streak = streakOf(s, code);
  const t = s.teams[code];
  const week = weeksPlayed(s);
  const late = week >= 12;
  const seed = `${code}|${s.season}|${rec.text}|${week}`;
  const top = rank <= Math.ceil(of * 0.2);
  const bottom = rank > Math.floor(of * 0.7);
  const leadsDivision = !!t && t.divisionRank === 1 && rec.games >= 4;

  if (rec.games < 3) {
    return pickOne(
      [
        `${name} has the ${ordinal(rank)}-best roster of ${of} on paper, and a season to prove it.`,
        `${name} is ${rec.text}: too early to say anything, which never stopped anybody.`,
        `${name} is still writing the first chapter, with the ${ordinal(rank)}-best roster of ${of} on paper.`,
      ],
      seed,
    );
  }
  if (rec.w === 0 && rec.t === 0) return `${name} is ${rec.text} and already looking at mock drafts for ${nextDraft}.`;
  if (race?.eliminated) {
    return pickOne(
      [
        `${name} (${rec.text}) is out of the playoff picture — the ${nextDraft} draft board is open on the desk.`,
        `${name} (${rec.text}) is playing for pride, and for the ${nextDraft} draft slot.`,
        `${name} (${rec.text}) has nothing left to win, but every snap counts for the rebuild.`,
      ],
      seed,
    );
  }
  if (rank === 1 && pct >= 0.55) {
    return `${name} (${rec.text}) is the favorite to win ${title}, and everyone at the table knows it.`;
  }
  if (rec.l === 0 && rec.t === 0) {
    return pickOne(
      [
        `${name} is ${rec.text}, the league's last unbeaten story — every opponent wants to be the one.`,
        `${name} is still perfect at ${rec.text}, and the target on its back gets bigger every week.`,
      ],
      seed,
    );
  }
  if (pct >= 0.75) {
    return pickOne(
      [
        `${name} (${rec.text}) is off to the kind of start that makes the rest of the conference nervous${leadsDivision ? ", and it leads the division" : ""}.`,
        `${name} (${rec.text}) has the hot hand, and ${title} talk is starting.`,
        late
          ? `${name} (${rec.text}) is playing for seeding and home field now.`
          : `${name} (${rec.text}) is a real threat — the question is who can hang with it.`,
      ],
      seed,
    );
  }
  if (top && pct >= 0.6) {
    return pickOne(
      [
        `${name} (${rec.text}) is a real contender for ${title}.`,
        `${name} (${rec.text}) is playing like the ${ordinal(rank)}-best roster of ${of} it is: contender expectations, met.`,
      ],
      seed,
    );
  }
  if (bottom && pct >= 0.6) {
    return pickOne(
      [
        `${name} (${rec.text}) is the surprise of the year: ${ordinal(rank)} of ${of} on paper, winning anyway.`,
        `${name} (${rec.text}) is beating its roster — nobody drew this one up.`,
      ],
      seed,
    );
  }
  if (top && pct < 0.45) {
    return pickOne(
      [
        `${name} (${rec.text}) has a top-${rank} roster and a losing record — the coaching staff is hearing about it.`,
        `${name} (${rec.text}) needs a bounce-back: the talent says ${ordinal(rank)} of ${of}, the standings say otherwise.`,
        `${name} (${rec.text}) was supposed to be better, and the seat is starting to warm.`,
      ],
      seed,
    );
  }
  if (streak <= -3) {
    return `${name} (${rec.text}) has lost ${-streak} straight and needs something, anything, to stop the slide.`;
  }
  if (streak >= 3 && pct >= 0.5) {
    return `${name} (${rec.text}) has won ${streak} in a row and is climbing the board.`;
  }
  if (odds >= 90) return `${name} (${rec.text}) is all but in the playoffs and shopping for a ring.`;
  if (odds <= 20 && pct < 0.45) return `${name} (${rec.text}) needs help and a miracle: ${odds}% to make the playoffs.`;
  if (leadsDivision) {
    return pickOne(
      [
        `${name} (${rec.text}) leads the division and intends to keep it.`,
        `${name} (${rec.text}) sits atop the division, with the rest of it looking up.`,
      ],
      seed,
    );
  }
  if (late && odds >= 25 && odds <= 85) {
    return `${name} (${rec.text}) is in a must-win stretch: ${odds}% to make the playoffs with the season running out.`;
  }
  // a bubble team is a middling one: never a team the record says is winning or losing
  if (pct >= 0.35 && pct <= 0.65 && odds >= 25 && odds <= 75) {
    return pickOne(
      [
        `${name} (${rec.text}) is on the bubble at ${odds}% to make the playoffs.`,
        `${name} (${rec.text}) is in the thick of it: ${odds}% to make the playoffs and no margin for error.`,
      ],
      seed,
    );
  }
  if (pct < 0.4) return `${name} (${rec.text}) is fighting to stay relevant: ${odds}% to make the playoffs.`;
  if (pct > 0.6) return `${name} (${rec.text}) is in good shape at ${odds}% to make the playoffs, but the schedule is not done with it.`;
  return `${name} (${rec.text}) is ${ordinal(rank)} of ${of} on paper and in the middle of the pack.`;
}

function offseasonLine(s: LeagueState, code: string): string {
  const name = label(code);
  const { rank, of } = rankByOverall(s, code);

  if (DRAFT_STAGES.has(s.stage) && s.draft) {
    const first = s.draft.pickOrder.indexOf(code);
    if (first === 0) return `${name} has the first pick — the whole draft runs through them.`;
    if (first > 0 && s.draft.mode === "rookie" && first < 5) {
      return `${name} picks ${ordinal(first + 1)} overall — last year's results bought them this.`;
    }
    if (first > 0 && first === s.draft.pickOrder.length - 1) {
      return `${name} picks last in the round and still has to get something out of it.`;
    }
  }
  if (MARKET_STAGES.has(s.stage) || s.stage === "midseasonFreeAgency") {
    const spaces = Object.keys(s.teams)
      .map((c) => ({ c, v: capSpace(s, c) }))
      .sort((a, b) => b.v - a.v);
    const at = spaces.findIndex((x) => x.c === code);
    const millions = `$${(spaces[at]?.v ?? 0).toFixed(1)}M`;
    if (at === 0) return `${name} has the most cap room in the league (${millions}) and the market knows it.`;
    if (at === spaces.length - 1) return `${name} is the most squeezed team in the league (${millions} of room) — every dollar counts.`;
  }
  if (rank === 1) return `${name} has the best roster in the league on paper — and everyone is gunning for it.`;
  if (rank >= of - 2) return `${name} has one of the league's three weakest rosters on paper, and a lot of work to do.`;
  return pickOne(
    [
      `${name} sits ${ordinal(rank)} of ${of} on roster strength.`,
      rank <= Math.ceil(of * 0.25)
        ? `${name} is expected to contend: ${ordinal(rank)} of ${of} on paper.`
        : rank > Math.floor(of * 0.65)
          ? `${name} is a long shot on paper (${ordinal(rank)} of ${of}) and has the most to prove.`
          : `${name} is a team in the middle of the pack, one good offseason from something more.`,
    ],
    `${code}|${s.season}|${s.stage}`,
  );
}

/** One line on what a team has riding on this moment. */
export function stakeFor(s: LeagueState, code: string): string {
  return SEASON_STAGES.has(s.stage) ? inSeasonLine(s, code) : offseasonLine(s, code);
}

/** A line for every human GM's team — the people a waiting screen is waiting on. */
export function waitingStakes(s: LeagueState): Stake[] {
  return s.gms
    .filter((g) => g.isHuman && g.teamCode && s.teams[g.teamCode])
    .map((g) => ({ teamCode: g.teamCode, gmName: g.name, line: stakeFor(s, g.teamCode) }));
}
