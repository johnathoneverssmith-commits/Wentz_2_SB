/**
 * The Hooded Figure catch-up mechanic (11_HOODED_FIGURE_FINAL_IMPLEMENTATION_SPEC.md).
 *
 * A rare, dark-comedy offer for a human team stuck losing two seasons
 * running. Everything here is deterministic once the payment is submitted:
 * thresholds are generated once per eligible season, the swindle/branch/
 * event/target rolls are seeded from the team, season and payment, and
 * nothing about a reload, reconnect, or re-render can change any of it —
 * the resolved `HoodedFigureEncounter` record is the only source of truth,
 * and every screen just reads it.
 *
 * Mechanics and flavor are deliberately separate (spec §27): this file only
 * ever writes structured fields (event id, tier, target, duration, deltas);
 * the screens render text from those fields, never the other way around.
 */
import type {
  HoodedFigureBranch,
  HoodedFigureEncounter,
  HoodedFigureLeagueState,
  HoodedFigureNegativePlayer,
  HoodedFigureOutcome,
  HoodedFigurePlayerChange,
  HoodedFigurePositiveFamily,
  HoodedFigureTier,
  HoodedFigureThresholds,
  LeagueState,
  Player,
  Position,
  SeasonOutcome,
} from "@/domain";
import { POSITION_GROUPS, POSITION_TO_GROUP } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ratingOf } from "./coachingDraft.ts";

