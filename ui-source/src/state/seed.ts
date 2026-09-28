/**
 * Builds a fresh LeagueState in the `setup` stage. The mock pool + schedule +
 * coach market + first draft class are generated up front so every screen has
 * data to render from the start; setup/draft stages then reassign as needed.
 */
import { fittedAttributes } from "@/sim/attributeFit";
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

import { agingDelta, contractValueFor, MockSimulationService } from "@/sim/MockSimulationService";
import { fullPersonName } from "@/sim/names.ts";
import { applyCoachToDelta, coachModifiersFor } from "./coachEffects.ts";
import { ensureDraftPicks } from "./draftPicks.ts";
import { Rng } from "@/sim/rng.ts";
import {
  OFFSEASON_ROSTER_SIZE,
  RETIREMENT_AGE,
  ROSTER_SIZE,
  ROSTER_TEMPLATE,
} from "@/sim/roster-template.ts";

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
  // twenty rounds by hand is a long evening; five picks is enough to shape a
  // roster before the rest fills itself in
  draftSimulateAfterPicks: 5,
  fantasyDraftRounds: 20,
  gameDayDeadlineHours: 12,
  offseasonStageDeadlineHours: 24,
  difficulty: "standard",
  // new leagues default to rosters mattering more than real football allows;
  // Realistic is one setting away (see `talentImpact.ts`)
  talentImpact: "amplified",
};

const AI_GM_NAMES = ["Priya", "Marcus", "Dana", "Theo", "Nadia", "Wes", "Iris"];
const DEFAULT_GM_TEAMS = ["PIT", "KC", "SF", "DAL", "BAL", "PHI", "GB"];

/**
 * The GM slots a new league starts with: you, plus the rival GMs.
 *
 * The rivals are named characters with teams, and they are *not* human.
 * `isHuman` is the flag every turn-based stage reads to decide whether to
 * wait for a person — `isAiTeam`, the draft's `runAiPicks`, the coaching
 * draft, both free-agency sweeps and the trade deadline all stop dead on a
 * team a human GM owns. Marking the rivals human meant a solo dynasty
 * deadlocked on the first one's turn: with stock settings the fantasy draft
 * sat on Pittsburgh at pick 3 of 640 forever, because Priya is not at this
 * keyboard and nothing was ever going to pick for her.
 *
 * Online hits the same wall from the other side and already solves it the
 * same way — `leagues.ts` clears `isHuman` on every slot at creation,
 * because "a slot nobody has claimed is not a person", and `claimTeam` sets
 * it back to true when a real one takes the seat. This is that rule applied
 * to the solo seed, where the seat is never going to be claimed at all.
 */
