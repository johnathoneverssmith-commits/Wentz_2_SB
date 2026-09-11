/**
 * Builds a fresh LeagueState in the `setup` stage. The mock pool + schedule +
 * coach market + first draft class are generated up front so every screen has
 * data to render from the start; setup/draft stages then reassign as needed.
 */
import {
  type Coach,
  type Gm,
  type LeagueConfig,
  type LeagueState,
  type Player,
  type Position,
  type TeamState,
} from "@/domain";
import { TEAMS } from "@/data/teams";

import { agingDelta, MockSimulationService } from "@/sim/MockSimulationService";
import { Rng } from "@/sim/rng.ts";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Stable string -> int hash (FNV-1a), so aging RNG can be seeded per player id. */
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const DEFAULT_CONFIG: LeagueConfig = {
  humanGmCount: 3,
  fantasyDraft: true,
  draftOrder: "randomized",
  draftType: "linear",
  gameDayDeadlineHours: 12,
  offseasonStageDeadlineHours: 24,
  randomEvents: "some",
  difficulty: "normal",
};

const AI_GM_NAMES = ["Priya", "Marcus", "Dana", "Theo", "Nadia", "Wes", "Iris"];
const DEFAULT_GM_TEAMS = ["PIT", "KC", "SF", "DAL", "BAL", "PHI", "GB"];

export function makeGms(config: LeagueConfig): Gm[] {
  const gms: Gm[] = [{ id: "gm_you", name: "You", isHuman: true, teamCode: "" }];
  for (let i = 1; i < config.humanGmCount; i++) {
    gms.push({
      id: `gm_${i}`,
      name: AI_GM_NAMES[i - 1] ?? `GM ${i + 1}`,
      isHuman: true,
      teamCode: DEFAULT_GM_TEAMS[i - 1] ?? "",
    });
  }
  return gms;
}

function blankTeam(code: string): TeamState {
  return {
    code,
    controlledBy: { kind: "ai" },
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    divisionRank: 0,
    conferenceRank: 0,
    leagueRank: 0,
    ratings: {
      overall: 75, offense: 75, defense: 75, specialTeams: 75,
      overallRank: 0, offenseRank: 0, defenseRank: 0, specialTeamsRank: 0,
      rosterOverall: 75, rosterOverallRank: 0,
    },
    cap: { total: 255, used: 0, dead: 0 }, // $M — see TeamState.cap's doc comment
    playoffSeed: 0,
    playoffOdds: 0,
  };
}

const OFF = new Set<Position>(["QB", "RB", "WR", "TE", "OT", "OG", "C"]);
const DEF = new Set<Position>(["EDGE", "DT", "ILB", "OLB", "CB", "S"]);

/** How many of each position count as "starters" for the starting-lineup rating. */
const STARTER_COUNTS: Partial<Record<Position, number>> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1,
  EDGE: 2, DT: 2, ILB: 2, CB: 2, S: 2, K: 1, P: 1,
};

/** The starting lineup for a team: top-N by overall at each starter position. */
export function startingLineup(state: LeagueState, code: string): Player[] {
  const roster = Object.values(state.players)
    .filter((p) => p.nfl_team === code && !p.retired)
    .sort((a, b) => b.overall - a.overall);
  const out: Player[] = [];
  for (const [pos, n] of Object.entries(STARTER_COUNTS) as [Position, number][]) {
    out.push(...roster.filter((p) => p.position === pos).slice(0, n));
  }
  return out;
}

/**
 * `overall` = mean of the **starting lineup** (this is the number that matters).
 * `rosterOverall` = mean of the whole active roster.
 */