// Deliberately not importing rules.ts's `mulberry`/`weightedPick`: rules.ts
// calls into this module (finalizeSeason -> updateHoodedFigureStreaks), and
// a cross-import back would make the two files circular. Tiny, pure
// deterministic-RNG helpers duplicated per module is the existing pattern
// here (aiStrategy.ts and aiDifficulty.ts each carry their own `hashString`
// rather than share one).
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `weights` need not sum to 1; falls back to uniform if all-zero. */
function weightedPick<T>(rng: () => number, items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

// ---- tunables (spec §30: provisional, flagged for later simulation-based optimization) ----

const ELIGIBLE_STREAK = 2;
const MIN_PAYMENT = 1.0;
const PAYMENT_STEP = 0.5;
const MAX_PAYMENT = 10.0;
const SWINDLE_RATE = 0.05;
const NEGATIVE_BRANCH_RATE = 0.75;
const THRESHOLD_CENTERS = { t1: 2.5, t2: 5.0, t3: 7.5 };
const THRESHOLD_SPREAD = 2.5;
const THRESHOLD_MIN_GAP = 0.3;

const POSITION_BOOST_MAGNITUDE: Record<HoodedFigureTier, number> = { 1: 1, 2: 2, 3: 3, 4: 5 };
const ROOKIE_BOOST_MAGNITUDE: Partial<Record<HoodedFigureTier, number>> = { 2: 3, 3: 5, 4: 8 };
const VETERAN_BOOST_MAGNITUDE: Partial<Record<HoodedFigureTier, number>> = { 3: 5, 4: 8 };
const WHOLE_ROSTER_BOOST_MAGNITUDE = 1;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Standard normal via Box-Muller, from a deterministic [0,1) stream. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---- league state plumbing ----

export function ensureHoodedFigureState(s: LeagueState): HoodedFigureLeagueState {
  if (!s.hoodedFigure) {
    s.hoodedFigure = { losingStreaks: {}, firstNegativeConsumed: false, encountersBySeason: {}, unavailable: [] };
  }
  return s.hoodedFigure;
}

export function isHoodedFigureEligible(s: LeagueState, teamCode: string): boolean {
  return (s.hoodedFigure?.losingStreaks[teamCode] ?? 0) >= ELIGIBLE_STREAK;
}

// ---- §4: determining the losing human team(s) for a season ----

function progressRank(o: SeasonOutcome): number {
  if (o.wonSuperBowl) return 5;
  switch (o.furthestRound) {
    case "SB":
      return 4;
    case "CONF":
      return 3;
    case "DIV":
      return 2;
    case "WC":
      return 1;
    default:
      return 0;
  }
}

function winPct(o: SeasonOutcome): number {
  const g = o.regularSeasonRecord.wins + o.regularSeasonRecord.losses + o.regularSeasonRecord.ties;
  return g === 0 ? 0 : (o.regularSeasonRecord.wins + 0.5 * o.regularSeasonRecord.ties) / g;
}

/** §4: the human team(s) that count as this season's loser, by team code. */
export function determineHoodedFigureLosers(outcomes: SeasonOutcome[]): string[] {
  if (outcomes.length === 0) return [];
  const allMadePlayoffs = outcomes.every((o) => o.madePlayoffs);

  if (!allMadePlayoffs) {
    const worst = Math.min(...outcomes.map(winPct));
    return outcomes.filter((o) => winPct(o) === worst).map((o) => o.teamCode);
  }

  // §4.2: every human team made the playoffs — earliest elimination loses.
  let candidates = outcomes;
  const worstRank = Math.min(...candidates.map(progressRank));
  candidates = candidates.filter((o) => progressRank(o) === worstRank);
  if (candidates.length === 1) return [candidates[0]!.teamCode];

  const withMargin = candidates.filter((o) => o.eliminationMargin != null);
  if (withMargin.length > 0) {
    const maxMargin = Math.max(...withMargin.map((o) => o.eliminationMargin!));
    const tied = withMargin.filter((o) => o.eliminationMargin === maxMargin);
    if (tied.length === 1) return [tied[0]!.teamCode];
    candidates = tied;
  }

  const worstPct = Math.min(...candidates.map(winPct));
  candidates = candidates.filter((o) => winPct(o) === worstPct);
  return candidates.map((o) => o.teamCode);
}

/**
 * Updates every human team's consecutive-losing-season streak for the season
 * just finalized. Call once, right after that season's `SeasonOutcome` rows
 * land in `s.history` (see `finalizeSeason`) — never twice for the same
 * season, or a streak would double-increment.
 */
export function updateHoodedFigureStreaks(s: LeagueState): void {
  const thisSeason = s.history.filter((h) => h.season === s.season);
  if (thisSeason.length === 0) return;
  const losers = new Set(determineHoodedFigureLosers(thisSeason));
  const hf = ensureHoodedFigureState(s);
  for (const o of thisSeason) {
    hf.losingStreaks[o.teamCode] = losers.has(o.teamCode) ? (hf.losingStreaks[o.teamCode] ?? 0) + 1 : 0;
  }
}

// ---- §8: deterministic hidden thresholds ----

function generateThresholds(teamCode: string, season: number): HoodedFigureThresholds {
  const rng = mulberry(hashString(`${teamCode}|${season}|hoodedFigureThresholds`));
  const raw = (
    [
      THRESHOLD_CENTERS.t1 + gaussian(rng) * THRESHOLD_SPREAD,
      THRESHOLD_CENTERS.t2 + gaussian(rng) * THRESHOLD_SPREAD,
      THRESHOLD_CENTERS.t3 + gaussian(rng) * THRESHOLD_SPREAD,
    ] as [number, number, number]
  )
    .map((v) => Math.max(0.1, Math.min(9.9, v)))
    .sort((a, b) => a - b) as [number, number, number];

  let [t1, t2, t3] = raw;
  if (t2 - t1 < THRESHOLD_MIN_GAP) t2 = t1 + THRESHOLD_MIN_GAP;
  if (t3 - t2 < THRESHOLD_MIN_GAP) t3 = t2 + THRESHOLD_MIN_GAP;
  t3 = Math.min(9.9, t3);
  t2 = Math.min(t3 - THRESHOLD_MIN_GAP, t2);
  t1 = Math.min(t2 - THRESHOLD_MIN_GAP, t1);
  return { t1: round1(t1), t2: round1(t2), t3: round1(t3) };
}

function tierFor(payment: number, th: HoodedFigureThresholds): HoodedFigureTier {
  if (payment < th.t1) return 1;
  if (payment < th.t2) return 2;
  if (payment < th.t3) return 3;
  return 4;
}

// ---- §5/§6: creating the encounter for each eligible human GM ----

/** Call on entering the `hoodedFigureEncounter` stage. Idempotent. */
export function ensureHoodedFigureEncounters(s: LeagueState): void {
  const hf = ensureHoodedFigureState(s);
  // A new offseason's encounter is where last season's bargains end — see
  // `clearHoodedFigureTemporaryEffects`. Only once per offseason: the first
  // time this season's encounters are created.
  if (!hf.encountersBySeason[s.season]) clearHoodedFigureTemporaryEffects(s);
  const bySeason = (hf.encountersBySeason[s.season] ??= {});
  for (const g of s.gms) {
    if (!g.isHuman || !g.teamCode) continue;
    if (!isHoodedFigureEligible(s, g.teamCode)) continue;
    if (bySeason[g.teamCode]) continue;
    bySeason[g.teamCode] = {
      teamCode: g.teamCode,
      season: s.season,
      thresholds: generateThresholds(g.teamCode, s.season),
      payment: 0,
      resolved: false,
      swindle: false,
      branch: null,
      tier: null,
      outcome: null,
    };
  }
}

export function hoodedFigureEncounterFor(s: LeagueState, teamCode: string): HoodedFigureEncounter | null {
  return s.hoodedFigure?.encountersBySeason[s.season]?.[teamCode] ?? null;
}

/** True once this GM has nothing left to do on the encounter stage this season. */
export function hoodedFigureStageDone(s: LeagueState, teamCode: string): boolean {
  if (!isHoodedFigureEligible(s, teamCode)) return true;
  return hoodedFigureEncounterFor(s, teamCode)?.resolved ?? false;
}

// ---- §7: payment validation ----

/** min($10M, current cap room), snapped down to a reachable $0.5M step above $1.0M. */
export function hoodedFigureMaxPayment(s: LeagueState, teamCode: string): number {
  const team = s.teams[teamCode];
  if (!team) return 0;
  const room = Math.max(0, team.cap.total - team.cap.used);
  const cap = Math.min(MAX_PAYMENT, room);
  if (cap < MIN_PAYMENT) return 0;
  const steps = Math.floor((cap - MIN_PAYMENT) / PAYMENT_STEP + 1e-9);
  return round1(MIN_PAYMENT + steps * PAYMENT_STEP);
}

export interface HoodedFigurePaymentCheck {
  ok: boolean;
  reason?: string;
}

export function checkHoodedFigurePayment(s: LeagueState, teamCode: string, payment: number): HoodedFigurePaymentCheck {
  if (!Number.isFinite(payment) || payment < 0) return { ok: false, reason: "Enter a valid amount." };
  if (payment === 0) return { ok: true };
  if (payment < MIN_PAYMENT) {
    return { ok: false, reason: `The smallest payment that does anything is $${MIN_PAYMENT.toFixed(1)}M.` };
  }
  const steps = (payment - MIN_PAYMENT) / PAYMENT_STEP;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    return { ok: false, reason: "Payments move in $0.5M steps above $1.0M." };
  }
  const max = hoodedFigureMaxPayment(s, teamCode);
  if (payment > max + 1e-6) {
    return { ok: false, reason: `The most you can offer against your cap space is $${max.toFixed(1)}M.` };
  }
  return { ok: true };
}