export function makeGms(config: LeagueConfig): Gm[] {
  const gms: Gm[] = [{ id: "gm_you", name: "You", isHuman: true, teamCode: "" }];
  for (let i = 1; i < config.humanGmCount; i++) {
    gms.push({
      id: `gm_${i}`,
      name: AI_GM_NAMES[i - 1] ?? `GM ${i + 1}`,
      isHuman: false,
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

/** League-minimum depth deal — no guarantee. */
const MIN_SALARY_M = 1;

/**
 * Contract length ranges the roster fill signs to, inclusive.
 *
 * Every fill signing used to be written for one year, which meant ~30 of a
 * team's 53 deals ran out every single offseason. Once contracts actually
 * expired, that emptied the league: rosters fell to 12-21 players and 1,296
 * players hit the market at once. Staggering the terms keeps annual turnover
 * near the real NFL's (roughly a quarter to a third of a roster) — enough to
 * stock a free-agency window, not enough to dissolve a team.
 */
const STARTER_YEARS = [3, 5] as const;
const DEPTH_YEARS = [2, 4] as const;

/** How many free agents the market keeps so it never empties out. */
const MARKET_RESERVE = 140;

/**
 * Cap room ($M) the automatic roster fill refuses to spend.
 *
 * Without it the fill signs the best player it can afford at every hole and
 * lands every team on exactly $255.0M — legal, and unplayable: free agency is
 * the offseason's headline feature and no GM, human or AI, could make a single
 * signing. Real front offices carry working room for in-season injuries and
 * deadline moves; this is that, and it's what keeps the market alive.
 */
// CPU Cap Preparation optimization pass (cpu_cap_prep.cap_working_room_m).
const CAP_WORKING_ROOM = 16;

function dealFor(teamCode: string, salary: number, years: number): NonNullable<Player["contract"]> {
  return {
    team_id: teamCode,
    years_remaining: years,
    total_value: Math.round(salary * years * 10) / 10,
    guaranteed: 0,
    cap_hit_by_year: Array.from({ length: years }, () => salary),
    signing_bonus: 0,
  };
}

/**
 * A market-rate deal for an established pro joining a team.
 *
 * The engine's pool (`/pool` on the adapter) carries real names, teams and
 * ratings but no contracts at all — every player comes back `contract: null`
 * and `free_agent: true`. Left alone that makes the salary cap decorative:
 * with the adapter running, 637 rostered players cost nothing and every team
 * sat $190M under the line. This is what the franchise layer pays them.
 */
export function marketDeal(teamCode: string, p: Player, years: number): NonNullable<Player["contract"]> {
  const salary = Math.max(MIN_SALARY_M, Math.round(contractValueFor(p.overall, p.position) * 10) / 10);
  return dealFor(teamCode, salary, Math.max(1, years));
}

let depthSeq = 0;

/**
 * A camp body: fictional, bottom-tier, minimum salary. Strictly below every
 * real player in the pool, so it fills a roster spot without ever displacing
 * a ranked player or showing up anywhere near a depth chart's top.
 */
function makeDepthPlayer(position: Position, season: number, rng: Rng): Player {
  const id = `p_depth_${season}_${++depthSeq}`;
  const overall = clamp(Math.round(rng.normal(56, 4)), 48, 63);
  const age = clamp(Math.round(rng.normal(25, 2)), 21, 31);
  return {
    id,
    name: fullPersonName(rng),
    position,
    age,
    nfl_team: "FA",
    years_pro: clamp(age - 22, 0, 8),
    overall,
    // the position's skills, shaped like a real player's of this overall —
    // three generic attributes left the engine unable to rate him at all
    attributes: fittedAttributes(position, overall, () => rng.normal(0, 1)),
    scheme_tags: [],
    dev_age_threshold: age + 2,
    decline_age_threshold: age + 6,
    injury_history: [],
    contract: null,
    free_agent: true,
    injury_status: null,
    retired: false,
    retirement_status: "active",
    season_stats: { gamesPlayed: 0 },
  };
}

/**
 * Clears `needed` ($M) of cap room on one team, cutting the priciest players
 * it can spare. Returns whether it got there.
 *
 * An elite free agent costs more than any team ever holds in reserve — a
 * 96-overall quarterback is worth $51M a year and the richest team in the
 * league carried $29M — so the two best quarterbacks in football went
 * unsigned through a whole free agency and into the following season. Real
 * teams don't sit that out; they clear the room for the player and take the
 * roster hit. This is that move, and like the trim it protects a team's best
 * player at each position, so the cost of signing a star is depth, never the
 * rest of the starting eleven.
 */
export function clearRoomFor(state: LeagueState, teamCode: string, needed: number): boolean {
  const capTotal = state.teams[teamCode]?.cap.total ?? 255;
  const roster = Object.values(state.players).filter(
    (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent,
  );
  let used = roster.reduce((n, p) => n + capHitOf(p), 0);
  if (capTotal - used >= needed) return true;

  const core = (): Set<string> => {
    const keep = new Set<string>();
    for (const pos of new Set(roster.map((p) => p.position))) {
      const best = roster
        .filter((p) => p.position === pos)
        .reduce((a, b) => (b.overall > a.overall ? b : a));
      keep.add(best.id);
    }
    return keep;
  };

  let guard = 10;
  while (capTotal - used < needed && guard-- > 0) {
    const keep = core();
    const candidates = roster.filter((p) => !keep.has(p.id) && capHitOf(p) > MIN_SALARY_M);
    if (candidates.length === 0) return false;
    const cut = candidates.reduce((a, b) => (capHitOf(b) > capHitOf(a) ? b : a));
    used -= capHitOf(cut);
    roster.splice(roster.indexOf(cut), 1);
    releaseToMarket(state, cut);
  }
  return capTotal - used >= needed;
}

/**
 * Share of the cap an AI team tries to have free when the window opens.
 *
 * CPU Cap Preparation optimization pass (cpu_cap_prep.free_agency_war_chest).
 */
const FREE_AGENCY_WAR_CHEST = 0.14;

/**
 * Cut day: AI teams clear room before free agency opens.
 *
 * The league arrived at its window carrying 98.9% of the cap, rosters at
 * 52-62, and no money — so nobody could sign anybody, and a five-day window
 * closed with the two best quarterbacks in football still unsigned. That
 * isn't a bidding problem, it's a balance-sheet one: every real offseason
 * starts with teams cutting the contracts they no longer want, and this is
 * that day.
 *
 * Expensive backups go first (the same tiering the preseason trim uses), a
 * team's best player at each position is never touched, and a human GM's team
 * is left alone entirely — deciding who to cut is the job, and they have the
 * Release button and a roster screen that tells them where they stand.
 */
export function openCapRoomForFreeAgency(state: LeagueState): void {
  const humanTeams = new Set(
    state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode),
  );
  for (const code of Object.keys(state.teams)) {
    if (humanTeams.has(code)) continue;
    const capTotal = state.teams[code]?.cap.total ?? 255;
    const target = capTotal * (1 - FREE_AGENCY_WAR_CHEST);
    const roster = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent,
    );
    let used = roster.reduce((n, p) => n + capHitOf(p), 0);
    const core = (): Set<string> => {
      const keep = new Set<string>();
      for (const pos of new Set(roster.map((p) => p.position))) {
        const best = roster
          .filter((p) => p.position === pos)
          .reduce((a, b) => (b.overall > a.overall ? b : a));
        keep.add(best.id);
      }
      return keep;
    };
    let guard = 12; // a cut day, not a teardown
    while (used > target && guard-- > 0) {
      const keep = core();
      const candidates = roster.filter((p) => !keep.has(p.id) && capHitOf(p) > MIN_SALARY_M);
      if (candidates.length === 0) break;
      const cut = candidates.reduce((a, b) => (capHitOf(b) > capHitOf(a) ? b : a));
      used -= capHitOf(cut);
      roster.splice(roster.indexOf(cut), 1);
      releaseToMarket(state, cut);
    }
  }
}

/**
 * Puts an incoming player pool into the shape the franchise layer assumes:
 * a player either belongs to a team, with a contract, or is on the market
 * with neither. The engine's pool satisfies neither half — it hands back a
 * real team code *and* `free_agent: true` *and* no contract, so the same
 * player counted as rostered and as market supply at once.
 *
 * In a fantasy-draft league nobody starts anywhere: the draft is what assigns
 * them. Otherwise they keep the team they really play for and are paid what
 * they're worth, on staggered terms so free agency has something to do in
 * later years (see `expireContracts`).
 */
export function normalizePool(
  players: Player[],
  fantasyDraft: boolean,
  seed: number,
  capTotal = 255,
): void {
  const rng = new Rng(seed ^ 0x5ee1);
  // The league plays linebackers as ILB (off the ball) and EDGE (on it) and
  // has no OLB slot on any depth chart. The pool's two OLBs — Frankie Luvu
  // and Isaiah Simmons, both off-ball backers — were cut by the 53-man trim
  // below for having no slot, and Luvu, an 84, opened every league as a
  // free agent nobody could start.
  for (const p of players) if (p.position === "OLB") p.position = "ILB";
  // Everyone in the pool arrives with an NFL career: the youngest are the
  // real 2025 class, two seasons in by the league's first kickoff. Left at 0
  // they were "rookies", and Cam Ward and Quinshon Judkins won Rookie of the
  // Year in 2027. Rookies are the players who enter the league in it.
  for (const p of players) p.years_pro = Math.max(1, p.years_pro ?? 0);
  if (fantasyDraft) {
    for (const p of players) {
      p.free_agent = true;
      p.nfl_team = "FA";
      p.contract = null;
    }
    return;
  }

  const squads = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.nfl_team || p.nfl_team === "FA") {
      p.free_agent = true;
      p.contract = null;
      continue;
    }
    p.free_agent = false;
    const list = squads.get(p.nfl_team);
    if (list) list.push(p);
    else squads.set(p.nfl_team, [p]);
  }

  // Every team opens at 53, shaped like a real roster, and its extras open
  // the league as free agents. The source rosters carry ~62 a team, so the
  // excess used to sit on rosters until the preseason cut while year-one free
  // agency opened with three players in it. Nobody is added or removed: the
  // same league, with its spare players on the market where GMs can bid.
  for (const [team, squad] of squads) {
    if (squad.length <= ROSTER_SIZE) continue;
    const keep = new Set<string>();
    const best = [...squad].sort((a, b) => b.overall - a.overall);
    for (const { pos, count } of ROSTER_TEMPLATE) {
      best.filter((x) => x.position === pos).slice(0, count).forEach((x) => keep.add(x.id));
    }
    for (const x of best) {
      if (keep.size >= ROSTER_SIZE) break;
      keep.add(x.id);
    }
    const kept: Player[] = [];
    for (const x of squad) {
      if (keep.has(x.id)) kept.push(x);
      else {
        x.free_agent = true;
        x.nfl_team = "FA";
        x.contract = null;
      }
    }
    squads.set(team, kept);
  }

  // Price each squad to fit its cap rather than at raw market value.
  //
  // A real NFL roster priced by `contractValueFor` costs about $350M against
  // a $255M cap — the valuation curve was fitted for free-agent asking prices,
  // not for buying 60 players at once. Left alone, every team started ~$160M
  // over, the preseason trim had to shed a third of the league, and it got
  // there by cutting the biggest contracts: Baltimore opened the season with
  // three camp-body quarterbacks. Scaling keeps the *shape* of a payroll (the
  // stars still cost the most) while landing the total where a front office
  // would actually have it.
  const target = capTotal * 0.88;
  for (const [team, squad] of squads) {
    const raw = squad.map((p) => Math.max(MIN_SALARY_M, contractValueFor(p.overall, p.position)));
    const total = raw.reduce((a, b) => a + b, 0);
    const scale = total > target ? target / total : 1;
    squad.forEach((p, i) => {
      if (p.contract) return;
      const salary = Math.max(MIN_SALARY_M, Math.round(raw[i]! * scale * 10) / 10);
      p.contract = dealFor(team, salary, rng.int(2, 5));
    });
  }
}

/**
 * Prices each team's fantasy-drafted squad to fit its cap.
 *
 * A fantasy pick is signed at market value, and twenty market-value starters
 * cost more than a cap that still has thirty-three roster spots to fill.
 * The trim that follows then had to find the money by cutting starters: teams
 * left the draft with fourteen men, and one released the 96-rated
 * quarterback it had taken first overall. The real-roster start solves the
 * same problem by scaling each squad's payroll (`normalizePool`); this is
 * that, for the draft — the stars still cost the most, and the total lands
 * where the depth fill and a little working room still fit under the line.
 */
export function fitDraftedPayrolls(state: LeagueState): void {
  const squads = new Map<string, Player[]>();
  for (const p of Object.values(state.players)) {
    if (p.retired || p.free_agent || !p.contract || !state.teams[p.nfl_team]) continue;
    const list = squads.get(p.nfl_team);
    if (list) list.push(p);
    else squads.set(p.nfl_team, [p]);
  }
  for (const [team, squad] of squads) {
    const capTotal = state.teams[team]?.cap.total ?? 255;
    const open = Math.max(0, ROSTER_SIZE - squad.length);
    const target = capTotal - open * MIN_SALARY_M - CAP_WORKING_ROOM;
    const total = squad.reduce((n, p) => n + capHitOf(p), 0);
    if (total <= target || total <= 0) continue;
    const scale = target / total;
    for (const p of squad) {
      const c = p.contract!;
      c.cap_hit_by_year = c.cap_hit_by_year.map((x) => Math.max(MIN_SALARY_M, Math.round(x * scale * 10) / 10));
      c.total_value = Math.round(c.cap_hit_by_year.reduce((a, b) => a + b, 0) * 10) / 10;
      c.guaranteed = Math.min(c.guaranteed, c.total_value);
    }
  }
}

/**
 * How many unsigned players the market carries into a new season.
 *
 * Roughly ten per team, which is what a real "still available in July" pool
 * looks like next to a 53-man roster. Left unbounded it only grows: every
 * offseason adds a draft class, the contracts that ran out, and the camp
 * bodies the fill generated, and nothing ever leaves. Five seasons in there
 * were 1,072 free agents against 1,696 roster spots, a free-agency board
 * nobody could read and a save file carrying 2,930 players.
 */
const MARKET_CEILING = 320;

/**
 * Retires the bottom of the free-agent market at each new season.
 *
 * Players who stopped being signable leave the game, worst first: real
 * careers end quietly, and this is that. Camp bodies and anyone past their
 * position's typical retirement age go first, which keeps the market's
 * *useful* half intact — a GM looking for a starter still finds one.
 */
export function pruneFreeAgentMarket(state: LeagueState): void {
  const market = Object.values(state.players).filter((p) => p.free_agent && !p.retired);
  if (market.length <= MARKET_CEILING) return;
  const worthKeeping = (p: Player): number => {
    const pastIt = p.age > (RETIREMENT_AGE[p.position] ?? 33) ? 1 : 0;
    // camp bodies are fictional filler; they go before anyone real
    const filler = p.id.startsWith("p_depth_") ? 1 : 0;
    return p.overall - pastIt * 15 - filler * 10;
  };
  market.sort((a, b) => worthKeeping(a) - worthKeeping(b));
  for (const p of market.slice(0, market.length - MARKET_CEILING)) {
    p.retired = true;
    p.retirement_status = "retiring";
    p.retired_season = state.season;
    p.contract = null;
  }
  const gone = new Set(market.slice(0, market.length - MARKET_CEILING).map((p) => p.id));
  state.standingFreeAgents = state.standingFreeAgents.filter((id) => !gone.has(id));
}

/**
 * Drops players who retired more than a season ago.
 *
 * Retired players were kept forever. Nothing reads them — `history` scores
 * GMs, not players, and every screen filters them out — but the save grows
 * about 300 records a season at ~760 bytes each, and zustand's `persist`
 * fails *silently* when localStorage runs out. A dynasty would have quietly
 * stopped saving somewhere around its fifteenth year. One season of grace is
 * kept so a "who hung it up" view has something to show.
 */
export function forgetOldRetirees(state: LeagueState): void {
  for (const [id, p] of Object.entries(state.players)) {
    if (!p.retired) continue;
    if ((p.retired_season ?? 0) >= state.season - 1) continue;
    delete state.players[id];
  }
  state.standingFreeAgents = state.standingFreeAgents.filter((id) => state.players[id]);
}

/**
 * Sends a rostered player back to the open market.
 *
 * Frees his whole cap hit and charges nothing — which is right for a
 * contract running out. A *release* goes through `applyRelease`
 * (reconciliation.ts), which charges `releasePenalty` as dead money first.
 */
export function releaseToMarket(state: LeagueState, p: Player): void {
  p.free_agent = true;
  p.nfl_team = "FA";
  p.contract = null;
  if (!state.standingFreeAgents.includes(p.id)) state.standingFreeAgents.push(p.id);
}

/**
 * Ages every contract by the season just played.
 *
 * Nothing decremented `years_remaining` anywhere, so contracts were
 * permanent: the "2y" on the roster screen never changed, cap space never
 * came back, and free agency had nothing in it but the minimum-salary depth
 * whose deals happened to be written for one year. A team went into its
 * second offseason with $2.6M of room against a market asking $17M.
 *
 * A year off every deal also steps `cap_hit_by_year` forward, so the
 * escalating hits the pool was built with actually escalate. A deal that runs
 * out sends the player to the open market, which is what stocks the offseason
 * window with real players instead of camp bodies.
 */
export function expireContracts(state: LeagueState): void {
  // a new league year: last year's dead money is off the books
  for (const t of Object.values(state.teams)) t.cap.dead = 0;
  for (const p of Object.values(state.players)) {
    const c = p.contract;
    if (!c || p.retired || p.free_agent) continue;
    c.years_remaining -= 1;
    if (c.cap_hit_by_year.length > 1) c.cap_hit_by_year.shift();
    if (c.years_remaining <= 0) releaseToMarket(state, p);
  }
}

/** Cap hit a player is currently charging his team, in $M. */
const capHitOf = (p: Player): number => p.contract?.cap_hit_by_year[0] ?? 0;

/**
 * Trims one team down to a legal roster: at most `ROSTER_SIZE` players, and
 * under the cap.
 *
 * A team arrives here over one limit or both — the draft hands out seven more
 * bodies on top of a full 53 and rookie deals are charged on top of a cap
 * that was already near the line. Real front offices settle this with cuts
 * before the season, and so does this.
 *
 * Who goes is decided the way a staff would decide it. For roster size, the
 * worst player at a position the team is *overstocked* at, so the cut never
 * opens a hole `fillRosterGaps` then has to plug. For the cap, the biggest
 * cap hit that isn't a projected starter — an expensive backup is exactly
 * what gets cut in a crunch. Starters are only touched when nothing else is
 * left, which is itself realistic: a team that far over has to move a starter.
 */
function trimToLegalRoster(
  state: LeagueState,
  roster: Player[],
  capTotal: number,
  sizeLimit: number = ROSTER_SIZE,
  /** also cap each position at its `ROSTER_TEMPLATE` count */
  shapeToTemplate = true,
): { used: number; released: number } {
  let used = roster.reduce((n, p) => n + capHitOf(p), 0);
  let released = 0;
  /** Returns the cap the cut frees; `releaseToMarket` clears the contract. */
  const drop = (p: Player): number => {
    const freed = capHitOf(p);
    releaseToMarket(state, p);
    roster.splice(roster.indexOf(p), 1);
    released++;
    return freed;
  };
  const countAt = (pos: Position): number => roster.filter((p) => p.position === pos).length;
  const templateCount = (pos: Position): number =>
    ROSTER_TEMPLATE.find((r) => r.pos === pos)?.count ?? 0;
  /** The best `depth` players at each position, by overall. */
  const bestAtEachPosition = (depth: (pos: Position) => number): Set<string> => {
    const keep = new Set<string>();
    const positions = new Set(roster.map((p) => p.position));
    for (const pos of positions) {
      roster
        .filter((p) => p.position === pos)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, depth(pos))
        .forEach((p) => keep.add(p.id));
    }
    return keep;
  };
  /** Projected starters, cut only once the depth behind them is gone. */
  const protectedIds = (): Set<string> =>
    bestAtEachPosition((pos) => STARTER_COUNTS[pos] ?? 0);
  /** The single best player at each position — the last thing a team gives up. */
  const coreIds = (): Set<string> => bestAtEachPosition(() => 1);

  // Shape before size. Trimming only the total leaves a lopsided roster
  // lopsided: a team sitting at 53 with six quarterbacks and two corners
  // passes the size check untouched, and then the fill tops every short
  // position up to its template count and lands at 56. Cutting the surplus
  // first means the fill can only ever bring the team back to exactly 53.
  if (shapeToTemplate) {
    for (const { pos, count } of ROSTER_TEMPLATE) {
      while (countAt(pos) > count) {
        const worst = roster
          .filter((p) => p.position === pos)
          .reduce((a, b) => (b.overall < a.overall ? b : a));
        used -= drop(worst);
      }
    }
  }

  // size next — every cut here also frees cap, so the cap pass has less to do
  while (roster.length > sizeLimit) {
    const overstocked = roster.filter((p) => countAt(p.position) > templateCount(p.position));
    const pool = overstocked.length > 0 ? overstocked : roster;
    const worst = pool.reduce((a, b) => (b.overall < a.overall ? b : a));
    used -= drop(worst);
  }

  // Then the cap — against a budget, not the raw number. Every roster spot
  // still empty gets filled at the minimum right after this, so cutting to
  // exactly the cap just lands the team back over it once the depth arrives.
  const limit = (): number =>
    capTotal - Math.max(0, ROSTER_SIZE - roster.length) * MIN_SALARY_M;
  // A team that has to cut at all cuts far enough to operate afterwards.
  // Shedding exactly enough to be legal leaves it at $0.0M of space, unable
  // to sign anyone all year; a team already under the limit is left alone.
  // `limit()` is re-read every pass because each cut opens a roster spot the
  // fill will charge the minimum for.
  const mustCut = used > limit();
  const target = (): number => (mustCut ? limit() - CAP_WORKING_ROOM : limit());
  let guard = ROSTER_SIZE;
  while (used > target() && roster.length > 0 && guard-- > 0) {
    const dearest = (pool: Player[]): Player =>
      pool.reduce((a, b) => (capHitOf(b) > capHitOf(a) ? b : a));
    /** Only a contract is worth cutting for cap; minimum deals free nothing. */
    const onRealMoney = (pool: Player[]): Player[] =>
      pool.filter((p) => capHitOf(p) > MIN_SALARY_M);

    // Three tiers, and the order is the whole point of this pass.
    //
    // A roster is mostly minimum-salary depth, and after a draft class almost
    // every real player is the best at his position and so "protected" — so
    // the expendable pool is camp bodies. Cutting those to fix a $38M overage
    // doesn't fix it: one team shed 38 players at $1M each and came out of
    // the draft with 22. So when the best expendable cut is at the minimum,
    // the overage is a contract problem and a contract has to go.
    //
    // But not just the biggest one: that cut the franchise quarterback and
    // left the team its two worst. The expensive *second* man at a position
    // goes first, and the one player a team can't replace at each spot goes
    // only when there is nothing else left to shed.
    //
    // The tiers have to be a ladder rather than two special cases. They used
    // to fall straight to "dearest on the roster" whenever the expendable
    // pool came back *empty*, which skipped the core protection entirely and
    // did the exact thing the paragraph above says not to. Empty is the
    // normal state here, not an edge case: a team leaving a 20-round fantasy
    // draft has 20 men and roughly one per position, so every one of them is
    // a projected starter. In a stock dynasty that cut Lamar Jackson — the
    // best player in the league and the viewer's own first-round pick —
    // before the roster screen had ever been shown, purely for being the
    // largest number.
    // Each rung is only built if the one above it came back empty.
    // `protectedIds` and `coreIds` both sort every position group, and this
    // loop runs once per cut on every team — evaluating all three eagerly
    // took a free-agency turn from 189ms to 725ms.
    const rungs: (() => Player[])[] = [
      () => onRealMoney(roster.filter((p) => !protectedIds().has(p.id))), // 1. paid backups
      () => onRealMoney(roster.filter((p) => !coreIds().has(p.id))), //     2. replaceable starters
      () => roster.filter((p) => capHitOf(p) > 0), //                       3. the untouchables
    ];
    let pool: Player[] = [];
    for (const rung of rungs) {
      pool = rung();
      if (pool.length > 0) break;
    }
    if (pool.length === 0) break; // nothing left to shed
    used -= drop(dearest(pool));
  }

  return { used, released };
}

