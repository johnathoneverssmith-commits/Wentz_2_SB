/**
 * Game loop — event chronology per spec §4. TS port of `analysis/engine/sim.py`.
 *
 * Keep behaviourally in step with the Python engine (validated at §22: 15/20
 * league metrics within 10% of the empirical 2023–25 baseline). Rating modifiers
 * are 0 unless a `rosters` pair is supplied. Simplifications flagged in the
 * Python module apply here too (qb_hit / pass_location from marginals,
 * kickoff/XP hard-coded, sack-yд fixed, team aggregates only, penalties for
 * scrimmage + punt).
 */

import {
  predictProba,
  sampleAirYards,
  sampleClass,
  sampleDpiYards,
  sampleExactYards,
  samplePenaltyBucket,
  samplePuntDistance,
  samplePuntReturn,
  sampleRunoff,
  sampleRzYac,
} from "./loaders.js";
import {
  completionLogitShift,
  fgLogitShift,
  interceptionLogitShift,
  rushYardsShift,
  sackLogitShift,
  yacYardsShift,
} from "./ratings.js";
import {
  INJURY_PER_PLAY,
  type InjuryEvent,
  type InjuryPlayContext,
  makeInjury,
} from "./injury.js";
import { Rng } from "./rng.js";
import { homePenaltyScale, homeShift, type HomeEdge } from "./home-field.js";
import { strengthIndex, strengthShift } from "./team-strength.js";
import { type Lineup, type Roster, roster } from "./roster.js";
import type { Staff } from "./staff.js";
import { defSchemeFitShift, offSchemeFitShift } from "./staff-fit.js";
import {
  dcDefenseShift,
  hcGoForItDelta,
  hcPenaltyScale,
  ocOffenseShift,
  ocTempoScale,
} from "./staff-shift.js";