// ---- player-effect helpers ----

/** Bumps overall and every attribute the player carries, clamped at 99. */
function bumpPlayer(p: Player, delta: number): HoodedFigurePlayerChange {
  const before = p.overall;
  const after = Math.max(0, Math.min(99, before + delta));
  p.overall = after;
  for (const k of Object.keys(p.attributes)) {
    p.attributes[k] = Math.max(0, Math.min(99, (p.attributes[k] ?? 0) + delta));
  }
  return { playerId: p.id, name: p.name, position: p.position, before, after };
}

function rosterOf(s: LeagueState, teamCode: string): Player[] {
  return Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired && !p.free_agent);
}

function isRookieThisDraft(s: LeagueState, p: Player): boolean {
  return p.years_pro === 0 && p.draft_info?.class_year === s.season;
}

// ---- §14/§15: positive outcome families ----

function applyPositionGroupBoost(s: LeagueState, teamCode: string, tier: HoodedFigureTier, rng: () => number): HoodedFigureOutcome | null {
  const roster = rosterOf(s, teamCode);
  const groupsPresent = POSITION_GROUPS.filter((g) => roster.some((p) => POSITION_TO_GROUP[p.position] === g));
  if (groupsPresent.length === 0) return null;
  const group = groupsPresent[Math.floor(rng() * groupsPresent.length)]!;
  const magnitude = POSITION_BOOST_MAGNITUDE[tier];
  const affected = roster.filter((p) => POSITION_TO_GROUP[p.position] === group);
  const playerChanges = affected.map((p) => bumpPlayer(p, magnitude));
  return {
    eventId: "positive_position_group_boost",
    publicText: `The whole ${group} room quietly got better over the offseason.`,
    family: "position_group_boost",
    positionGroup: group,
    playerChanges,
  };
}

function applyRookieRapidDevelopment(s: LeagueState, teamCode: string, tier: HoodedFigureTier, rng: () => number): HoodedFigureOutcome | null {
  const magnitude = ROOKIE_BOOST_MAGNITUDE[tier];
  if (magnitude === undefined) return null;
  const rookies = rosterOf(s, teamCode).filter((p) => isRookieThisDraft(s, p));
  if (rookies.length === 0) return null;
  // weighted toward earlier picks — not guaranteed the earliest
  const byPick = [...rookies].sort((a, b) => (a.draft_info?.pick ?? 999) - (b.draft_info?.pick ?? 999));
  const weights = byPick.map((_p, i) => 1 / (i + 1));
  const chosen = weightedPick(rng, byPick, weights) ?? byPick[0]!;
  const change = bumpPlayer(chosen, magnitude);
  return {
    eventId: "positive_rookie_rapid_development",
    publicText: `${chosen.name} looked like a completely different player after an offseason of rapid development.`,
    family: "rookie_rapid_development",
    playerChanges: [change],
  };
}

