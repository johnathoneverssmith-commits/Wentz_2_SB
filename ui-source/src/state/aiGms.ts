/**
 * The CPU general managers: named people with a philosophy and a skill.
 *
 * A strategy used to be a hash of the team and the season, so a franchise's
 * philosophy changed every year and belonged to nobody. Now it belongs to the
 * GM, and goes where the GM goes. Its job is unchanged: to make rosters
 * differ, so the league is not 32 copies of one idea and the results are not
 * left to chance alone.
 *
 *  - There are more CPU GMs than CPU teams. The ones without a job wait in a
 *    pool.
 *  - Each GM's skill is a draw from a normal curve around their difficulty's
 *    level. The best of a "Competitive" league's GMs are close to Expert and
 *    the worst close to Standard (`effectiveLevel`).
 *  - After every season the hot seat's score (`hotSeat.ts`) is applied to the
 *    CPU GMs as it is to people. A fired GM joins the pool, and the team hires
 *    someone who has not worked lately, with a different philosophy.
 *
 * Nothing here draws from the game's RNG: every pick is a hash of the league's
 * seed and the season, so a save/reload or a second server derives the same
 * league.
 */
import type { AiGm, AiGmMove, Difficulty, LeagueState, SeasonOutcome } from "@/domain";

import { type AiDifficultyProfile, difficultyProfile, difficultyProfileAt, levelIndex } from "./aiDifficulty.ts";
import { AI_SEASON_STRATEGIES, type AiSeasonStrategy, strategyFor } from "./aiStrategy.ts";
import { securityOfTenure } from "./hotSeat.ts";
import { seasonOutcomeFor } from "./seasonOutcome.ts";

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
const unit = (key: string): number => hash(key) / 0x100000000;

/** A draw from a bell curve (four uniforms, then clipped): about +-2.2 at the edges. */
function normal(key: string): number {
  const sum = unit(`${key}|a`) + unit(`${key}|b`) + unit(`${key}|c`) + unit(`${key}|d`);
  return Math.max(-2.2, Math.min(2.2, (sum - 2) / Math.sqrt(4 / 12)));
}

/** How far a GM's skill moves them from their difficulty's level, in levels, per standard deviation. */
export const SKILL_SPREAD = 0.3;

/**
 * Where on the casual (0) to master (4) scale a GM plays: their difficulty's
 * level, moved by their skill. The best (z about +2) is more than halfway to the
 * level above and the worst more than halfway to the one below, and nobody goes
 * past the ends of the scale.
 */
export function effectiveLevel(difficulty: Difficulty, skill: number): number {
  return Math.max(0, Math.min(4, levelIndex(difficulty) + SKILL_SPREAD * skill));
}

/** The CPU teams: those no person runs. */
function aiTeamCodes(s: LeagueState): string[] {
  return Object.keys(s.teams)
    .filter((c) => s.teams[c]!.controlledBy.kind === "ai")
    .sort();
}

/** Extra GMs beyond the CPU teams, so a firing always has somebody to hire. */
export function poolExtras(aiTeams: number): number {
  return Math.max(8, Math.ceil(aiTeams * 0.4));
}

// American first and last names, mostly the kind you would find running a regional
// car dealership. Plenty of them also run a football team.
const FIRST = [
  "Todd", "Chad", "Brett", "Gary", "Dale", "Rick", "Randy", "Wendell", "Duane", "Skip", "Buck", "Clint", "Darryl", "Earl", "Floyd",
  "Gene", "Hank", "Irv", "Jerry", "Kirk", "Lyle", "Merle", "Norm", "Orville", "Pete", "Rod", "Stu", "Tucker", "Vern", "Walt",
  "Chip", "Biff", "Brad", "Kyle", "Dwight", "Cliff", "Ron", "Larry", "Doug", "Mitch", "Troy", "Wade", "Cody", "Dustin", "Jeb",
  "Rusty", "Boone", "Cletus", "Dewey", "Ernie", "Frank", "Greg", "Hal", "Ike", "Jim", "Ken", "Lou", "Mike", "Ned", "Otis",
  "Phil", "Ray", "Sal", "Tim", "Brenda", "Donna", "Tammy", "Peggy", "Darlene", "Connie", "Barb", "Linda", "Sheryl", "Trish",
  "Marge", "Gail", "Joyce", "Carol", "Dot", "Faye", "Renee", "Tasha", "Monique", "Keisha", "Priya", "Maria", "Lupe", "Mei",
  "Dana", "Jordan", "Casey", "Taylor", "Kelsey", "Brandon", "Marcus", "Terrance", "Javier", "Hector", "Dmitri", "Sven",
];
const LAST = [
  "Henderson", "Thompson", "Sullivan", "Murphy", "Gallagher", "Brannigan", "O'Malley", "Pickett", "Tuttle", "Fitzgerald",
  "Dunleavy", "Spivey", "Lundgren", "Bledsoe", "Hatfield", "McCoy", "Tanner", "Boudreaux", "Ledbetter", "Crabtree",
  "Stokes", "Pruitt", "McAllister", "Kowalski", "Buckley", "Jenkins", "Whitmore", "Butterworth", "Pennywhistle", "Gutierrez",
  "Nguyen", "Washington", "Okafor", "Patel", "Kim", "Romano", "Delgado", "Abernathy", "Blankenship", "Cavanaugh", "Dillard",
  "Eckhart", "Fogarty", "Gilliam", "Hollister", "Ivers", "Jessup", "Kimball", "Lockhart", "Mulligan", "Nesbitt", "Oakley",
  "Pettibone", "Quigley", "Rasmussen", "Schaefer", "Tolliver", "Upshaw", "Vandenberg", "Wexler", "Yancey", "Zimmerman",
  "Barlow", "Cobb", "Dobbs", "Eubanks", "Fenwick", "Gaskill", "Hobbs", "Kessler", "Landry", "Mackey", "Nash", "Odom",
  "Pierce", "Rudd", "Sipes", "Trumble", "Voorhees", "Wickham", "Yost", "Zook",
];

