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

function inSeasonLine(s: LeagueState, code: string): string {
  const name = label(code);
  const rec = recordOf(s, code);
  const nextDraft = s.season + 1;
  const title = isHumansOnly(s) ? "the title" : "the Super Bowl";
  const { rank, of } = rankByOverall(s, code);
  const race = raceFor(s, code, weeksPlayed(s));
  const odds = playoffOdds(s, code);

  if (rec.games >= 3 && rec.w === 0 && rec.t === 0) {
    return `${name} is ${rec.text} and already looking at mock drafts for ${nextDraft}.`;
  }
  if (race?.eliminated) {
    return `${name} (${rec.text}) is out of the playoff picture — the ${nextDraft} draft board is open on the desk.`;
  }
  if (rank === 1 && (rec.games < 4 || rec.w / rec.games >= 0.55)) {
    return `${name} (${rec.text}) is the favorite to win ${title}, and everyone at the table knows it.`;
  }
  if (rank <= 3 && rec.games >= 4 && rec.w / rec.games >= 0.65) {
    return `${name} (${rec.text}) is a real contender for ${title}.`;
  }
  if (rec.games >= 3 && odds >= 90) return `${name} (${rec.text}) is all but in the playoffs and shopping for a ring.`;
  if (rec.games >= 3 && odds <= 20) return `${name} (${rec.text}) needs help and a miracle: ${odds}% to make the playoffs.`;
  if (rec.games >= 3) return `${name} (${rec.text}) is on the bubble at ${odds}% to make the playoffs.`;
  return `${name} has the ${ordinal(rank)}-best roster of ${of} on paper, and a season to prove it.`;
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
  return `${name} sits ${ordinal(rank)} of ${of} on roster strength.`;
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