function applyVeteranRenaissance(s: LeagueState, teamCode: string, tier: HoodedFigureTier, rng: () => number): HoodedFigureOutcome | null {
  const magnitude = VETERAN_BOOST_MAGNITUDE[tier];
  if (magnitude === undefined) return null;
  const veterans = rosterOf(s, teamCode).filter((p) => !isRookieThisDraft(s, p));
  if (veterans.length === 0) return null;
  const chosen = veterans[Math.floor(rng() * veterans.length)]!;
  const change = bumpPlayer(chosen, magnitude);
  return {
    eventId: "positive_veteran_renaissance",
    publicText: `${chosen.name} turned back the clock this offseason.`,
    family: "veteran_renaissance",
    playerChanges: [change],
  };
}

function applyWholeRosterBreakthrough(s: LeagueState, teamCode: string): HoodedFigureOutcome | null {
  const roster = rosterOf(s, teamCode);
  if (roster.length === 0) return null;
  const playerChanges = roster.map((p) => bumpPlayer(p, WHOLE_ROSTER_BOOST_MAGNITUDE));
  return {
    eventId: "positive_whole_roster_breakthrough",
    publicText: `Every player on the roster came back from the offseason a little bit better.`,
    family: "whole_roster_breakthrough",
    playerChanges,
  };
}

const POSITIVE_BUILDERS: Record<
  HoodedFigurePositiveFamily,
  (s: LeagueState, teamCode: string, tier: HoodedFigureTier, rng: () => number) => HoodedFigureOutcome | null
> = {
  position_group_boost: applyPositionGroupBoost,
  rookie_rapid_development: applyRookieRapidDevelopment,
  veteran_renaissance: applyVeteranRenaissance,
  whole_roster_breakthrough: (s, teamCode) => applyWholeRosterBreakthrough(s, teamCode),
};

/** §15: which families are even offered at this tier, before eligibility filtering. */
function positiveFamiliesForTier(tier: HoodedFigureTier): HoodedFigurePositiveFamily[] {
  switch (tier) {
    case 1:
      return ["position_group_boost"];
    case 2:
      return ["position_group_boost", "rookie_rapid_development"];
    case 3:
      return ["position_group_boost", "rookie_rapid_development", "veteran_renaissance"];
    case 4:
      return ["position_group_boost", "rookie_rapid_development", "veteran_renaissance", "whole_roster_breakthrough"];
  }
}

function resolvePositiveBranch(s: LeagueState, teamCode: string, tier: HoodedFigureTier, rng: () => number): HoodedFigureOutcome {
  const candidates = positiveFamiliesForTier(tier);
  // §12: uniform selection among whatever actually resolves to a real
  // outcome — an ineligible family (no rookie, empty roster) is dropped and
  // its share redistributed evenly, never retargeted to something else.
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  for (const family of shuffled) {
    const outcome = POSITIVE_BUILDERS[family](s, teamCode, tier, rng);
    if (outcome) return outcome;
  }
  // every family came back ineligible (a maximally degenerate roster) —
  // whole-roster breakthrough on an empty effect is the only thing left
  // that cannot itself be ineligible without an empty roster entirely.
  return {
    eventId: "positive_no_eligible_outcome",
    publicText: "Nothing about the roster was in a position to benefit this year.",
  };
}

// ---- §16-§23: CPU-negative outcomes ----

interface NegativeEventDef {
  id: string;
  tier: HoodedFigureTier;
  mechanic: "absence" | "season_absence" | "multi_absence" | "coach_fired" | "whole_roster_absence";
  weeksRange?: [number, number];
  count?: number;
  requiresPosition?: readonly Position[];
  text: (name: string, extra?: string) => string;
}