// Most CPU GMs are just a name. Some are a name with a story.
const EPITHETS = [
  "the Great", "the Impaler", "the Terrible", "the Magnificent", "the Unemployed", "the Gambler", "the Cap Wizard", "the Patient",
  "the Unflappable", "the Optimistic", "the Haunted", "the Inevitable", "the Frugal", "the Reckless", "the Overpaid", "the Brief",
];
const NICKNAMES = [
  "No Picks", "Cap Space", "Two-Minute", "Trade Machine", "Fourth and Long", "Dumpster Fire", "Mad Dog", "Bulldozer", "Lucky",
  "Ledger", "Sunday", "Draft Day", "The Hammer", "Handshake", "Waiver Wire", "Blitz",
];
const PREFIXES = ["Big", "Mad Dog", "Little", "Honest", "Coach", "Slick", "Doc", "Deacon"];

function nameFor(seed: number, n: number, taken: Set<string>): string {
  for (let k = 0; k < 2500; k++) {
    const h = (tag: string, size: number): number => hash(`${seed}|${tag}|${n}|${k}`) % size;
    const first = FIRST[h("f", FIRST.length)]!;
    const last = LAST[h("l", LAST.length)]!;
    // the name's style: about half are plain, the rest have some character
    const roll = h("style", 100);
    let name: string;
    if (roll < 46) name = `${first} ${last}`;
    else if (roll < 60) name = `${first} "${NICKNAMES[h("nick", NICKNAMES.length)]}" ${last}`;
    else if (roll < 72) name = `${PREFIXES[h("pre", PREFIXES.length)]} ${first} ${last}`;
    else if (roll < 86) name = `${first} ${last} ${EPITHETS[h("epi", EPITHETS.length)]}`;
    else if (roll < 93) name = `${first} ${EPITHETS[h("epi", EPITHETS.length)]}`;
    else name = `${PREFIXES[h("pre", PREFIXES.length)]} ${last}`;
    if (!taken.has(name)) return name;
  }
  return `GM ${n}`;
}

function newGm(s: LeagueState, n: number, strategy: AiSeasonStrategy, taken: Set<string>): AiGm {
  const seed = s.seed ?? 0;
  const name = nameFor(seed, n, taken);
  taken.add(name);
  return {
    id: `aigm_${n}`,
    name,
    strategy,
    skill: Math.round(normal(`${seed}|skill|${n}`) * 100) / 100,
    teamCode: null,
    hiredSeason: s.season,
    lastEmployedSeason: null,
    seasons: [],
  };
}

/** Strategies in a shuffled, evenly spread order, so no league is eight GMs of one mind. */
function strategyDeck(seed: number, n: number): AiSeasonStrategy[] {
  const out: AiSeasonStrategy[] = [];
  let round = 0;
  while (out.length < n) {
    const deck = [...AI_SEASON_STRATEGIES].sort((a, b) => hash(`${seed}|deck|${round}|${a}`) - hash(`${seed}|deck|${round}|${b}`));
    out.push(...deck);
    round++;
  }
  return out.slice(0, n);
}