/**
 * Cuts every team back to a legal roster without filling anyone up.
 *
 * Run when the rookie class has just been signed and free agency is next. A
 * team leaves the draft seven players over the limit and tens of millions
 * over the cap, and walking into the market like that means the board refuses
 * every signing — the offseason's headline feature, dead on arrival. Trimming
 * here (but *not* filling, which would spend the room free agency is for)
 * hands the player a legal roster and money to work with.
 */
export function trimRosters(state: LeagueState): void {
  for (const code of Object.keys(state.teams)) {
    // `!p.free_agent` matters: a player carrying a stale team code while on
    // the market would otherwise be counted both here and in `byPos`, and
    // signing him would push a duplicate into `roster` — which reads as a
    // filled spot and leaves the team one real body short of 53.
    const roster = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent,
    );
    // the offseason ceiling, not 53 — cutting to 53 here would leave a team
    // that drafted well unable to sign anyone in the window that follows
    // no position shaping here: the offseason ceiling is a ceiling, not a
    // roster plan, and the draft class a team just signed is allowed to stack
    // a position until the preseason gate says otherwise
    trimToLegalRoster(
      state,
      roster,
      state.teams[code]?.cap.total ?? 255,
      OFFSEASON_ROSTER_SIZE,
      false,
    );
  }
}