const NEGATIVE_EVENTS: NegativeEventDef[] = [
  // Tier I
  {
    id: "cryotherapy_frostbite",
    tier: 1,
    mechanic: "absence",
    weeksRange: [2, 3],
    text: (name) => `${name} tried whole-body cryotherapy without proper foot protection and suffered severe frostbite to both feet.`,
  },
  {
    id: "concrete_wall_won",
    tier: 1,
    mechanic: "absence",
    weeksRange: [1, 2],
    text: (name) => `${name} celebrated a preseason score by head-butting a padded concrete wall and sprained his neck. The wall was fine.`,
  },
  {
    id: "pizza_recovery_drill",
    tier: 1,
    mechanic: "absence",
    weeksRange: [2, 4],
    text: (name) => `${name} dropped a pizza while driving home, instinctively reached to save it, and crashed his car. He broke his arm. The pizza did not survive either.`,
  },
  {
    id: "the_canal_was_right_there",
    tier: 1,
    mechanic: "absence",
    weeksRange: [1, 1],
    requiresPosition: ["P"],
    text: (name) => `${name} was arrested before dawn after deciding a downtown canal looked extremely swimmable. He has been suspended for the team's next game.`,
  },
  {
    id: "helmet_standoff",
    tier: 1,
    mechanic: "absence",
    weeksRange: [1, 2],
    requiresPosition: ["WR"],
    text: (name) => `${name} refused to wear the league-approved replacement for his discontinued favorite helmet and is skipping team activities while he appeals.`,
  },
  // Tier II
  {
    id: "keep_chopping_something_else",
    tier: 2,
    mechanic: "season_absence",
    text: (name) => `${name} missed the stump during a locker-room motivational exercise involving an actual axe and buried it in his own leg. He is done for the season.`,
  },
  {
    id: "the_600_problem",
    tier: 2,
    mechanic: "absence",
    weeksRange: [3, 5],
    text: (name) => `${name} suffered a broken jaw in a locker-room argument over a $600 debt from an offseason trip.`,
  },
  {
    id: "the_bye_week_yacht",
    tier: 2,
    mechanic: "multi_absence",
    count: 3,
    weeksRange: [1, 2],
    text: (name) => `${name} was one of several starters suspended after a bye-week yacht rental ended with police waiting at the dock, phones in the water, and evidence nobody can adequately explain.`,
  },
  {
    id: "fireworks_expert",
    tier: 2,
    mechanic: "absence",
    weeksRange: [4, 6],
    requiresPosition: ["EDGE", "DT"],
    text: (name) => `${name} attempted to launch a large illegal firework on the Fourth of July and suffered serious hand burns.`,
  },
  {
    id: "celebration_season_ending_injury",
    tier: 2,
    mechanic: "season_absence",
    text: (name) => `${name} performed an elaborate celebration after a meaningless preseason score, landed awkwardly, and tore his ACL.`,
  },
  // Tier III
  {
    id: "the_ohio_bar_video",
    tier: 3,
    mechanic: "coach_fired",
    text: () => `The head coach stayed behind after a road loss while the team flew home. Around 1:43 a.m. he was filmed at an Ohio bar in an absurd, thoroughly compromising situation. He has been fired.`,
  },
  {
    id: "accidental_office_upload",
    tier: 3,
    mechanic: "coach_fired",
    text: () => `The head coach recorded a compromising private video in the team office and accidentally uploaded it publicly instead of sending it privately. He has been fired.`,
  },
  {
    id: "the_trailer_park_sting",
    tier: 3,
    mechanic: "coach_fired",
    text: () => `The head coach was arrested around 2 a.m. in an Ohio trailer park in an undercover sting, for an embarrassingly small amount of cash. He has been fired.`,
  },
  {
    id: "motorcycle_personnel_meeting",
    tier: 3,
    mechanic: "coach_fired",
    text: () => `The head coach crashed a motorcycle with a much younger team employee he'd helped hire as the passenger — a relationship never disclosed to the owner, his spouse, or the team. He has been fired.`,
  },
  {
    id: "nightclub_ball_security",
    tier: 3,
    mechanic: "season_absence",
    requiresPosition: ["WR"],
    text: (name) => `${name} brought a handgun into a nightclub in sweatpants; it began sliding down his leg, and discharged when he tried to catch it. He is out for the season.`,
  },
  {
    id: "halftime_retirement",
    tier: 3,
    mechanic: "season_absence",
    text: (name) => `${name} changed into street clothes at halftime, announced "I'm done," and left the building. He is unavailable for the remainder of the season.`,
  },
  {
    id: "photocopied_farewell",
    tier: 3,
    mechanic: "coach_fired",
    text: () => `Players arrived at the facility to find the head coach had accepted another job overnight — identical photocopied goodbye letters were waiting in every locker.`,
  },
  // Tier IV
  {
    id: "the_team_plane",
    tier: 4,
    mechanic: "whole_roster_absence",
    text: () => `The plane carrying the active roster disappeared en route to the first preseason game. The kicker and punter were running late and missed the flight — they're the only ones available all season.`,
  },
  {
    id: "league_investigation_everybody",
    tier: 4,
    mechanic: "whole_roster_absence",
    text: () => `Nearly the entire roster was caught running an underground casino out of the equipment room. The league has suspended the whole operation for the season — kicker and punter excepted.`,
  },
  {
    id: "worst_team_building_retreat",
    tier: 4,
    mechanic: "whole_roster_absence",
    text: () => `The entire roster attended a wilderness team-building retreat. The charter bus mistakenly left without them at an unmarked trailhead several states away. Nobody had a phone. They'll be back next season.`,
  },
];