const employed = (s: LeagueState): AiGm[] => (s.aiGms ?? []).filter((g) => g.teamCode !== null);
const pool = (s: LeagueState): AiGm[] => (s.aiGms ?? []).filter((g) => g.teamCode === null);

/** The CPU GM running a team, if any. */
export function aiGmOf(s: Pick<LeagueState, "aiGms">, teamCode: string): AiGm | undefined {
  return s.aiGms?.find((g) => g.teamCode === teamCode);
}

/**
 * Who a team would hire: not someone who has worked lately (their last results
 * are the reason they're in the pool), and, when a GM has just been let go,
 * not another of the same mind. Deterministic.
 */
function pickHire(s: LeagueState, teamCode: string, avoid?: AiSeasonStrategy, firedNow?: Set<string>): AiGm | undefined {
  const free = pool(s);
  const fresh = free.filter((g) => !firedNow?.has(g.id));
  const candidates = fresh.length > 0 ? fresh : free;
  const score = (g: AiGm): number => {
    const idle = g.lastEmployedSeason === null ? 8 : Math.min(8, s.season - g.lastEmployedSeason);
    const rest = idle * 10;
    const different = avoid && g.strategy !== avoid ? 100 : 0;
    return rest + different + (hash(`${s.seed ?? 0}|hire|${teamCode}|${s.season}|${g.id}`) % 7);
  };
  return [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

function hireInto(s: LeagueState, teamCode: string, startSeason: number, avoid?: AiSeasonStrategy, firedNow?: Set<string>): AiGm | undefined {
  const g = pickHire(s, teamCode, avoid, firedNow);
  if (!g) return undefined;
  g.teamCode = teamCode;
  g.hiredSeason = startSeason;
  g.lastEmployedSeason = s.season;
  return g;
}

/**
 * Makes the CPU GM roster match the league: every CPU team has one, none
 * runs a team a person has taken, and the league keeps more GMs than CPU
 * teams. Safe to call any time and as often as you like; it only creates what
 * is missing (a new league, an older save, a seat a person has just taken or
 * left).
 */
export function syncAiGms(s: LeagueState): void {
  const teams = aiTeamCodes(s);
  const fresh = !s.aiGms;
  if (!s.aiGms) s.aiGms = [];
  const gms = s.aiGms;
  const taken = new Set(gms.map((g) => g.name));
  // enough GMs: every CPU team and the pool beside them
  const want = teams.length + poolExtras(teams.length);
  if (gms.length < want) {
    const seed = s.seed ?? 0;
    const deck = strategyDeck(seed, want);
    for (let n = gms.length; n < want; n++) gms.push(newGm(s, n, deck[n]!, taken));
  }
  // a team a person runs, or one that no longer exists, has no CPU GM
  for (const g of gms) {
    if (g.teamCode !== null && !teams.includes(g.teamCode)) {
      g.teamCode = null;
      g.lastEmployedSeason = s.season;
    }
  }
  // a brand-new league seats its GMs in team order, which spreads strategies evenly
  if (fresh) {
    teams.forEach((code, i) => {
      const g = gms[i]!;
      g.teamCode = code;
      g.hiredSeason = s.season;
      g.lastEmployedSeason = s.season;
    });
  }
  for (const code of teams) if (!aiGmOf(s, code)) hireInto(s, code, s.season);
  // the solo game's named rivals (a GM slot beside yours, holding a CPU team) are
  // that team's GM: one person, one name, wherever the app shows them
  for (const slot of s.gms) {
    if (slot.isHuman || !slot.teamCode) continue;
    const g = aiGmOf(s, slot.teamCode);
    if (g) slot.name = g.name;
  }
}

/** A team's GM identity: the person's own choice, the CPU GM's, or (an older save) the old hash. */
export function strategyOf(s: Pick<LeagueState, "aiGms" | "gms" | "teams" | "season">, teamCode: string): AiSeasonStrategy {
  const human = s.gms.find((g) => g.isHuman && g.teamCode === teamCode);
  if (human) return human.strategy ?? "balanced";
  const g = aiGmOf(s, teamCode);
  return g ? g.strategy : strategyFor(teamCode, s.season);
}

/** How well a team's GM plays the options in front of them: their difficulty, moved by their skill. */
export function difficultyFor(s: Pick<LeagueState, "aiGms" | "gms" | "teams" | "config">, teamCode: string): AiDifficultyProfile {
  const human = s.gms.some((g) => g.isHuman && g.teamCode === teamCode) || s.teams[teamCode]?.controlledBy.kind === "human";
  if (human) return difficultyProfile("expert");
  const g = aiGmOf(s, teamCode);
  if (!g) return difficultyProfile(s.config.difficulty);
  return difficultyProfileAt(effectiveLevel(s.config.difficulty, g.skill));
}

/** What the app shows about the person running a team. A human's identity stays private. */
export function gmIdentity(
  s: Pick<LeagueState, "aiGms" | "gms" | "teams">,
  teamCode: string,
): { name: string; isHuman: boolean; strategy: AiSeasonStrategy | null } | null {
  const human = s.gms.find((g) => g.isHuman && g.teamCode === teamCode);
  if (human) return { name: human.name, isHuman: true, strategy: null };
  const g = aiGmOf(s, teamCode);
  return g ? { name: g.name, isHuman: false, strategy: g.strategy } : null;
}

/** At the season's end, every CPU GM's result with their team goes on their record. */
export function recordAiOutcomes(s: LeagueState): void {
  if (!s.aiGms) return;
  for (const g of employed(s)) {
    if (!s.teams[g.teamCode!]) continue;
    if (g.seasons.some((o) => o.season === s.season)) continue;
    g.seasons.push(seasonOutcomeFor(s, g.id, g.teamCode!));
  }
}

function tenureOfAi(g: AiGm): SeasonOutcome[] {
  return g.seasons.filter((o) => o.teamCode === g.teamCode && o.season >= g.hiredSeason).sort((a, b) => a.season - b.season);
}

/** Where a CPU GM stands, by the same score a person's job is judged on. */
export function aiSecurity(g: AiGm) {
  return securityOfTenure(tenureOfAi(g));
}

/**
 * The offseason's firing block for the CPU GMs: the hot seat's rules, applied
 * to them. A fired GM joins the pool; the team hires a different mind from
 * those who have been out of work longest. Runs once a season.
 */
export function runAiFirings(s: LeagueState): AiGmMove[] {
  syncAiGms(s);
  if (s.aiGmMoves?.some((m) => m.season === s.season)) return [];
  const moves: AiGmMove[] = [];
  const firedNow = new Set<string>();
  const out = employed(s)
    .filter((g) => aiSecurity(g)?.level === "fired")
    .sort((a, b) => a.id.localeCompare(b.id));
  const jobs: { code: string; gm: AiGm }[] = [];
  for (const g of out) {
    jobs.push({ code: g.teamCode!, gm: g });
    moves.push({ season: s.season, kind: "fired", gmId: g.id, name: g.name, teamCode: g.teamCode!, strategy: g.strategy });
    g.teamCode = null;
    g.lastEmployedSeason = s.season;
    firedNow.add(g.id);
  }
  for (const { code, gm } of jobs) {
    // the new hire's first season is the one that comes next
    const hire = hireInto(s, code, s.season + 1, gm.strategy, firedNow);
    if (hire) {
      moves.push({
        season: s.season,
        kind: "hired",
        gmId: hire.id,
        name: hire.name,
        teamCode: code,
        strategy: hire.strategy,
        replaced: { name: gm.name, strategy: gm.strategy },
      });
    }
  }
  // the log keeps the last few offseasons, and a season with nothing in it, so the block is not run twice
  const keep = (s.aiGmMoves ?? []).filter((m) => m.season > s.season - 3);
  const marker: AiGmMove[] = moves.length ? [] : [{ season: s.season, kind: "fired", gmId: "", name: "", teamCode: "", strategy: "balanced" }];
  s.aiGmMoves = [...keep, ...moves, ...marker];
  return moves;
}

/** Real moves only (the empty marker that stops the block running twice is not one). */
export function aiMovesOf(s: Pick<LeagueState, "aiGmMoves">, season: number): AiGmMove[] {
  return (s.aiGmMoves ?? []).filter((m) => m.season === season && m.gmId !== "");
}

/**
 * A person picks their GM identity at team select, before the fantasy draft
 * (the draft and every auto-pick after it follow it), and may change it once a
 * year, at the owners' review in the offseason (the hot seat stage).
 */
export function chooseGmStrategy(s: LeagueState, gmId: string, strategy: string): { ok: boolean; reason?: string } {
  const gm = s.gms.find((g) => g.id === gmId);
  if (!gm || !gm.isHuman) return { ok: false, reason: "No such GM." };
  if (!(AI_SEASON_STRATEGIES as readonly string[]).includes(strategy)) return { ok: false, reason: "That isn't an identity." };
  if (s.stage !== "setup" && s.stage !== "offseasonHotSeat") {
    return { ok: false, reason: "You can change your identity before the draft and at the owners' review each offseason." };
  }
  gm.strategy = strategy as AiSeasonStrategy;
  return { ok: true };
}