export function recomputeTeamRatings(state: LeagueState): void {
  const codes = Object.keys(state.teams);
  const mean = (arr: Player[], fallback = 72) =>
    arr.length ? Math.round(arr.reduce((s, p) => s + p.overall, 0) / arr.length) : fallback;

  const raw: Record<string, { o: number; off: number; def: number; st: number; roster: number }> = {};
  const coachesByTeam = new Map<string, typeof state.coaches[string][]>();
  for (const c of Object.values(state.coaches)) {
    if (!c.team) continue;
    const list = coachesByTeam.get(c.team) ?? [];
    list.push(c);
    coachesByTeam.set(c.team, list);
  }
  for (const code of codes) {
    const starters = startingLineup(state, code);
    const fullRoster = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired,
    );
    raw[code] = {
      o: mean(starters),
      off: mean(starters.filter((p) => OFF.has(p.position))),
      def: mean(starters.filter((p) => DEF.has(p.position))),
      st: mean(starters.filter((p) => p.position === "K" || p.position === "P"), 68),
      roster: mean(fullRoster),
    };
    // cap usage (spec's "cap" fields) — current-year player cap hits + coach
    // salaries. Dead money from cuts/trades isn't modeled (no per-player
    // dead-cap tracking exists yet in this data model) — a simplification,
    // not silently ignored: `cap.dead` stays 0 rather than pretending to a
    // precision this doesn't have.
    const playerCapHits = fullRoster.reduce((s, p) => s + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    const coachCapHits = (coachesByTeam.get(code) ?? []).reduce((s, c) => s + (c.contract?.annualValue ?? 0), 0);
    state.teams[code]!.cap.used = Math.round((playerCapHits + coachCapHits) * 10) / 10;
  }

  const rank = (key: keyof (typeof raw)[string]) => {
    const sorted = [...codes].sort((a, b) => raw[b]![key] - raw[a]![key]);
    return new Map(sorted.map((c, i) => [c, i + 1]));
  };
  const ro = rank("o");
  const roff = rank("off");
  const rdef = rank("def");
  const rst = rank("st");
  const rr = rank("roster");
  for (const code of codes) {
    state.teams[code]!.ratings = {
      overall: raw[code]!.o,
      offense: raw[code]!.off,
      defense: raw[code]!.def,
      specialTeams: raw[code]!.st,
      overallRank: ro.get(code)!,
      offenseRank: roff.get(code)!,
      defenseRank: rdef.get(code)!,
      specialTeamsRank: rst.get(code)!,
      rosterOverall: raw[code]!.roster,
      rosterOverallRank: rr.get(code)!,
    };
  }
}

/**
 * One year of aging for every active (non-retired) player, applied at a
 * season rollover (OQ-4): age +1, then an `overall`/attribute drift from
 * `agingDelta` based on where the new age sits relative to the player's own
 * `dev_age_threshold`/`decline_age_threshold` (fixed at player creation).
 * Deterministic per (season, player id) so a replay/reload doesn't reshuffle
 * outcomes. Retired players are skipped - their rating is a frozen
 * career-final snapshot, not something that keeps drifting off-roster.
 */
export function applySeasonAging(state: LeagueState, season: number): void {
  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    const rng = new Rng((season * 7349) ^ hashSeed(p.id));
    p.age += 1;
    const delta = agingDelta(rng, p.age, p.dev_age_threshold, p.decline_age_threshold);
    if (delta === 0) continue;
    p.overall = clamp(p.overall + delta, 40, 99);
    for (const k of Object.keys(p.attributes)) {
      p.attributes[k] = clamp(p.attributes[k]! + delta, 40, 99);
    }
  }
}

export function createLeague(seed = 1, config: LeagueConfig = DEFAULT_CONFIG): LeagueState {
  const sim = new MockSimulationService();
  const gms = makeGms(config);
  const teams: Record<string, TeamState> = {};
  for (const t of TEAMS) teams[t.code] = blankTeam(t.code);
  for (const g of gms) {
    if (g.teamCode && teams[g.teamCode]) {
      teams[g.teamCode]!.controlledBy = { kind: "human", gmId: g.id };
    }
  }

  const pool = sim.generateInitialPool(seed, "realRosters");
  const players: Record<string, Player> = {};
  for (const p of pool) players[p.id] = p;

  const coachList = sim.generateCoachMarket(seed);
  const coaches: Record<string, Coach> = {};
  for (const c of coachList) {
    // every team starts with 0 coaches — the hiring window fills them
    c.team = null;
    c.contract = null;
    coaches[c.id] = c;
  }

  const schedule = sim.generateSchedule(seed, TEAMS.map((t) => t.code));
  const draftClass = sim.generateDraftClass(seed, 2026);

  const state: LeagueState = {
    schemaVersion: 2,
    season: 2026,
    stage: "setup",
    week: 0,
    config,
    gms,
    viewerGmId: "gm_you",
    teams,
    players,
    coaches,
    schedule,
    games: [],
    draftClass,
    draft: null,
    rookieOutcomes: {},
    freeAgency: null,
    standingFreeAgents: [],
    coachingHire: null,
    bracket: null,
    trades: [],
    readiness: Object.fromEntries(gms.map((g) => [g.id, g.id !== "gm_you"])),
    stageDeadlineAt: null,
    pendingGameDay: null,
    returnTo: null,
    history: [],
  };
  recomputeTeamRatings(state);
  return state;
}