function eventsForTier(tier: HoodedFigureTier): NegativeEventDef[] {
  return NEGATIVE_EVENTS.filter((e) => e.tier === tier);
}

function eligiblePlayers(s: LeagueState, teamCode: string, positions?: readonly Position[]): Player[] {
  const roster = rosterOf(s, teamCode);
  return positions ? roster.filter((p) => positions.includes(p.position)) : roster;
}

/** §18: weighted toward higher OVR, never guaranteed the single highest. */
function pickWeightedByOverall(rng: () => number, players: Player[]): Player | null {
  if (players.length === 0) return null;
  const weights = players.map((p) => Math.pow(Math.max(1, p.overall), 2));
  return weightedPick(rng, players, weights);
}

function markUnavailable(s: LeagueState, playerId: string, untilWeek: number | null): void {
  const hf = ensureHoodedFigureState(s);
  const existing = hf.unavailable.find((u) => u.playerId === playerId);
  if (existing) existing.untilWeek = untilWeek;
  else hf.unavailable.push({ playerId, untilWeek });
}

function toNegativePlayer(p: Player): HoodedFigureNegativePlayer {
  return { playerId: p.id, name: p.name, position: p.position, overall: p.overall };
}

function fireAndReplaceHeadCoach(s: LeagueState, teamCode: string): void {
  const hc = Object.values(s.coaches).find((c) => c.team === teamCode && c.role === "HC");
  if (hc) {
    hc.team = null;
    hc.contract = null;
  }
  // not the man just fired — he was the best unemployed coach the moment he
  // was let go, and used to be rehired on the spot
  const candidates = Object.values(s.coaches).filter((c) => c.team === null && c.role === "HC" && c !== hc);
  if (candidates.length === 0) return;
  const best = candidates.reduce((a, b) => (ratingOf(b) > ratingOf(a) ? b : a));
  best.team = teamCode;
  best.contract ??= { yearsRemaining: 3, annualValue: 5 };
}

function rankByPriorRecord(codes: string[], s: LeagueState): string[] {
  const pct = (code: string): number => {
    const t = s.teams[code];
    if (!t) return -1;
    const g = t.wins + t.losses + t.ties;
    return g === 0 ? 0 : (t.wins + 0.5 * t.ties) / g;
  };
  return [...codes].sort((a, b) => pct(b) - pct(a));
}

/** §17: divisional rival first, then conference, then league — first team with a valid target for this event wins. */
function selectCpuTarget(s: LeagueState, payingTeam: string, def: NegativeEventDef): string | null {
  const humanCodes = new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
  const meta = TEAMS_BY_CODE[payingTeam];
  const hasValidTarget = (code: string): boolean => {
    if (humanCodes.has(code)) return false;
    if (def.mechanic === "coach_fired") {
      return Object.values(s.coaches).some((c) => c.team === code && c.role === "HC");
    }
    return eligiblePlayers(s, code, def.requiresPosition).length > 0;
  };
  const all = Object.keys(s.teams).filter((c) => c !== payingTeam);
  const division = all.filter((c) => TEAMS_BY_CODE[c]?.conference === meta?.conference && TEAMS_BY_CODE[c]?.division === meta?.division);
  const conference = all.filter((c) => TEAMS_BY_CODE[c]?.conference === meta?.conference);
  for (const pool of [division, conference, all]) {
    const ranked = rankByPriorRecord(pool.filter(hasValidTarget), s);
    if (ranked.length > 0) return ranked[0]!;
  }
  return null;
}