/**
 * Brings every team to a full, legal 53-man roster, shaped by
 * `ROSTER_TEMPLATE` — cutting down to the limit first, then filling up to it.
 *
 * Two things made this necessary. A 20-round fantasy draft hands each team 20
 * players and leaves ~990 in the market, and nothing refilled them — AI teams
 * only sign during the 5-day offseason window (~63 signings league-wide), so
 * teams carried 18-26 players and several had nobody at all at a position.
 * And the pool *is* roughly the real NFL's rostered population (~1,630 for
 * 32 x 53 = 1,696 spots), so there aren't enough real players to fill the
 * league even before leaving a market open.
 *
 * So it fills in two passes, which is also what keeps the cap honest:
 *
 * - **Starters** (`STARTER_COUNTS`) come from the best available at that
 *   position and are paid their market value. A team that genuinely has no
 *   running back should sign a real one, and pay for him.
 * - **Depth** up to the full template comes from the *bottom* of the market
 *   at the league minimum. These are backups, and paying them like backups is
 *   the whole point: a fantasy-drafted roster is already ~20 starter-caliber
 *   players carrying ~$200M of real contracts, so the remaining 30 spots have
 *   to cost about $1M each or no team fits under the cap. Signing
 *   best-available here (the previous behaviour) handed out 88-overall players
 *   at minimum salary, which distorted both the cap and competitive balance.
 *
 * When the market runs dry at a position — or would fall below
 * `MARKET_RESERVE` and leave free agency empty — it generates a camp body
 * instead. Those are fictional and capped in the 48-63 range, strictly under
 * every real player, so the ranked pool is never displaced.
 */