const PASS_LOC = ["left", "middle", "right"] as const;
const PASS_LOC_P = [0.31, 0.38, 0.31];
const QB_HIT_RATE = 0.135;
const QB_HIT_BY_DEPTH: Record<string, number> = {
  BEHIND_LOS: 0.065,
  SHORT: 0.084,
  INTERMEDIATE: 0.113,
  DEEP: 0.132,
};
const M09_COMPLETE_CALIB: Record<string, number> = {
  BEHIND_LOS: 0.3,
  SHORT: 0.03,
  INTERMEDIATE: -0.07,
  DEEP: -0.1,
};
const FUMBLE_LOST_RATE = 0.48;
// M24 snap gaps run ~1 s/play long; trim so drives eat the right wall clock and
// the right number fit per team-game (fewer sec/drive => more drives => more
// scoring). See analysis/engine/sim.py CLOCK_SCALE.
const CLOCK_SCALE = 0.958;
const XP_RATE = 0.958;
const KICKOFF_TOUCHBACK = 0.66;
const PICK_SIX_RATE = 0.088; // share of INTs returned for a TD (2023–25: 111/1254)
const SCOOP_SIX_RATE = 0.064; // share of lost fumbles returned for a TD (2023–25: 55/863)
const KICK_RETURN_TD_RATE = 0.007;
const PUNT_RETURN_TD_RATE = 0.02;
const SACK_YARDS = [-12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
const _syp = [2, 4, 6, 9, 12, 16, 16, 12, 9, 5, 2, 1];
const SACK_YARDS_P = _syp.map((x) => x / _syp.reduce((p, q) => p + q, 0));
/**
 * Global penalty-hazard calibration (V1.7).
 *
 * The penalty module's hazards are fit per situation, and every one of them
 * came out light: the league drew 4.88 flags per team-game against a real
 * 6.16, and three of the four §22 misses were this one number. So this is a
 * single global scale on the fitted hazards rather than a refit — the shape
 * of *when* fouls happen is the part the model earned, and it is not what was
 * wrong.
 *
 * 1.22 measured over 1,500 games, pool-free path:
 *
 *   penalties/team-game   4.88 -> 5.99  (real 6.16, -20.8% -> -2.8%)
 *   penalty yds/team-game 42.2 -> 51.7  (real 50.0, -15.7% -> +3.3%)
 *   DPI/team-game         0.38 -> 0.49  (real 0.52, -26.7% -> -6.0%)
 *
 * Three metrics move from failing to passing. The response is not linear —
 * 1.22 buys 1.23x the flags — because more flags thrown also means more of
 * them are worth accepting, and a declined flag is not a penalty.
 *
 * Points per team-game moves 21.79 -> 21.85, inside the noise at this sample,
 * so this does not disturb the §26 joint calibration. `points_sd` is
 * untouched at 8.87 and remains the one open miss; it is a different problem
 * (the league is too consistent) and wants its own work.
 */
const PENALTY_HAZARD_SCALE = 1.22;

const ENV = { roof: "outdoors", env_temp: 60.0, env_wind: 5.0, temp_missing: 0 } as const;

type Stats = Record<string, number>;
type Ctx = Record<string, number | string>;
type Shift = Record<string, number>;

/** One per drive. `result` is a canonical key (see analysis/lib_py/drives.py). */
export interface DriveRecord {
  team: number;
  startYl: number;
  result: string;
  plays: number;
  crossedMid: boolean;
  points: number;
  firstDowns: number;
}

/** One per scrimmage play — opt-in trace for a play-by-play / field view. */
export interface PlayRec {
  team: number; // 0 home, 1 away — possessing team
  quarter: number;
  clock: string; // mm:ss remaining in the quarter, pre-snap
  down: number;
  ydstogo: number;
  /** distance to the offense's target end zone, pre-snap (100 = own goal line). */
  ballOn: number;
  call: "pass" | "run" | "sack" | "scramble" | "punt" | "field_goal";
  /** air-yard bucket for passes, else "". */
  depth: string;
  gained: number;
  // scrimmage: complete | incomplete | sack | scramble | run | interception | fumble
  // field_goal: made | missed. punt: touchback | downed | returned | return_td
  outcome: string;
  firstDown: boolean;
  touchdown: boolean;
  turnover: boolean;
  /**
   * Cosmetic player attribution for a play-by-play view (needs `rosters`).
   * Picked deterministically from the on-field lineup and the play's own
   * already-rolled numbers (depth/down/distance) — not a modeled usage share,
   * and it costs no extra RNG draws, so it never perturbs the sim.
   */
  passer?: string | undefined;
  /** the intended receiver (pass) or ball-carrier (run/scramble). */
  targetOrRusher?: string | undefined;
  /** the defender credited on a sack / interception / forced fumble. */
  defender?: string | undefined;
  /** kicker (field_goal) or punter (punt) — cosmetic attribution. */
  kicker?: string | undefined;
  /** punt returner, when the punt is fielded and run back — cosmetic attribution. */
  returner?: string | undefined;
  /** field_goal attempt distance, or punt gross distance, in yards. */
  distance?: number | undefined;
  /**
   * [home, away] as the play is snapped.
   *
   * Recorded rather than derived because points don't all arrive on the play
   * that produced them: a pick-six is traced as an interception and *then*
   * scores, and a kickoff return can score between two traced plays. A
   * consumer that wants the score after a play reads the next play's
   * `scoreBefore` (and the game's final score for the last one), which is
   * exact in every one of those cases.
   *
   * Only populated when the trace is on, and costs no RNG draws.
   */
  scoreBefore: [number, number];
}

function clip(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

class Team {
  s: Stats = {};
}

export class Game {
  rng: Rng;
  score: [number, number] = [0, 0];
  teams: [Team, Team] = [new Team(), new Team()];
  qtr = 1;
  gsr = 3600;
  hsr = 1800;
  qsr = 900;
  pos = 0;
  toRemaining: [number, number] = [3, 3];
  yardline100 = 75.0;
  down = 1;
  ydstogo = 10.0;
  receivedOpening = 1;
  rosters: [Roster, Roster] | null;
  staff: [Staff, Staff] | null;
  /** No home team: the Super Bowl, and any sim with no real venue behind it. */
  neutralSite = false;
  rzFlag = false;
  clockStopped = true; // running-clock state for 2-minute-drill management

  // opt-in flavour outputs (null = disabled, [] = collect). Both consume no RNG
  // when disabled, so the validation / parity paths are untouched.
  playTrace: PlayRec[] | null = null;
  injuryLog: InjuryEvent[] | null = null;
  /** ids of starters pulled from THIS game by an injury. */
  readonly injuredOut = new Set<string>();

  // ---- per-drive instrumentation (V1.6 points-gap work) --------------
  // One record per drive: { team, startYl, result, plays, crossedMid, points }.
  drivesLog: DriveRecord[] = [];
  private driveOpen = false;
  private dStartYl = 75.0;
  private dPlays = 0;
  private dCross = false;
  private dTeam = 0;
  private dPts0 = 0;
  private dFd0 = 0;

  constructor(
    rng: Rng,
    rosters: [Roster, Roster] | null = null,
    staff: [Staff, Staff] | null = null,
    neutralSite = false,
  ) {
    this.rng = rng;
    this.rosters = rosters;
    this.staff = staff;
    this.neutralSite = neutralSite;
  }

  // ---- helpers ---------------------------------------------------------
  private other(): number {
    return 1 - this.pos;
  }
  private get ratingsOn(): boolean {
    return this.rosters !== null;
  }
  private get staffOn(): boolean {
    return this.staff !== null;
  }
  /**
   * Which side of the home-field advantage the offense is on.
   *
   * Team index 0 is the home team. Gated on the rating layer for the same
   * reason the coaching layer is: a pool-free `simulateGame(seed)` has two
   * anonymous sides and no venue, so it stays byte-identical to what it was.
   */
  private get homeEdge(): HomeEdge {
    if (!this.ratingsOn || this.neutralSite) return 0;
    return this.pos === 0 ? 1 : -1;
  }

  /**
   * The team-strength edge for the offense, in index points.
   *
   * Gated on the rating layer like everything else that reads a roster: a
   * pool-free `simulateGame(seed)` has no teams to be better or worse than
   * each other, and must stay byte-identical to what it was.
   */
  private strengthEdge(channel: "complete" | "sack" | "rushYards"): number {
    if (!this.ratingsOn) return 0;
    return strengthShift(
      strengthIndex(this.rosters![this.pos as 0 | 1]),
      strengthIndex(this.rosters![this.other() as 0 | 1]),
      channel,
    );
  }

  private off(): Roster {
    return this.rosters![this.pos as 0 | 1];
  }
  private def(): Roster {
    return this.rosters![this.other() as 0 | 1];
  }
  /** possessing team's on-field offense, minus anyone hurt this game. */
  private offLineup(): Lineup {
    return this.off().offense(this.injuredOut);
  }
  private defLineup(nickel = false): Lineup {
    return this.def().defense(nickel, this.injuredOut);
  }
  private clockText(): string {
    const s = Math.max(0, this.qsr);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /**
   * Deterministic "who touched it" pick for the trace — a weighted slot pool
   * per situation, indexed by numbers the play has already rolled (down,
   * distance, depth) so it varies play to play without spending RNG.
   */
  private attribution(
    call: PlayRec["call"],
    depth: string,
    outcome: string,
    down: number,
    ydstogo: number,
  ): {
    passer?: string | undefined;
    targetOrRusher?: string | undefined;
    defender?: string | undefined;
  } {
    if (!this.ratingsOn) return {};
    const o = this.offLineup();
    const d = this.defLineup();
    const seed = down * 7 + Math.round(ydstogo) * 3 + depth.length;
    const pick = (pool: (Lineup[keyof Lineup] | undefined)[]): string | undefined => {
      const names = pool.filter((x): x is NonNullable<typeof x> => !!x).map((x) => x!.name);
      return names.length ? names[seed % names.length] : undefined;
    };

    const forcer = (): string | undefined =>
      pick(call === "run" ? [d.ILB1, d.EDGE1, d.DT1, d.CB1] : [d.CB1, d.S1, d.ILB1, d.EDGE1]);

    if (call === "run") {
      const targetOrRusher = (o.RB1 ?? o.TE1)?.name; // designed run: the back (rare TE fallback)
      return outcome === "fumble" ? { targetOrRusher, defender: forcer() } : { targetOrRusher };
    }
    if (call === "scramble") {
      const name = o.QB1?.name;
      return outcome === "fumble"
        ? { passer: name, targetOrRusher: name, defender: forcer() }
        : { passer: name, targetOrRusher: name };
    }
    if (call === "sack") {
      return { passer: o.QB1?.name, defender: pick([d.EDGE1, d.EDGE2, d.DT1, d.DT2, d.ILB1]) };
    }

    // pass (complete / incomplete / interception / fumble after the catch)
    const passer = o.QB1?.name;
    const receiverPool: Record<string, (Lineup[keyof Lineup] | undefined)[]> = {
      BEHIND_LOS: [o.RB1, o.TE1, o.WR3],
      SHORT: [o.WR2, o.WR3, o.TE1, o.RB1],
      INTERMEDIATE: [o.WR1, o.WR2, o.TE1],
      DEEP: [o.WR1, o.WR2],
    };
    const target = pick(receiverPool[depth] ?? [o.WR1, o.WR2, o.WR3, o.TE1]);
    if (outcome === "interception") {
      const dPool = depth === "DEEP" ? [d.S1, d.S2, d.CB1, d.CB2] : [d.CB1, d.CB2, d.S1];
      return { passer, targetOrRusher: target, defender: pick(dPool) };
    }
    if (outcome === "fumble") return { passer, targetOrRusher: target, defender: forcer() };
    return { passer, targetOrRusher: target };
  }

  /** Deterministic punt-returner pick from the receiving team's skill players. */
  private pickReturner(): string | undefined {
    if (!this.ratingsOn) return undefined;
    const o = this.def().offense(this.injuredOut); // this.pos is still the kicking team here
    const pool = [o.WR3, o.RB1, o.WR2].filter((x): x is NonNullable<typeof x> => !!x);
    return pool.length ? pool[Math.round(this.yardline100) % pool.length]!.name : undefined;
  }

  private tracePlay(p: {
    call: PlayRec["call"];
    depth: string;
    gained: number;
    outcome: string;
    down: number;
    ydstogo: number;
    ballOn: number;
    quarter: number;
    clock: string;
    firstDown: boolean;
    touchdown: boolean;
    turnover: boolean;
  }): void {
    if (this.playTrace)
      this.playTrace.push({
        team: this.pos as 0 | 1,
        scoreBefore: [this.score[0], this.score[1]],
        ...p,
        gained: Math.round(p.gained),
        ballOn: Math.round(p.ballOn),
        ydstogo: Math.round(p.ydstogo * 10) / 10,
        ...this.attribution(p.call, p.depth, p.outcome, p.down, p.ydstogo),
      });
  }

  /** One per-play injury hazard roll. No-op (and no RNG draw) unless collecting. */
  private rollInjury(
    call: PlayRec["call"],
    depth: string,
    gained: number,
    outcome: string,
    quarter: number,
    clock: string,
  ): void {
    if (!this.injuryLog || !this.ratingsOn) return;
    if (this.rng.random() >= INJURY_PER_PLAY) return;
    const slots = (l: Lineup) =>
      Object.entries(l).map(([slot, player]) => ({ slot, player: player ?? undefined }));
    const ctx: InjuryPlayContext = {
      offenseTeam: this.off().team,
      defenseTeam: this.def().team,
      quarter,
      clock,
      call,
      outcome,
      gained,
      depth,
      offense: slots(this.offLineup()),
      defense: slots(this.defLineup()),
    };
    const ev = makeInjury(this.rng, ctx);
    if (!ev) return;
    if (this.playTrace) ev.playIndex = this.playTrace.length - 1; // tracePlay ran first
    this.injuryLog.push(ev);
    this.injuredOut.add(ev.playerId); // next man up for the rest of the game
  }
  /** Staff of the team currently on offense / defense. */
  private offStaff(): Staff {
    return this.staff![this.pos as 0 | 1];
  }
  private defStaff(): Staff {
    return this.staff![this.other() as 0 | 1];
  }
  /** Penalty-hazard multiplier — average of both head coaches' discipline. */
  private penScale(): number {
    if (!this.staffOn) return 1;
    return (
      (hcPenaltyScale(this.staff![0].headCoach) + hcPenaltyScale(this.staff![1].headCoach)) / 2
    );
  }

  /**
   * Coaching contribution to the offense's resolvers: the possessing team's OC
   * boost + the defending team's DC suppression/blitz. Zero without a staff.
   */
  private staffOffShift(): { complete: number; rush: number; sack: number } {
    if (!this.staffOn || !this.ratingsOn) return { complete: 0, rush: 0, sack: 0 };
    const ocS = this.offStaff().oc;
    const dcS = this.defStaff().dc;
    const oc = ocOffenseShift(ocS);
    const dc = dcDefenseShift(dcS);
    const o = this.offLineup();
    const d = this.defLineup();
    const offTags = [o.QB1, o.RB1, o.WR1, o.WR2, o.WR3, o.TE1, o.LT, o.LG, o.C, o.RG, o.RT].map(
      (p) => p?.scheme_tags,
    );
    const defTags = [d.EDGE1, d.EDGE2, d.DT1, d.DT2, d.ILB1, d.ILB2, d.CB1, d.CB2, d.S1, d.S2].map(
      (p) => p?.scheme_tags,
    );
    const ofit = offSchemeFitShift(ocS.scheme, offTags);
    const dfit = defSchemeFitShift(dcS.scheme, defTags);
    return {
      complete: oc.complete + dc.complete + ofit.complete + dfit.complete,
      rush: oc.rush + dc.rush + ofit.rush + dfit.rush,
      sack: dc.sack,
    };
  }

  private offShift(kind: "M09" | "M04" | "M20"): Shift | null {
    if (!this.ratingsOn) return null;
    const o = this.offLineup();
    const d = this.defLineup(this.down >= 3 && this.ydstogo >= 6);
    const catchers = [o.WR1, o.WR2, o.WR3, o.TE1];
    const dbs = [d.CB1, d.CB2, d.S1, d.S2];
    if (d.CB3 !== undefined) dbs.push(d.CB3);
    const ol = [o.LT, o.LG, o.C, o.RG, o.RT];
    const rush = [d.EDGE1, d.EDGE2, d.DT1, d.DT2];
    const staff = this.staffOffShift();
    // home field rides the same rails as the coaching layer: a logit nudge on
    // the resolvers where the real advantage was measured (`home-field.ts`)
    const edge = this.homeEdge;
    if (kind === "M09") {
      return {
        COMPLETE:
          completionLogitShift(catchers, dbs, o.QB1 ?? null) +
          staff.complete +
          homeShift(edge, "complete") +
          this.strengthEdge("complete"),
        INTERCEPTION: interceptionLogitShift(o.QB1 ?? null) + homeShift(edge, "interception"),
      };
    }
    if (kind === "M04") {
      return {
        SACK:
          sackLogitShift(ol, rush) + staff.sack + homeShift(edge, "sack") + this.strengthEdge("sack"),
      };
    }
    if (kind === "M20") {
      return { MADE: fgLogitShift(this.off().kicker()) + homeShift(edge, "fgMade") };
    }
    return null;
  }

  private rushYdMod(): number {
    if (!this.ratingsOn) return 0;
    const o = this.offLineup();
    const d = this.defLineup();
    const front7 = [d.EDGE1, d.EDGE2, d.DT1, d.DT2, d.ILB1, d.ILB2];
    return (
      rushYardsShift([o.LT, o.LG, o.C, o.RG, o.RT], front7, o.RB1 ?? null) +
      this.staffOffShift().rush +
      homeShift(this.homeEdge, "rushYards") +
      this.strengthEdge("rushYards")
    );
  }

  private yacYdMod(): number {
    if (!this.ratingsOn) return 0;
    const o = this.offLineup();
    const d = this.defLineup();
    const tacklers = [d.CB1, d.CB2, d.S1, d.S2, d.ILB1, d.ILB2];
    return yacYardsShift(o.WR1 ?? null, tacklers);
  }

  private st(k: string, v = 1, team?: number): void {
    const s = this.teams[(team ?? this.pos) as 0 | 1].s;
    s[k] = (s[k] ?? 0) + v;
  }

  // ---- per-drive instrumentation --------------------------------
  private startDrive(): void {
    this.driveOpen = true;
    this.dStartYl = this.yardline100;
    this.dPlays = 0;
    this.dCross = this.yardline100 < 50.0;
    this.dTeam = this.pos;
    this.dPts0 = this.score[this.pos as 0 | 1];
    this.dFd0 = this.teams[this.pos as 0 | 1].s.first_down ?? 0;
    this.clockStopped = true; // clock is stopped on any change of possession
  }

  private finishDrive(result: string): void {
    // A 0-play drive that only "ends the half" never happened (e.g. the OT
    // kickoff after a walk-off score) — drop it.
    if (!this.driveOpen || (this.dPlays === 0 && result === "end_of_half")) {
      this.driveOpen = false;
      return;
    }
    this.driveOpen = false;
    this.drivesLog.push({
      team: this.dTeam,
      startYl: this.dStartYl,
      result,
      plays: this.dPlays,
      crossedMid: this.dCross,
      points: this.score[this.dTeam as 0 | 1] - this.dPts0,
      firstDowns: (this.teams[this.dTeam as 0 | 1].s.first_down ?? 0) - this.dFd0,
    });
  }

  private ctx(shotgun = 0): Ctx {
    return {
      down: this.down,
      ydstogo: this.ydstogo,
      yardline_100: this.yardline100,
      goal_to_go: this.yardline100 <= this.ydstogo ? 1 : 0,
      qtr: this.qtr,
      game_seconds_remaining: this.gsr,
      half_seconds_remaining: this.hsr,
      score_differential: this.score[this.pos as 0 | 1] - this.score[this.other() as 0 | 1],
      posteam_timeouts_remaining: this.toRemaining[this.pos as 0 | 1],
      defteam_timeouts_remaining: this.toRemaining[this.other() as 0 | 1],
      shotgun,
      is_home_offense: 1 - this.pos,
      ...ENV,
    };
  }

  // ---- clock ---------------------------------------------------------

  /**
   * Move to the next quarter once this one is spent.
   *
   * Every path that can take `qsr` to zero has to call this, and for a long
   * time two of them didn't — see `burn`.
   */
  private rollQuarter(): void {
    if (this.qsr === 0 && this.gsr > 0) {
      this.qtr += 1;
      this.qsr = 900;
      if (this.qtr === 3) {
        this.hsr = 1800;
        this.toRemaining = [3, 3];
        this.kickoff(1 - this.receivedOpening, "end_of_half");
      }
    }
  }

  /**
   * Take `seconds` off every clock at once, credit them as possession, and
   * roll the quarter if that spent it.
   *
   * The three counters have to move together, and the reason is not
   * bookkeeping neatness. `qsr` floors at zero and `hsr` doesn't, so a runoff
   * that overshoots the end of a quarter takes more off the half than off the
   * quarter, and the gap can never be recovered. Let that happen a few times
   * and the half runs out while the quarter still has time on it — at which
   * point the end-of-half machinery has nothing to end, no play advances the
   * clock, and the game spins until the 400-play guard stops it. That was
   * roughly one game in 370 finishing at halftime, with a box score to match.
   *
   * The two paths that used to subtract a fixed amount without capping or
   * rolling — a dead-ball penalty's four seconds and a spike's one — go
   * through here now.
   */
  private burn(seconds: number): void {
    const e = this.qsr > 0 ? Math.min(seconds, this.qsr) : seconds;
    this.gsr = Math.max(0, this.gsr - e);
    this.hsr = Math.max(0, this.hsr - e);
    this.qsr = Math.max(0, this.qsr - e);
    this.st("top", e);
    this.rollQuarter();
  }

  private advanceClock(bucket: string, noHuddle = 0, driveEnds = false): void {
    const cs = this.gsr <= 300 ? "final_5min" : this.gsr <= 600 ? "final_10min" : "normal";
    let e = sampleRunoff(bucket, noHuddle, cs, this.rng) * CLOCK_SCALE;
    if (this.staffOn) e = e * ocTempoScale(this.offStaff().oc);
    if (driveEnds) e = e * 0.65;
    e = Math.round(e);
    if (this.qsr > 0) e = Math.min(e, this.qsr);
    this.gsr = Math.max(0, this.gsr - e);
    this.hsr = Math.max(0, this.hsr - e);
    this.qsr = Math.max(0, this.qsr - e);
    this.st("top", e);
    this.rollQuarter();
  }

  // ---- scoring / possession ---------------------------------------
  private scorePts(pts: number, team?: number): void {
    this.score[(team ?? this.pos) as 0 | 1] += pts;
    this.st("points", pts, team);
  }

  private touchdown(): void {
    this.scorePts(6);
    this.st("td");
    if (this.rng.random() < XP_RATE) this.scorePts(1);
    this.kickoff(this.other());
  }

  private turnover(returnYards = 0, spot?: number, result = "downs"): void {
    this.finishDrive(result);
    const yl = spot ?? this.yardline100;
    this.pos = this.other();
    this.yardline100 = clip(100 - yl - returnYards, 1, 99);
    this.down = 1;
    this.ydstogo = Math.min(10.0, this.yardline100);
    this.st("drives");
    this.rzFlag = false;
    this.startDrive();
  }

  private kickoff(receiving: number, result = "touchdown"): void {
    this.finishDrive(result); // close the drive that led to this kickoff
    this.pos = receiving;
    if (this.rng.random() < KICKOFF_TOUCHBACK) {
      this.yardline100 = 70.0;
    } else {
      if (this.rng.random() < KICK_RETURN_TD_RATE) {
        this.scorePts(6, receiving);
        this.st("st_td", 1, receiving);
        if (this.rng.random() < XP_RATE) this.scorePts(1, receiving);
        this.kickoff(1 - receiving);
        return;
      }
      const spot = 25 + this.rng.normal(3, 6);
      this.yardline100 = clip(100 - spot, 55, 99);
    }
    this.down = 1;
    this.ydstogo = 10.0;
    this.st("drives", 1, receiving);
    this.rzFlag = false;
    this.startDrive();
  }

  private newSeries(firstDown: boolean): void {
    if (firstDown) {
      this.down = 1;
      this.ydstogo = Math.min(10.0, this.yardline100);
    }
  }

  // ---- penalties (Model 25) ------------------------------------
  private penCtx(playFamily?: string): Ctx {
    const c: Ctx = { ...this.ctx(0), posteam_type: this.pos === 0 ? "home" : "away" };
    if (playFamily !== undefined) c.play_family = playFamily;
    return c;
  }

  private presnapPenalty(): boolean {
    // the crowd-noise channel: a road offense that can't hear its own snap
    // count false-starts more, and that is where the measured foul gap is
    const p =
      (predictProba("M25a", this.penCtx()).DEADBALL_PEN ?? 0.032) *
      PENALTY_HAZARD_SCALE *
      this.penScale() *
      homePenaltyScale(this.homeEdge);
    if (this.rng.random() >= p) return false;
    const b = samplePenaltyBucket("deadball", "ALL", this.rng);
    const onOff = this.rng.random() < b.off_share;
    const team = onOff ? this.pos : this.other();
    this.st("penalty", 1, team);
    this.st("penalty_yards", 5.0, team);
    if (onOff) {
      this.yardline100 = Math.min(this.yardline100 + 5.0, 99.0);
      this.ydstogo += 5.0;
    } else {
      this.yardline100 = Math.max(this.yardline100 - 5.0, 1.0);
      if (5.0 >= this.ydstogo) {
        this.st("first_down");
        this.newSeries(true);
      } else {
        this.ydstogo -= 5.0;
      }
    }
    // Capped at what's left in the quarter, like every other runoff.
    //
    // Uncapped, `qsr` floors at zero while `hsr` takes the whole four
    // seconds, and the two drift apart by the difference — permanently,
    // because the floor can't be undone. Enough of those and the half runs
    // out while the quarter still has time on it, at which point the
    // end-of-half logic has nothing to end and the game spins until the
    // 400-play guard stops it. That is how roughly one game in 370 used to
    // finish at halftime.
    // the offense still has the ball through a dead-ball penalty, so the
    // four seconds are its possession like any other runoff
    this.burn(4);
    return true;
  }

  private liveballPenalty(playFamily: string, gained: number, s0: [Stats, Stats]): boolean {
    const b = samplePenaltyBucket("liveball", playFamily, this.rng);
    const onOff = this.rng.random() < b.off_share;
    let yd: number;
    if (b.is_spot_foul) {
      const band =
        this.yardline100 <= 20 ? "opp_rz" : this.yardline100 <= 50 ? "opp_mid" : "own_half";
      yd = Math.min(sampleDpiYards(band, this.rng), this.yardline100 - 1.0);
    } else {
      yd = Math.round(b.mean_yards / 5.0) * 5 || 5.0;
    }
    const autoFirst = this.rng.random() < b.p_auto_first;
    const gainedFirst = this.ydstogo - gained <= 0;

    if (onOff) {
      if (gained <= -yd && !gainedFirst) return false;
    } else if (autoFirst) {
      if (gainedFirst && gained >= yd) return false;
    } else {
      if (gainedFirst || gained >= yd) return false;
    }

    // accept: nullify the play
    this.teams[0].s = { ...s0[0] };
    this.teams[1].s = { ...s0[1] };
    const team = onOff ? this.pos : this.other();
    this.st("penalty", 1, team);
    this.st("penalty_yards", yd, team);
    if (b.bucket === "defensive_pass_interference") this.st("dpi", 1, this.other());

    if (onOff) {
      this.yardline100 = Math.min(this.yardline100 + yd, 99.0);
      this.ydstogo += yd;
      if (b.bucket === "intentional_grounding") this.down = Math.min(this.down + 1, 4);
    } else {
      this.yardline100 = Math.max(this.yardline100 - yd, 1.0);
      if (autoFirst || yd >= this.ydstogo) {
        this.st("auto_first_pen");
        this.st("first_down"); // nflverse counts a penalty first down
        this.newSeries(true);
      } else {
        this.ydstogo -= yd;
      }
    }
    this.advanceClock("pass_incomplete");
    return true;
  }

  // ---- one play ------------------------------------------------
  private canKneelOut(): boolean {
    if (this.score[this.pos as 0 | 1] - this.score[this.other() as 0 | 1] <= 0) return false;
    if (!(this.qsr <= 150 && (this.qtr === 2 || this.qtr === 4))) return false;
    const burnable = 2 + 42 * (4 - this.down) - 40 * this.toRemaining[this.other() as 0 | 1];
    return this.hsr <= burnable;
  }

  private kneelOut(): void {
    this.st("kneel_out");
    this.dPlays += 1;
    const e = this.qsr > 0 ? Math.min(this.hsr, this.qsr) : this.hsr;
    this.gsr = Math.max(0, this.gsr - e);
    this.hsr = Math.max(0, this.hsr - e);
    this.qsr = Math.max(0, this.qsr - e);
    this.st("top", e);
    this.rollQuarter();
  }

  // ---- 2-minute-drill clock management (needed for play-by-play mode) ----
  private hurryUp(): boolean {
    return (
      (this.qtr === 2 || this.qtr === 4) &&
      this.hsr <= 130 &&
      this.score[this.pos as 0 | 1] - this.score[this.other() as 0 | 1] <= 8
    );
  }

  private endHalfFg(): boolean {
    return (
      (this.qtr === 2 || this.qtr === 4) && this.hsr <= 6 && this.down <= 4 && this.yardline100 <= 40
    );
  }

  private spike(): void {
    this.st("spike");
    this.dPlays += 1;
    this.burn(1);
    this.clockStopped = true;
    this.down = Math.min(this.down + 1, 4);
  }

  private kickFg(result = "field_goal", endOfHalf = false): void {
    this.st("fg_att");
    const preDown = this.down;
    const preToGo = this.ydstogo;
    const preYl = this.yardline100;
    const preQtr = this.qtr;
    const preClock = this.clockText();
    const ctx: Ctx = { kick_distance: this.yardline100 + 18, yardline_100: this.yardline100, ...ENV };
    const made = (predictProba("M20", ctx, this.offShift("M20")).MADE ?? 0.85) > this.rng.random();
    if (this.playTrace)
      this.playTrace.push({
        team: this.pos as 0 | 1,
        scoreBefore: [this.score[0], this.score[1]],
        quarter: preQtr,
        clock: preClock,
        down: preDown,
        ydstogo: preToGo,
        ballOn: Math.round(preYl),
        call: "field_goal",
        depth: "",
        gained: 0,
        outcome: made ? "made" : "missed",
        firstDown: false,
        touchdown: false,
        turnover: false,
        kicker: this.ratingsOn ? (this.off().kicker()?.name ?? undefined) : undefined,
        distance: Math.round(preYl + 18),
      });
    if (made) {
      this.st("fg_made");
      this.scorePts(3);
    }
    if (endOfHalf) {
      // whatever is left runs out on the kickoff and the return; nobody
      // snaps it again, but the two teams' possession still has to add up to
      // the sixty minutes the game lasted
      this.st("top", this.qsr);
      this.gsr = Math.max(0, this.gsr - this.qsr);
      this.hsr = 0;
      this.qsr = 0;
      this.finishDrive(made ? result : "missed_fg");
      if (this.qtr === 2 && this.gsr > 0) {
        this.qtr = 3;
        this.qsr = 900;
        this.hsr = 1800;
        this.toRemaining = [3, 3];
        this.kickoff(1 - this.receivedOpening, "field_goal");
      }
      return;
    }
    this.advanceClock("run_inbounds", 0, true);
    if (made) this.kickoff(this.other(), result);
    else this.turnover(0, this.yardline100, "missed_fg");
  }

  private play(): void {
    this.st("plays");
    if (this.canKneelOut()) return this.kneelOut();
    if (this.endHalfFg()) {
      this.dPlays += 1;
      return this.kickFg("field_goal", true);
    }
    if (this.hurryUp() && !this.clockStopped) {
      if (this.toRemaining[this.pos as 0 | 1] > 0 && this.hsr <= 85 && (this.down === 1 || this.down === 4)) {
        this.toRemaining[this.pos as 0 | 1] -= 1;
        this.clockStopped = true;
      } else if (this.down <= 3 && this.hsr >= 4 && this.hsr <= 40) {
        return this.spike();
      }
    }
    this.dPlays += 1;
    if (this.down === 3) this.st("third_att");
    if (this.down === 4) return this.fourthDown();
    return this.scrimmage(false);
  }

  private fourthDown(): void {
    const m01Shift = this.staffOn
      ? { GO_FOR_IT: hcGoForItDelta(this.offStaff().headCoach) }
      : undefined;
    const act = sampleClass("M01", this.ctx(), this.rng, m01Shift);
    if (act === "FIELD_GOAL") return this.kickFg("field_goal");
    if (act === "PUNT") {
      this.st("punt");
      const preDown = this.down;
      const preToGo = this.ydstogo;
      const preYl = this.yardline100;
      const preQtr = this.qtr;
      const preClock = this.clockText();
      const dist = samplePuntDistance(this.yardline100, this.rng);
      const landing = this.yardline100 - dist;
      this.advanceClock("run_inbounds", 0, true);
      const kicker = this.ratingsOn ? (this.off().punter()?.name ?? undefined) : undefined;
      const tracePunt = (outcome: string, newYl: number, returner?: string | undefined): void => {
        if (!this.playTrace) return;
        this.playTrace.push({
          team: this.pos as 0 | 1,
          scoreBefore: [this.score[0], this.score[1]],
          quarter: preQtr,
          clock: preClock,
          down: preDown,
          ydstogo: preToGo,
          ballOn: Math.round(preYl),
          call: "punt",
          depth: "",
          gained: Math.round(preYl - (100 - newYl)),
          outcome,
          firstDown: false,
          touchdown: false,
          turnover: false,
          kicker,
          returner,
          distance: Math.round(dist),
        });
      };
      if (landing <= 0) {
        this.st("touchback");
        tracePunt("touchback", 80.0);
        this.flipField(80.0); // receiving team, 1st-and-10 at its own 20
      } else {
        const out = sampleClass("M21", { yardline_100: this.yardline100, ...ENV }, this.rng);
        if (out === "RETURNED" && this.rng.random() < PUNT_RETURN_TD_RATE) {
          const r = this.other();
          // the return carries the ball to the kicking team's own goal line —
          // i.e. distance 0 from the *receiving* team's target end zone.
          tracePunt("return_td", 0, this.pickReturner());
          this.scorePts(6, r);
          this.st("st_td", 1, r);
          if (this.rng.random() < XP_RATE) this.scorePts(1, r);
          // nflverse codes the punting team's drive as "Opp touchdown"
          this.kickoff(this.pos, "opp_touchdown");
          return;
        }
        const ret = out === "RETURNED" ? samplePuntReturn(this.rng) : 0;
        // receiving team's yardline_100 = 100 − landing spot, then a return
        // advances them toward the punting team's goal (−ret).
        const newYl = 100 - landing - ret;
        tracePunt(out === "RETURNED" ? "returned" : "downed", newYl, out === "RETURNED" ? this.pickReturner() : undefined);
        this.flipField(newYl);
      }
      this.puntPenalty();
      return;
    }
    // GO_FOR_IT
    this.scrimmage(true);
  }

  private puntPenalty(): void {
    const p =
      (predictProba("M25b", this.penCtx("punt")).LIVEBALL_PEN ?? 0.084) * PENALTY_HAZARD_SCALE * this.penScale();
    if (this.rng.random() >= p) return;
    const b = samplePenaltyBucket("liveball", "punt", this.rng);
    const yd = Math.round(b.mean_yards / 5.0) * 5 || 10.0;
    const onOff = this.rng.random() < b.off_share;
    const team = onOff ? this.pos : this.other();
    this.st("penalty", 1, team);
    this.st("penalty_yards", yd, team);
    if (onOff) this.yardline100 = Math.min(this.yardline100 + yd, 99.0);
    else this.yardline100 = Math.max(this.yardline100 - yd, 1.0);
    this.ydstogo = Math.min(10.0, this.yardline100);
  }

  private flipField(newYl: number, result = "punt"): void {
    this.finishDrive(result);
    this.pos = this.other();
    this.yardline100 = clip(newYl, 1, 99);
    this.down = 1;
    this.ydstogo = Math.min(10.0, this.yardline100);
    this.st("drives");
    this.rzFlag = false;
    this.startDrive();
  }

  // ---- scrimmage play --------------------------------------
  private scrimmage(_goForIt: boolean): void {
    for (let i = 0; i < 2; i++) {
      if (!this.presnapPenalty()) break;
      this.dPlays += 1; // a dead-ball foul is its own nflverse no_play row
    }
    const s0: [Stats, Stats] = [{ ...this.teams[0].s }, { ...this.teams[1].s }];
    const call = sampleClass("M02", this.ctx(0), this.rng);
    const sg = sampleClass("M03", { ...this.ctx(0), play_call: call }, this.rng) === "SHOTGUN" ? 1 : 0;

    let gained = 0.0;
    let turnover = false;
    let family = "designed_rush";
    let outcomeBucket = "run_inbounds";
    let yacAdded = 0;
    let playDepth = ""; // air-yard bucket, set on a THROW
    // pre-snap snapshot for the trace / injury context
    const preDown = this.down;
    const preToGo = this.ydstogo;
    const preYl = this.yardline100;
    const preQtr = this.qtr;
    const preClock = this.clockText();

    if (call === "DROPBACK") {
      const term = sampleClass("M04", this.ctx(sg), this.rng, this.offShift("M04"));
      this.st("dropbacks");
      if (term === "SACK") {
        this.st("sack");
        gained = this.rng.choice(SACK_YARDS, SACK_YARDS_P);
        family = "sack";
        outcomeBucket = "sack";
      } else if (term === "SCRAMBLE") {
        this.st("scramble");
        const cat = sampleClass("M11", this.ctx(sg), this.rng);
        const bucket = `${this.down}|${this.yardline100 <= 20 ? "rz" : this.yardline100 <= 60 ? "mid" : "own"}`;
        gained = sampleExactYards("m11", cat, bucket, this.rng);
        family = "scramble";
        outcomeBucket = "scramble";
      } else {
        // THROW
        this.st("pass_att");
        let depth = sampleClass("M05", this.ctx(sg), this.rng);
        let ay = sampleAirYards(depth, this.down, this.yardline100, this.rng);
        ay = Math.trunc(Math.min(ay, this.yardline100 + 3));
        depth = ay < 0 ? "BEHIND_LOS" : ay <= 9 ? "SHORT" : ay <= 19 ? "INTERMEDIATE" : "DEEP";
        playDepth = depth;
        const ploc = this.rng.choice(PASS_LOC, PASS_LOC_P);
        const qbHit = this.rng.random() < (QB_HIT_BY_DEPTH[depth] ?? QB_HIT_RATE) ? 1 : 0;
        const base = this.offShift("M09") ?? {};
        const m09Shift: Shift = {
          ...base,
          COMPLETE: (base.COMPLETE ?? 0) + (M09_COMPLETE_CALIB[depth] ?? 0),
        };
        const res = sampleClass(
          "M09",
          { ...this.ctx(sg), air_yards: ay, depth_category: depth, pass_location: ploc, qb_hit: qbHit },
          this.rng,
          m09Shift,
        );
        this.st("air_yards", ay);
        if (res === "INTERCEPTION") {
          this.st("int_thrown");
          this.st("turnover");
          this.tracePlay({
            call: "pass",
            depth,
            gained: 0,
            outcome: "interception",
            down: preDown,
            ydstogo: preToGo,
            ballOn: preYl,
            quarter: preQtr,
            clock: preClock,
            firstDown: false,
            touchdown: false,
            turnover: true,
          });
          this.rollInjury("pass", depth, 0, "interception", preQtr, preClock);
          if (this.rng.random() < PICK_SIX_RATE) {
            this.advanceClock("pass_incomplete");
            const d = this.other();
            this.scorePts(6, d);
            this.st("def_td", 1, d);
            if (this.rng.random() < XP_RATE) this.scorePts(1, d);
            this.kickoff(this.pos, "opp_touchdown");
            return;
          }
          this.turnover(
            this.rng.normal(6, 8),
            clip(this.yardline100 - ay, 1, 99),
            "interception",
          );
          this.advanceClock("pass_incomplete");
          return;
        }
        if (res === "OTHER_INCOMPLETE") {
          outcomeBucket = "pass_incomplete";
          gained = 0.0;
        } else {
          this.st("completion");
          const catchYl = this.yardline100 - ay;
          let yac: number;
          if (this.yardline100 <= 20 && catchYl > 0 && catchYl <= 25) {
            // M10 regresses goal-line YAC toward the league mean and misses the
            // reach/dive; use the catch-position PMF.
            yac = sampleRzYac(catchYl, this.rng) + this.yacYdMod();
          } else {
            const yacCat = sampleClass(
              "M10",
              { ...this.ctx(sg), air_yards: ay, depth_category: depth, pass_location: ploc },
              this.rng,
            );
            const yacBucket = `${depth}|${this.yardline100 <= 15 ? "rz" : "field"}`;
            yac = sampleExactYards("m10", yacCat, yacBucket, this.rng) + this.yacYdMod();
          }
          yac = Math.max(yac, -4.0);
          yacAdded = Math.max(yac, 0);
          this.st("yac", yacAdded);
          gained = ay + yac;
          family = "reception";
          outcomeBucket =
            this.rng.random() < 0.18 ? "pass_complete_oob" : "pass_complete_inbounds";
          if (gained >= 20) this.st("explosive_pass");
        }
      }
    } else {
      // DESIGNED_RUN
      this.st("rush_att");
      const loc = sampleClass("M13", this.ctx(sg), this.rng);
      const cat = sampleClass("M14", { ...this.ctx(sg), run_location: loc }, this.rng);
      const fp = this.yardline100 <= 10 ? "gl" : this.yardline100 <= 50 ? "opp" : "own";
      const sd = this.ydstogo <= 2 ? "short" : "norm";
      gained = sampleExactYards("m14", cat, `${loc}|${fp}|${sd}`, this.rng) + this.rushYdMod();
      gained = Math.max(gained, -12.0);
      this.st("rush_yards", gained);
      outcomeBucket = this.rng.random() < 0.1 ? "run_oob" : "run_inbounds";
      if (gained >= 15) this.st("explosive_rush");
    }

    // fumble check (post-yardage)
    if (
      !turnover &&
      (family === "designed_rush" ||
        family === "scramble" ||
        family === "reception" ||
        family === "sack")
    ) {
      const fumQbHit = family === "sack" ? 1 : 0;
      const pf =
        predictProba("M15", {
          yards_gained: gained,
          qb_hit: fumQbHit,
          yardline_100: this.yardline100,
          down: this.down,
          event_family: family,
        }).FUMBLE ?? 0.011;
      if (this.rng.random() < pf) {
        this.st("fumble");
        if (this.rng.random() < FUMBLE_LOST_RATE) {
          this.st("fumble_lost");
          this.st("turnover");
          turnover = true;
          {
            const fc: PlayRec["call"] =
              outcomeBucket === "sack" ? "sack" : call === "DROPBACK" ? "pass" : "run";
            this.tracePlay({
              call: fc,
              depth: playDepth,
              gained,
              outcome: "fumble",
              down: preDown,
              ydstogo: preToGo,
              ballOn: preYl,
              quarter: preQtr,
              clock: preClock,
              firstDown: false,
              touchdown: false,
              turnover: true,
            });
            this.rollInjury(fc, playDepth, gained, "fumble", preQtr, preClock);
          }
          this.advanceClock(outcomeBucket, 0, true);
          if (this.rng.random() < SCOOP_SIX_RATE) {
            const d = this.other();
            this.scorePts(6, d);
            this.st("def_td", 1, d);
            if (this.rng.random() < XP_RATE) this.scorePts(1, d);
            this.kickoff(this.pos, "opp_touchdown");
            return;
          }
          this.turnover(0, clip(this.yardline100 - gained, 1, 99), "fumble");
          return;
        }
      }
    }

    if (call === "DROPBACK" && family === "reception") this.st("pass_yards", gained);
    void yacAdded;

    // §4: live-ball fouls fire after the physical outcome
    if (!turnover) {
      const pfam = call === "DROPBACK" ? "dropback" : "designed_run";
      const pp =
        (predictProba("M25b", this.penCtx(pfam)).LIVEBALL_PEN ?? 0.049) * PENALTY_HAZARD_SCALE * this.penScale();
      if (this.rng.random() < pp && this.liveballPenalty(pfam, gained, s0)) return;
    }

    // resolve state
    const newYl = this.yardline100 - gained;
    const isTd = newYl <= 0;
    const isSafety = newYl >= 100;
    const gainedFirst = this.ydstogo - gained <= 0 && !isTd && !isSafety;
    const failed4th = this.down === 4 && !gainedFirst && !isTd && !isSafety;

    const playCall: PlayRec["call"] =
      outcomeBucket === "sack" ? "sack" : family === "scramble" ? "scramble" : call === "DROPBACK" ? "pass" : "run";
    const playOutcome =
      outcomeBucket === "sack"
        ? "sack"
        : family === "scramble"
          ? "scramble"
          : family === "reception"
            ? "complete"
            : call === "DROPBACK"
              ? "incomplete"
              : "run";
    this.tracePlay({
      call: playCall,
      depth: playDepth,
      gained,
      outcome: playOutcome,
      down: preDown,
      ydstogo: preToGo,
      ballOn: preYl,
      quarter: preQtr,
      clock: preClock,
      firstDown: gainedFirst,
      touchdown: isTd,
      turnover: false,
    });
    this.rollInjury(playCall, playDepth, gained, playOutcome, preQtr, preClock);

    this.advanceClock(outcomeBucket, 0, isTd || isSafety || failed4th);

    this.yardline100 = newYl;
    if (newYl > 0 && newYl < 50.0) this.dCross = true;
    const prePlayYl = newYl + gained;
    const reachedRz = (prePlayYl > 0 && prePlayYl <= 20) || (!isTd && newYl > 0 && newYl <= 20);
    if (!this.rzFlag && reachedRz) {
      this.rzFlag = true;
      this.st("rz_trip");
    }
    if (isTd) {
      if (this.rzFlag) this.st("rz_td");
      this.st("first_down");
      if (this.down === 3) this.st("third_conv");
      this.touchdown();
      return;
    }
    if (isSafety) {
      this.scorePts(2, this.other());
      this.st("safety", 1, this.other());
      this.freeKick();
      return;
    }
    // running-clock state for the NEXT snap: stopped on an incompletion or if
    // the ball-carrier went out of bounds, running otherwise.
    this.clockStopped =
      outcomeBucket === "pass_incomplete" ||
      outcomeBucket === "run_oob" ||
      outcomeBucket === "pass_complete_oob";
    this.ydstogo -= gained;
    if (this.ydstogo <= 0) {
      this.st("first_down");
      if (this.down === 3) this.st("third_conv");
      if (this.down === 4) this.st("fourth_conv");
      this.newSeries(true);
    } else if (this.down === 4) {
      this.st("fourth_att");
      this.turnover(0, this.yardline100);
    } else {
      this.down += 1;
    }
  }

  private freeKick(result = "safety"): void {
    this.finishDrive(result);
    this.pos = this.other();
    this.yardline100 = 60.0;
    this.down = 1;
    this.ydstogo = 10.0;
    this.st("drives");
    this.rzFlag = false;
    this.startDrive();
  }

  // ---- run a full game --------------------------------------
  run(): this {
    this.receivedOpening = this.rng.random() < 0.5 ? 1 : 0;
    this.kickoff(this.receivedOpening);
    let guard = 0;
    while (this.gsr > 0 && guard < 400) {
      guard += 1;
      this.play();
    }
    this.finishDrive("end_of_half"); // clock expired mid-drive (regulation)
    // simple OT: one possession each if tied
    if (this.score[0] === this.score[1]) {
      for (const t of [0, 1] as const) {
        this.pos = t;
        this.yardline100 = 75.0;
        this.down = 1;
        this.ydstogo = 10.0;
        this.gsr = 600;
        this.startDrive();
        let g2 = 0;
        const start: [number, number] = [this.score[0], this.score[1]];
        while (
          this.score[0] === start[0] &&
          this.score[1] === start[1] &&
          g2 < 30 &&
          this.gsr > 0
        ) {
          g2 += 1;
          this.play();
        }
        this.finishDrive("end_of_half");
      }
    }
    return this;
  }
}

export interface GameStaff {
  homeStaff?: Staff | undefined;
  awayStaff?: Staff | undefined;
  /** collect the opt-in per-play trace (`Game.playTrace`). */
  trace?: boolean;
  /** roll in-game injuries (`Game.injuryLog`; pulls hurt starters for the game). */
  injuries?: boolean;
  /**
   * Override the file-backed `roster(home)`/`roster(away)` lookup with a
   * specific roster pair — e.g. a franchise's own current (post-trade/draft/
   * re-signing) players, built via `new Roster(team, players)`. Both must be
   * supplied together; omitting them falls back to the default pool exactly
   * as before.
   */
  homeRoster?: Roster | undefined;
  awayRoster?: Roster | undefined;
  /**
   * No home team. The Super Bowl is the case that exists: both sides travel,
   * so neither gets the crowd. Leaves every home-field shift at exactly zero
   * (`home-field.ts`).
   */
  neutralSite?: boolean | undefined;
}

/**
 * `home`/`away` team codes enable the rating layer. Team index 0 is `home`.
 * Pass `staff` (both sides) to enable the coaching layer on top; omitting it
 * leaves every coaching shift at exactly zero. `trace` / `injuries` turn on the
 * opt-in flavour outputs — both are inert (zero RNG draws) when off, so the
 * validation / parity paths are unchanged. Pass `homeRoster`/`awayRoster` to
 * sim a specific roster pair instead of the file-backed pool.
 *
 * `home` gets the home-field advantage (`home-field.ts`) whenever the rating
 * layer is on; pass `neutralSite` to withhold it, which the Super Bowl does.
 */
export function simulateGame(
  seed: number,
  home?: string,
  away?: string,
  opts?: GameStaff,
): Game {
  const rosters: [Roster, Roster] | null =
    opts?.homeRoster && opts?.awayRoster
      ? [opts.homeRoster, opts.awayRoster]
      : home && away
        ? [roster(home), roster(away)]
        : null;
  // the coaching layer rides on top of the rating layer — no rosters, no staff
  const staffPair: [Staff, Staff] | null =
    rosters && opts?.homeStaff && opts?.awayStaff
      ? [opts.homeStaff, opts.awayStaff]
      : null;
  const g = new Game(new Rng(seed), rosters, staffPair, opts?.neutralSite ?? false);
  if (opts?.trace) g.playTrace = [];
  if (opts?.injuries && rosters) g.injuryLog = [];
  return g.run();
}