function resolveNegativeBranch(s: LeagueState, payingTeam: string, tier: HoodedFigureTier, rng: () => number): HoodedFigureOutcome {
  let candidates = eventsForTier(tier);
  // filter to events that can actually resolve against a real target before
  // picking uniformly, redistributing probability evenly per §12
  const withTarget = candidates
    .map((def) => ({ def, target: selectCpuTarget(s, payingTeam, def) }))
    .filter((x): x is { def: NegativeEventDef; target: string } => x.target !== null);
  if (withTarget.length === 0) {
    return { eventId: "negative_no_eligible_target", publicText: "No CPU team had anything for the figure to work with this year." };
  }
  const chosen = withTarget[Math.floor(rng() * withTarget.length)]!;
  const { def, target } = chosen;

  switch (def.mechanic) {
    case "coach_fired": {
      fireAndReplaceHeadCoach(s, target);
      return { eventId: def.id, publicText: def.text(""), targetTeam: target, coachFired: true };
    }
    case "whole_roster_absence": {
      const affected = eligiblePlayers(s, target).filter((p) => p.position !== "K" && p.position !== "P");
      for (const p of affected) markUnavailable(s, p.id, null);
      return {
        eventId: def.id,
        publicText: def.text(""),
        targetTeam: target,
        wholeRosterOut: true,
        absenceWeeks: null,
      };
    }
    case "multi_absence": {
      const pool = eligiblePlayers(s, target, def.requiresPosition);
      const count = Math.min(def.count ?? 1, pool.length);
      const chosen_: Player[] = [];
      const remaining = [...pool];
      for (let i = 0; i < count && remaining.length > 0; i++) {
        const p = pickWeightedByOverall(rng, remaining)!;
        chosen_.push(p);
        remaining.splice(remaining.indexOf(p), 1);
      }
      const [lo, hi] = def.weeksRange ?? [1, 1];
      const weeks = lo + Math.floor(rng() * (hi - lo + 1));
      for (const p of chosen_) markUnavailable(s, p.id, weeks);
      return {
        eventId: def.id,
        publicText: def.text(chosen_.map((p) => p.name).join(", ")),
        targetTeam: target,
        negativePlayers: chosen_.map(toNegativePlayer),
        absenceWeeks: weeks,
      };
    }
    case "season_absence": {
      const pool = eligiblePlayers(s, target, def.requiresPosition);
      const player = pickWeightedByOverall(rng, pool)!;
      markUnavailable(s, player.id, null);
      return {
        eventId: def.id,
        publicText: def.text(player.name),
        targetTeam: target,
        negativePlayers: [toNegativePlayer(player)],
        absenceWeeks: null,
      };
    }
    case "absence":
    default: {
      const pool = eligiblePlayers(s, target, def.requiresPosition);
      const player = pickWeightedByOverall(rng, pool)!;
      const [lo, hi] = def.weeksRange ?? [1, 2];
      const weeks = lo + Math.floor(rng() * (hi - lo + 1));
      markUnavailable(s, player.id, weeks);
      return {
        eventId: def.id,
        publicText: def.text(player.name),
        targetTeam: target,
        negativePlayers: [toNegativePlayer(player)],
        absenceWeeks: weeks,
      };
    }
  }
}

// ---- §9-§11/§20-23: the resolution pipeline ----

/**
 * Resolves an eligible GM's submitted payment. Mutates `s` (cap deduction,
 * player/coach effects) and returns the finished, saved encounter. Safe to
 * call only once per encounter — the caller (the store action) is
 * responsible for refusing a resubmission against an already-resolved one.
 */
export function resolveHoodedFigureEncounter(s: LeagueState, teamCode: string, payment: number): HoodedFigureEncounter {
  const hf = ensureHoodedFigureState(s);
  const encounter = hf.encountersBySeason[s.season]?.[teamCode];
  if (!encounter) throw new Error("No hooded-figure encounter to resolve for this team/season.");

  const team = s.teams[teamCode];
  if (team && payment > 0) {
    // dead money, so it survives the next cap recompute
    team.cap.dead = round1((team.cap.dead ?? 0) + payment);
    team.cap.used = round1(team.cap.used + payment);
  }

  encounter.payment = payment;
  encounter.resolved = true;

  if (payment < MIN_PAYMENT) {
    // declined — nothing else happens, nothing to reveal
    return encounter;
  }

  const rng = mulberry(hashString(`${teamCode}|${s.season}|hoodedFigureResolve|${payment}`));
  const swindle = rng() < SWINDLE_RATE;
  encounter.swindle = swindle;
  if (swindle) return encounter;

  const tier = tierFor(payment, encounter.thresholds);
  encounter.tier = tier;

  // §10: the first successful (non-swindle) bargain in the league must be negative.
  let branch: HoodedFigureBranch;
  if (!hf.firstNegativeConsumed) {
    branch = "negative";
    hf.firstNegativeConsumed = true;
  } else {
    branch = rng() < NEGATIVE_BRANCH_RATE ? "negative" : "positive";
  }
  encounter.branch = branch;

  encounter.outcome =
    branch === "negative" ? resolveNegativeBranch(s, teamCode, tier, rng) : resolvePositiveBranch(s, teamCode, tier, rng);

  return encounter;
}

// ---- §28: season-rollover cleanup ----

/**
 * Restores everyone the season's bargains sidelined. Permanent effects
 * (positive ratings, fired coaches) are untouched.
 *
 * Runs when the *next* offseason's encounter opens, not at the season
 * rollover. The encounter always happens before the rollover (training camp →
 * encounter → depth chart → preseason, where the year turns over), so
 * clearing at the rollover wiped the bargain the moment it was struck: a
 * player "done for the season" was back for week 1, and nothing a GM paid
 * for ever reached the field.
 */