/**
 * Camp cuts: CPU teams trade their camp bodies for real veterans.
 *
 * The roster fill at rollover tops every team up to 53 before free agency,
 * inventing camp bodies whenever the market runs thin, and nothing ever
 * revisited them — they stayed on multi-year deals while better veterans went
 * unsigned all year. At the preseason gate each CPU team swaps a camp body
 * for the best unsigned player at his position who is clearly better and
 * fits on a camp deal. The camp body leaves the league (he was invented to
 * fill a spot). Human rosters are left to their GMs.
 */
export function campCuts(state: LeagueState): number {
  let swaps = 0;
  const byPos = new Map<Position, Player[]>();
  for (const p of Object.values(state.players)) {
    if (!p.free_agent || p.retired || p.id.startsWith("p_depth_")) continue;
    const l = byPos.get(p.position);
    if (l) l.push(p);
    else byPos.set(p.position, [p]);
  }
  for (const l of byPos.values()) l.sort((a, b) => b.overall - a.overall);
  for (const code of Object.keys(state.teams)) {
    if (state.teams[code]!.controlledBy.kind !== "ai") continue;
    const team = state.teams[code]!;
    let used = Object.values(state.players)
      .filter((p) => p.nfl_team === code && !p.retired && !p.free_agent)
      .reduce((n, p) => n + capHitOf(p), 0);
    const bodies = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && p.id.startsWith("p_depth_"),
    );
    for (const body of bodies) {
      const pool = byPos.get(body.position) ?? [];
      const i = pool.findIndex(
        (x) => x.overall >= body.overall + 3 && used - capHitOf(body) + lateMarketDeal(x) <= team.cap.total - CAP_WORKING_ROOM / 2,
      );
      if (i < 0) continue;
      const vet = pool.splice(i, 1)[0]!;
      used -= capHitOf(body);
      delete state.players[body.id];
      const salary = lateMarketDeal(vet);
      vet.free_agent = false;
      vet.nfl_team = code;
      vet.contract = dealFor(code, salary, 1);
      state.standingFreeAgents = state.standingFreeAgents.filter((id) => id !== vet.id);
      used += salary;
      swaps++;
    }
  }
  if (swaps) recomputeTeamRatings(state);
  return swaps;
}

