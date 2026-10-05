/**
 * The hot seat: whether a human GM keeps their job.
 *
 * Until now a GM held a franchise forever, however badly it went. After each
 * season, every human GM is given a job-security score from how the team
 * they run has done lately, and one who has run a team into the ground over
 * a few years is fired. A fired GM is not out of the game: they choose a new
 * team from the league's worst CPU-run franchises, a rebuild with nothing
 * to lose, and start their tenure there.
 *
 * The score (0–100) is read off the last five seasons with the current
 * team, and nothing from before it:
 *
 *   start 60, then for each of those seasons
 *     + 4 per win above .500 (a tie is half a win), - 4 per win below
 *     + 10 for making the playoffs, - 2 for missing them
 *     + 5 per playoff round won, + 15 for the title
 *
 *   >= 55 secure     40-54 warm     20-39 hot seat     < 20 fired
 *
 * then, for a GM three or more seasons in, a playoff drought: every
 * consecutive season ending with no playoff win beyond the second costs 10
 * more (three in a row -10, four -20, five -30). A team that loses its
 * wild-card game every year has still won nothing, and that's how the league
 * treats it: front offices rarely last long on a run of winless Januaries.
 *
 * and nobody is fired before their third season with a team, which also
 * leaves the Hooded Figure (two losing seasons running) time to act first.
 * Two 5-12 years leave a GM at 28 (hot); a third ends it (12). Three 3-14
 * years end it at once. Five 8-9 years with no playoffs sit at 40: warm,
 * never in danger. A long run of good seasons is a cushion: five winning
 * years take a few bad ones to spend.
 *
 * The score is computed from `state.history`, so it needs nothing saved
 * between seasons and cannot drift.
 */
import type { LeagueState, SeasonOutcome } from "@/domain";

export type SecurityLevel = "secure" | "warm" | "hot" | "fired";

export interface HotSeatSeason {
  season: number;
  wins: number;
  losses: number;
  ties: number;
  playoffs: boolean;
  /** playoff rounds won (a bye counts as none) */
  roundsWon: number;
  champion: boolean;
  delta: number;
}

export interface HotSeatEntry {
  gmId: string;
  teamCode: string;
  score: number;
  level: SecurityLevel;
  /** seasons with this team, newest last, at most the three that count */
  seasons: HotSeatSeason[];
  /** total seasons with this team */
  tenure: number;
  /** consecutive latest seasons without a playoff win (a missed postseason counts) */
  drought: number;
  /** what the drought took off the score (0 until the third season of it) */
  droughtPenalty: number;
  /** teams a fired GM may take over, worst first */
  options: string[];
  /** the team a fired GM has taken */
  chosen?: string;
}

export interface HotSeatState {
  /** the season whose results these are */
  season: number;
  entries: HotSeatEntry[];
}

const START = 60;
const WINDOW = 5;
const MIN_TENURE_TO_FIRE = 3;
/** the drought starts to cost from the third winless season, 10 more for each after */
const DROUGHT_FROM = 3;
const DROUGHT_STEP = 10;
export const FIRE_BELOW = 20;
export const OPTION_COUNT = 5;

const ROUND_VALUE: Record<SeasonOutcome["furthestRound"], number> = { none: 0, WC: 0, DIV: 1, CONF: 2, SB: 3 };

/** One season's effect on job security. */
export function seasonDelta(o: SeasonOutcome): HotSeatSeason {
  const { wins, losses, ties } = o.regularSeasonRecord;
  const w = wins + ties / 2;
  const games = wins + losses + ties;
  const above = w - games / 2;
  // reaching the next round means winning the one before it; the title adds its own bonus
  const roundsWon = o.madePlayoffs ? ROUND_VALUE[o.furthestRound] : 0;
  const delta = above * 4 + (o.madePlayoffs ? 10 : -2) + roundsWon * 5 + (o.wonSuperBowl ? 15 : 0);
  return {
    season: o.season,
    wins,
    losses,
    ties,
    playoffs: o.madePlayoffs,
    roundsWon,
    champion: o.wonSuperBowl,
    delta: Math.round(delta * 10) / 10,
  };
}

/** The seasons this GM has run this team, oldest first, with no break and no other team in between. */
function tenureOf(s: LeagueState, gmId: string, teamCode: string): SeasonOutcome[] {
  const rows = s.history.filter((h) => h.gmId === gmId).sort((a, b) => b.season - a.season);
  const out: SeasonOutcome[] = [];
  for (const r of rows) {
    if (r.teamCode !== teamCode) break;
    out.push(r);
  }
  return out.reverse();
}

export function levelFor(score: number): SecurityLevel {
  return score >= 55 ? "secure" : score >= 40 ? "warm" : score >= FIRE_BELOW ? "hot" : "fired";
}