export function clearHoodedFigureTemporaryEffects(s: LeagueState): void {
  if (s.hoodedFigure) s.hoodedFigure.unavailable = [];
}

// ---- roster availability (consumed by game simulation) ----

export function isHoodedFigureUnavailable(s: LeagueState, playerId: string, week: number): boolean {
  const entry = s.hoodedFigure?.unavailable.find((u) => u.playerId === playerId);
  if (!entry) return false;
  return entry.untilWeek === null || week <= entry.untilWeek;
}

export function filterHoodedFigureAvailable(s: LeagueState, players: Player[], week: number): Player[] {
  return players.filter((p) => !isHoodedFigureUnavailable(s, p.id, week));
}

// ---- §25: the public "League Developments" reveal ----

/**
 * Which offseason's encounters League Developments reports.
 *
 * The reveal is shown after the preseason, and the season number turns over
 * on the way into the preseason — so by the time anyone reads it, the
 * encounters it describes are filed under the year before. Reading the
 * current year reported "a quiet offseason" over every bargain ever struck.
 */
export function developmentsSeason(s: Pick<LeagueState, "season" | "stage">): number {
  return s.stage === "leagueDevelopments" || s.stage === "preseason" || s.stage === "regularSeason"
    ? s.season - 1
    : s.season;
}

export interface LeagueDevelopmentEntry {
  teamCode: string;
  tier: HoodedFigureTier;
  kind: "positive" | "negative" | "swindle";
  outcome: HoodedFigureOutcome | null;
  /** only populated for the swindle case, per §9.1/§25.5. */
  swindleGmName?: string;
  swindlePayment?: number;
}

const SWINDLE_LINES = [
  "League sources confirm the figure was last seen sprinting toward a 2004 Nissan Altima.",
  "This is now the league's largest known transaction conducted entirely on vibes.",
  "Financial analysts have downgraded the GM from \"GM\" to \"guy who replies to texts from unknown numbers.\"",
];

/** Deterministic, identical for every viewer: tier descending, team code as tiebreak. Never reveals payment/tier for a non-swindle bargain. */
export function leagueDevelopmentsFor(s: LeagueState): LeagueDevelopmentEntry[] {
  const bySeason = s.hoodedFigure?.encountersBySeason[developmentsSeason(s)] ?? {};
  const entries: LeagueDevelopmentEntry[] = [];
  for (const encounter of Object.values(bySeason)) {
    if (!encounter.resolved || encounter.payment < MIN_PAYMENT) continue;
    if (encounter.swindle) {
      const gm = s.gms.find((g) => g.teamCode === encounter.teamCode);
      entries.push({
        teamCode: encounter.teamCode,
        tier: 1,
        kind: "swindle",
        outcome: null,
        swindleGmName: gm?.name ?? encounter.teamCode,
        swindlePayment: encounter.payment,
      });
      continue;
    }
    if (!encounter.branch || !encounter.tier) continue;
    entries.push({
      teamCode: encounter.branch === "negative" ? (encounter.outcome?.targetTeam ?? encounter.teamCode) : encounter.teamCode,
      tier: encounter.tier,
      kind: encounter.branch,
      outcome: encounter.outcome,
    });
  }
  return entries.sort((a, b) => b.tier - a.tier || a.teamCode.localeCompare(b.teamCode));
}

/** A deterministic, stable pick among the humorous swindle lines for this encounter. */
export function swindleLineFor(teamCode: string, season: number): string {
  const h = hashString(`${teamCode}|${season}|swindleLine`);
  return SWINDLE_LINES[h % SWINDLE_LINES.length]!;
}

/**
 * What one GM may know about the figure, online. The league document goes to
 * every GM, so the hidden price points (which would let anyone pay exactly
 * the top tier) and the other GMs' bargains are stripped on the way out —
 * the bargains until the League Developments reveal, when they're public.
 */
export function redactHoodedFigureFor(s: LeagueState, teamCode: string | null): void {
  const hf = s.hoodedFigure;
  if (!hf) return;
  const hidden = { t1: 0, t2: 0, t3: 0 };
  // which branch someone's bargain took, before anyone's been told
  hf.firstNegativeConsumed = false;
  for (const [season, bySeason] of Object.entries(hf.encountersBySeason ?? {})) {
    const year = Number(season);
    const revealed = year < s.season - 1 || (year < s.season && s.stage !== "preseason");
    for (const [code, e] of Object.entries(bySeason)) {
      if (code === teamCode || (revealed && e.resolved)) {
        bySeason[code] = { ...e, thresholds: hidden };
      } else {
        delete bySeason[code];
      }
    }
  }
}