/** What an unsigned veteran accepts at the preseason gate: 35% of his price. */
const lateMarketDeal = (p: Player): number =>
  Math.max(MIN_SALARY_M, Math.round(contractValueFor(p.overall, p.position) * 0.35 * 10) / 10);

export function fillRosterGaps(state: LeagueState, opts: { lateMarket?: boolean } = {}): void {
  // the preseason gate: unsigned veterans take camp deals (see pass 2)
  const lateMarket = opts.lateMarket ?? false;
  const rng = new Rng(state.season * 7717 + 13);
  const byPos = new Map<Position, Player[]>();
  let marketSize = 0;
  for (const p of Object.values(state.players)) {
    if (!p.free_agent || p.retired) continue;
    marketSize++;
    const list = byPos.get(p.position);
    if (list) list.push(p);
    else byPos.set(p.position, [p]);
  }
  // best first, so `pop()` takes the cheapest depth and `shift()` the best starter
  for (const list of byPos.values()) list.sort((a, b) => b.overall - a.overall);

  const signed = new Set<string>();
  const sign = (p: Player, teamCode: string, salary: number, term: readonly [number, number]): void => {
    signed.add(p.id);
    p.free_agent = false;
    p.nfl_team = teamCode;
    p.contract = dealFor(teamCode, salary, rng.int(term[0], term[1]));
  };

  for (const code of Object.keys(state.teams)) {
    const roster = Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired);
    const countAt = (pos: Position) => roster.filter((p) => p.position === pos).length;
    const capTotal = state.teams[code]?.cap.total ?? 255;
    // Pass 0 — cut down to a legal roster before filling up to one. A team
    // that just signed a draft class is usually over 53 and over the cap;
    // `used` comes back reflecting the cuts (players only, since coaching
    // salaries aren't a player-cap charge).
    const trimmed = trimToLegalRoster(state, roster, capTotal);
    let used = trimmed.used;
    marketSize += trimmed.released; // the cuts are on the market now

    /**
     * What pass 1 may spend on one starter: the cap, less the working room it
     * leaves untouched, less the minimum every roster spot still to be filled
     * will cost.
     */
    const spendable = (): number =>
      capTotal -
      CAP_WORKING_ROOM -
      used -
      Math.max(0, ROSTER_SIZE - roster.length - 1) * MIN_SALARY_M;

    // Pass 1 — a usable starter at every position. Best player the team can
    // actually *afford*, not best available: signing best-available at market
    // rate ran teams ~$50M over the cap, because a 20-round draft leaves most
    // of them short at several positions at once. A cap-strapped team settles
    // for a cheaper starter, which is both realistic and self-limiting.
    for (const [pos, needed] of Object.entries(STARTER_COUNTS) as [Position, number][]) {
      const pool = byPos.get(pos) ?? [];
      while (countAt(pos) < needed) {
        const room = spendable();
        const idx = pool.findIndex(
          (p) => !signed.has(p.id) && contractValueFor(p.overall, p.position) <= room,
        );
        const p = idx >= 0 ? pool.splice(idx, 1)[0]! : pool.pop();
        if (!p) break;
        if (signed.has(p.id)) continue;
        marketSize--;
        const salary =
          idx >= 0 ? Math.max(MIN_SALARY_M, Math.round(contractValueFor(p.overall, pos) * 10) / 10) : MIN_SALARY_M;
        sign(p, code, salary, STARTER_YEARS);
        used += salary;
        roster.push(p);
      }
    }

    // Pass 2 — depth to a full 53. Best the team can still afford first, then
    // the cheapest real bodies, then camp bodies.
    //
    // This used to take only the cheapest, always at the minimum. That was
    // right when a fantasy-drafted roster left no room, and wrong every year
    // after: once contracts started expiring, teams had $18-124M spare and
    // spent none of it, the back thirty of every roster refilled with the
    // worst players available, and good free agents piled up unsigned — 1,070
    // of them by season five, with the league's median rating sliding 69 to
    // 61. A team with money in hand signs someone worth having.
    for (const { pos, count } of ROSTER_TEMPLATE) {
      const pool = byPos.get(pos) ?? [];
      while (countAt(pos) < count) {
        let p: Player | undefined;
        let salary = MIN_SALARY_M;
        const room = spendable();
        const idx =
          room > MIN_SALARY_M
            ? pool.findIndex(
                (x) => !signed.has(x.id) && contractValueFor(x.overall, x.position) <= room,
              )
            : -1;
        if (idx >= 0) {
          p = pool.splice(idx, 1)[0]!;
          salary = Math.max(MIN_SALARY_M, Math.round(contractValueFor(p.overall, pos) * 10) / 10);
          marketSize--;
        }
        // Late in camp a veteran nobody paid takes what he can get. At the
        // preseason gate a team out of room for market prices signs the best
        // real player it can at a camp deal, before it would invent a camp
        // body: a decade in, 150 fictional depth players sat on rosters while
        // 60 free agents rated 80+ went unsigned all year.
        if (!p && lateMarket) {
          const cheapIdx = pool.findIndex(
            (x) => !signed.has(x.id) && lateMarketDeal(x) <= room && x.overall >= 60,
          );
          if (cheapIdx >= 0) {
            p = pool.splice(cheapIdx, 1)[0]!;
            salary = lateMarketDeal(p);
            marketSize--;
          }
        }
        while (!p && marketSize > MARKET_RESERVE && pool.length > 0) {
          const candidate = pool.pop()!;
          if (signed.has(candidate.id)) continue;
          p = candidate;
          marketSize--;
          break;
        }
        if (!p) {
          p = makeDepthPlayer(pos, state.season, rng);
          state.players[p.id] = p;
        }
        sign(p, code, salary, DEPTH_YEARS);
        used += salary;
        roster.push(p);
      }
    }
  }

  if (signed.size > 0) {
    state.standingFreeAgents = state.standingFreeAgents.filter((id) => !signed.has(id));
  }
}

