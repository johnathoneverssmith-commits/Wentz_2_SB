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

import { agingDelta, contractValueFor, MockSimulationService } from "@/sim/MockSimulationService";
import { personName } from "@/sim/names.ts";
import { Rng } from "@/sim/rng.ts";
import { OFFSEASON_ROSTER_SIZE, ROSTER_SIZE, ROSTER_TEMPLATE } from "@/sim/roster-template.ts";

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
const CAP_WORKING_ROOM = 18;

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
    name: personName(rng),
    position,
    age,
    nfl_team: "FA",
    years_pro: clamp(age - 22, 0, 8),
    overall,
    attributes: {
      speed: clamp(overall + rng.int(-6, 6), 40, 80),
      strength: clamp(overall + rng.int(-6, 6), 40, 80),
      awareness: clamp(overall + rng.int(-8, 4), 40, 80),
    },
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
 * Sends a rostered player back to the open market.
 *
 * Dead money isn't modeled anywhere in this build (there are no per-player
 * signing-bonus proration records to accelerate), so a release frees the
 * player's whole cap hit. That's the optimistic end of the real rule — a
 * post-June-1 cut of a mostly-earned deal — and it's deliberate: inventing a
 * dead-cap number would be a precision this data doesn't have.
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
  /** Projected starters, who are cut only as a last resort. */
  const protectedIds = (): Set<string> => {
    const keep = new Set<string>();
    for (const [pos, n] of Object.entries(STARTER_COUNTS) as [Position, number][]) {
      roster
        .filter((p) => p.position === pos)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, n)
        .forEach((p) => keep.add(p.id));
    }
    return keep;
  };

  // size first — every cut here also frees cap, so the cap pass has less to do
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
    const keep = protectedIds();
    const expendable = roster.filter((p) => !keep.has(p.id));
    const pool = expendable.length > 0 ? expendable : roster;
    const priciest = pool.reduce((a, b) => (capHitOf(b) > capHitOf(a) ? b : a));
    if (capHitOf(priciest) <= 0) break; // nothing left to shed
    used -= drop(priciest);
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
    const roster = Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired);
    // the offseason ceiling, not 53 — cutting to 53 here would leave a team
    // that drafted well unable to sign anyone in the window that follows
    trimToLegalRoster(state, roster, state.teams[code]?.cap.total ?? 255, OFFSEASON_ROSTER_SIZE);
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
export function fillRosterGaps(state: LeagueState): void {
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

    // pass 2 — depth to a full 53, cheapest real bodies first, then camp bodies
    for (const { pos, count } of ROSTER_TEMPLATE) {
      const pool = byPos.get(pos) ?? [];
      while (countAt(pos) < count) {
        let p: Player | undefined;
        while (marketSize > MARKET_RESERVE && pool.length > 0) {
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
        sign(p, code, MIN_SALARY_M, DEPTH_YEARS);
        used += MIN_SALARY_M;
        roster.push(p);
      }
    }
  }

  if (signed.size > 0) {
    state.standingFreeAgents = state.standingFreeAgents.filter((id) => !signed.has(id));
  }
}

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
    // Cap usage (spec's "cap" fields) — current-year *player* cap hits only.
    // Coaching salaries used to be added in here, which isn't how the NFL cap
    // works (it covers players) and had a real consequence: once the hiring
    // window filled all 32 staffs, ~$18M of salaries landed on every team at
    // once and put 30 of them over the cap through no roster decision of their
    // own. Staff cost is still shown on the Roster & Cap screen, as its own
    // line rather than a charge against the player cap.
    //
    // Dead money from cuts/trades isn't modeled (no per-player dead-cap
    // tracking exists yet) — a simplification, not silently ignored:
    // `cap.dead` stays 0 rather than pretending to a precision this lacks.
    state.teams[code]!.cap.used =
      Math.round(fullRoster.reduce((s, p) => s + (p.contract?.cap_hit_by_year[0] ?? 0), 0) * 10) / 10;
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