/** Where one human GM stands, as of the seasons in `history`. */
export function jobSecurity(s: LeagueState, gmId: string): Omit<HotSeatEntry, "options" | "chosen"> | null {
  const gm = s.gms.find((g) => g.id === gmId);
  if (!gm || !gm.isHuman || !gm.teamCode) return null;
  const tenure = tenureOf(s, gmId, gm.teamCode);
  if (tenure.length === 0) return null;
  const counted = tenure.slice(-WINDOW).map(seasonDelta);
  // consecutive latest seasons with no playoff win, over the whole tenure
  // (not just the five that score): the drought is a fact about the stretch
  let drought = 0;
  for (let i = tenure.length - 1; i >= 0 && seasonDelta(tenure[i]!).roundsWon === 0 && !tenure[i]!.wonSuperBowl; i--) drought++;
  const droughtPenalty = tenure.length >= MIN_TENURE_TO_FIRE && drought >= DROUGHT_FROM ? DROUGHT_STEP * (drought - DROUGHT_FROM + 1) : 0;
  const score = Math.max(0, Math.min(100, Math.round(START + counted.reduce((n, x) => n + x.delta, 0) - droughtPenalty)));
  let level = levelFor(score);
  // a new hire gets three seasons
  if (level === "fired" && tenure.length < MIN_TENURE_TO_FIRE) level = "hot";
  return { gmId, teamCode: gm.teamCode, score, level, seasons: counted, tenure: tenure.length, drought, droughtPenalty };
}

/**
 * The jobs a fired GM can take: the league's worst teams by last season's
 * record that no person is running, worst first.
 */
export function openJobs(s: LeagueState, exceptTeam: string): string[] {
  const season = s.season;
  const rows = s.teamSeasons?.filter((r) => r.season === season) ?? [];
  const rec = (code: string) => {
    const r = rows.find((x) => x.team === code);
    const t = s.teams[code]!;
    const w = r ? r.wins + r.ties / 2 : t.wins + t.ties / 2;
    const g = r ? r.wins + r.losses + r.ties : t.wins + t.losses + t.ties;
    return { pct: g ? w / g : 0.5, diff: r ? r.pointsFor - r.pointsAgainst : 0 };
  };
  return Object.keys(s.teams)
    .filter((c) => c !== exceptTeam && s.teams[c]!.controlledBy.kind === "ai")
    .sort((a, b) => rec(a).pct - rec(b).pct || rec(a).diff - rec(b).diff || a.localeCompare(b))
    .slice(0, OPTION_COUNT);
}

/**
 * Work out the hot seat for the season just played. Idempotent: it is made
 * once per season and then left alone, so a reload mid-stage keeps its
 * options and choices.
 */
export function ensureHotSeat(s: LeagueState): HotSeatState {
  if (s.hotSeat && s.hotSeat.season === s.season) return s.hotSeat;
  const entries: HotSeatEntry[] = [];
  for (const gm of s.gms) {
    const j = jobSecurity(s, gm.id);
    if (!j) continue;
    const options = j.level === "fired" ? openJobs(s, j.teamCode) : [];
    // nowhere to go (a league of people and nothing else): nobody can be fired
    entries.push(options.length === 0 && j.level === "fired" ? { ...j, level: "hot", options } : { ...j, options });
  }
  s.hotSeat = { season: s.season, entries };
  return s.hotSeat;
}

/** The fired GMs who have not yet picked a new team. */
export function awaitingNewJob(s: LeagueState): HotSeatEntry[] {
  return (s.hotSeat?.season === s.season ? s.hotSeat.entries : []).filter((e) => e.level === "fired" && !e.chosen);
}

export interface JobResult {
  ok: boolean;
  reason?: string;
  /** the team handed over, and the one left behind */
  teamCode?: string;
  left?: string;
}

/**
 * A fired GM takes over a team: the old one goes to the CPU, the new one
 * leaves it. Only the league document changes here; a server that tracks
 * seats elsewhere (`online/src/leagues.ts`) keeps its own record in step.
 */
export function takeNewJob(s: LeagueState, gmId: string, teamCode: string): JobResult {
  const entry = s.hotSeat?.season === s.season ? s.hotSeat.entries.find((e) => e.gmId === gmId) : undefined;
  if (!entry || entry.level !== "fired") return { ok: false, reason: "You haven't been fired." };
  if (entry.chosen) return { ok: false, reason: "You've already taken a new job." };
  if (!entry.options.includes(teamCode)) return { ok: false, reason: "That team isn't hiring." };
  const team = s.teams[teamCode];
  if (!team || team.controlledBy.kind !== "ai") return { ok: false, reason: "Someone else just took that team." };
  const gm = s.gms.find((g) => g.id === gmId);
  if (!gm) return { ok: false, reason: "No such GM." };
  const left = gm.teamCode;
  if (s.teams[left]) s.teams[left]!.controlledBy = { kind: "ai" };
  team.controlledBy = { kind: "human", gmId };
  gm.teamCode = teamCode;
  entry.chosen = teamCode;
  return { ok: true, teamCode, left };
}

/**
 * The best available job for a fired GM who didn't choose (away, or the
 * clock ran out): the worst team of those still open, as the autopilot
 * would take the pick.
 */
export function defaultJob(s: LeagueState, gmId: string): string | null {
  const entry = s.hotSeat?.season === s.season ? s.hotSeat.entries.find((e) => e.gmId === gmId) : undefined;
  if (!entry || entry.level !== "fired" || entry.chosen) return null;
  return entry.options.find((c) => s.teams[c]?.controlledBy.kind === "ai") ?? null;
}

/** Everyone fired and still unplaced takes their default job (called as the stage closes). */
export function placeUnemployed(s: LeagueState): { gmId: string; from: string; to: string }[] {
  const placed: { gmId: string; from: string; to: string }[] = [];
  for (const e of awaitingNewJob(s)) {
    const to = defaultJob(s, e.gmId);
    if (!to) continue;
    const r = takeNewJob(s, e.gmId, to);
    if (r.ok) placed.push({ gmId: e.gmId, from: r.left!, to });
  }
  return placed;
}