/**
 * Players at `pos` on `code`, in depth order: the GM's own order where they
 * have set one, otherwise best-first by overall.
 *
 * The depth chart used to live in one screen's `useState`, so re-ordering it
 * changed nothing and survived nothing — an entire stage of the annual cycle
 * that did not do anything. This is what makes it mean something.
 */
export function depthAt(state: LeagueState, code: string, pos: Position): Player[] {
  const at = Object.values(state.players).filter(
    (p) => p.nfl_team === code && !p.retired && p.position === pos,
  );
  const order = state.depthChart?.[code]?.[pos];
  if (!order || order.length === 0) return at.sort((a, b) => b.overall - a.overall);
  const rank = new Map(order.map((id, i) => [id, i]));
  // anyone signed since the chart was set falls in behind it, by overall
  return at.sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      b.overall - a.overall,
  );
}

/** `startingLineup` from a team's roster already in hand — same order rules as `depthAt`. */
function lineupFrom(state: LeagueState, code: string, roster: readonly Player[]): Player[] {
  const out: Player[] = [];
  for (const [pos, n] of Object.entries(STARTER_COUNTS) as [Position, number][]) {
    const at = roster.filter((p) => p.position === pos);
    const order = state.depthChart?.[code]?.[pos];
    if (!order || order.length === 0) at.sort((a, b) => b.overall - a.overall);
    else {
      const rank = new Map(order.map((id, i) => [id, i]));
      at.sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          b.overall - a.overall,
      );
    }
    out.push(...at.slice(0, n));
  }
  return out;
}

/** The starting lineup for a team: the top of the depth chart at each spot. */
export function startingLineup(state: LeagueState, code: string): Player[] {
  const out: Player[] = [];
  for (const [pos, n] of Object.entries(STARTER_COUNTS) as [Position, number][]) {
    out.push(...depthAt(state, code, pos).slice(0, n));
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

  // One pass over the league instead of sixteen per team: this runs after
  // every trade, signing and stage change, and rescanning all ~2,000 players
  // for each team's roster and each of its lineup positions cost ~0.5s a call.
  const byTeam = new Map<string, Player[]>();
  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    const l = byTeam.get(p.nfl_team);
    if (l) l.push(p);
    else byTeam.set(p.nfl_team, [p]);
  }
  const raw: Record<string, { o: number; off: number; def: number; st: number; roster: number }> = {};
  for (const code of codes) {
    const fullRoster = byTeam.get(code) ?? [];
    const starters = lineupFrom(state, code, fullRoster);
    raw[code] = {
      o: mean(starters),
      off: mean(starters.filter((p) => OFF.has(p.position))),
      def: mean(starters.filter((p) => DEF.has(p.position))),
      st: mean(starters.filter((p) => p.position === "K" || p.position === "P"), 68),
      roster: mean(fullRoster),
    };
    // Cap usage (spec's "cap" fields) — current-year *player* cap hits only.
    // Coaching salaries used to be added in here, which isn't how the NFL cap
    // works (it covers players) and had a real consequence: once the hiring
    // window filled all 32 staffs, ~$18M of salaries landed on every team at
    // once and put 30 of them over the cap through no roster decision of their
    // own. Staff cost is still shown on the Roster & Cap screen, as its own
    // line rather than a charge against the player cap.
    //
    // Plus this year's dead money (`cap.dead`: release penalties, a Hooded
    // Figure payment). It used to be added straight onto `used`, which this
    // line then rebuilt from contracts alone — so every charge vanished the
    // next time anything recomputed, usually in the same action.
    const team = state.teams[code]!;
    team.cap.used =
      Math.round((fullRoster.reduce((s, p) => s + (p.contract?.cap_hit_by_year[0] ?? 0), 0) + (team.cap.dead ?? 0)) * 10) / 10;
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
  // Training camp is where a rostered player's year of development happens
  // (`trainingCamp.ts`) — it runs the same aging model, with his position
  // coach and his coordinator's focus on top. Applying the model here as well
  // aged every one of them twice a year. It went unnoticed while camp only
  // ever ran for one team once; with every team training every season, a
  // ten-season league fell from 55 players rated 90+ to 4. So anyone this
  // offseason's camp already developed only gets a year older here, and only
  // the players camp never saw — free agents — take the model at rollover.
  const campedThisOffseason = new Set<string>();
  if (state.trainingCamp && state.trainingCamp.season === season - 1) {
    for (const list of Object.values(state.trainingCamp.results)) {
      for (const r of list) campedThisOffseason.add(r.playerId);
    }
  }
  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    const rng = new Rng((season * 7349) ^ hashSeed(p.id));
    p.age += 1;
    if (campedThisOffseason.has(p.id)) continue;
    const base = agingDelta(
      rng,
      p.age,
      p.dev_age_threshold,
      p.decline_age_threshold,
      p.potential === undefined ? undefined : p.potential - p.overall,
    );
    if (base === 0) continue;

    // Change 3: the position coach scales the move the aging model already
    // decided on. He never decides *whether* a player is still improving —
    // that is this function's call, from age and position — only how much of
    // the improvement or the decline actually lands. A player without a team
    // has nobody coaching him and ages on the raw curve.
    const delta = p.nfl_team
      ? applyCoachToDelta(base, coachModifiersFor(state, p.nfl_team, p.position))
      : base;

    p.overall = clamp(p.overall + delta, 40, 99);
    for (const k of Object.keys(p.attributes)) {
      p.attributes[k] = clamp(p.attributes[k]! + delta, 40, 99);
    }
  }
}

export function createLeague(seed = 1, configIn: LeagueConfig = DEFAULT_CONFIG): LeagueState {
  // A humans-only league has no NFL rosters to inherit, so it always drafts.
  // Settled here, at creation, because two things read it before the league
  // ever forms: the stage machine choosing where setup leads, and the pool
  // being normalised to free agents for the draft.
  const config: LeagueConfig =
    configIn.leagueFormat === "humansOnly" ? { ...configIn, fantasyDraft: true } : configIn;
  const sim = new MockSimulationService();
  const gms = makeGms(config);
  const teams: Record<string, TeamState> = {};
  for (const t of TEAMS) teams[t.code] = blankTeam(t.code);
  for (const g of gms) {
    if (g.isHuman && g.teamCode && teams[g.teamCode]) {
      teams[g.teamCode]!.controlledBy = { kind: "human", gmId: g.id };
    }
  }

  const pool = sim.generateInitialPool(seed, "realRosters");
  // The pool arrives unowned and unpaid — real players carry their team but
  // no contract, because nflverse knows who is on a roster and not what the
  // game should charge for them. `store.newLeague` has always normalised the
  // adapter's pool for this reason; this synchronous path never had to,
  // because the invented pool came pre-signed. Now that it is the real league,
  // it does: without this every player is a free agent and no team has anyone.
  normalizePool(pool, config.fantasyDraft, seed);
  const players: Record<string, Player> = {};
  for (const p of pool) players[p.id] = p;

  const coachList = sim.generateCoachMarket(seed);
  const coaches: Record<string, Coach> = {};
  for (const c of coachList) {
    // Every team keeps the staff it actually has. This used to strip all of
    // them, because a five-day hiring window opened the league by handing
    // ninety-six coaches to thirty-two teams — so Kansas City started without
    // Andy Reid and might never get him back. There is no window now: you
    // start with your real staff and change it when you want to.
    coaches[c.id] = c;
  }

  // the season, not the seed: the year drives the division-pairing rotations,
  // and a random number there would rotate the league arbitrarily
  const schedule = sim.generateSchedule(2026, TEAMS.map((t) => t.code));
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
    coachingDraft: null,
    freeAgencyEvent: null,
    trainingCamp: null,
    tradeDeadline: null,
    reveal: null,
    rookieOutcomes: {},
    freeAgency: null,
    standingFreeAgents: [],
    depthChart: {},
    draftPicks: {},
    coachingHire: null,
    bracket: null,
    trades: [],
    readiness: Object.fromEntries(gms.map((g) => [g.id, g.id !== "gm_you"])),
    stageDeadlineAt: null,
    pendingGameDay: null,
    returnTo: null,
    history: [],
    hoodedFigure: null,
  };
  recomputeTeamRatings(state);
  // draft capital exists from day one — it's tradeable before it's spent.
  // From next season's draft: the first season is played after this
  // offseason, so there is no draft for this one and its picks would be
  // tradeable capital for a draft that never happens.
  ensureDraftPicks(state, state.season + 1);
  return state;
}
