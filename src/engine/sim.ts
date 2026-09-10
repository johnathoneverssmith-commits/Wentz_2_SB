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
import { Rng } from "./rng.js";
import { type Lineup, type Roster, roster } from "./roster.js";
import type { Staff } from "./staff.js";
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
const PENALTY_HAZARD_SCALE = 1.0;

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
  rzFlag = false;
  clockStopped = true; // running-clock state for 2-minute-drill management

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
  ) {
    this.rng = rng;
    this.rosters = rosters;
    this.staff = staff;
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
  private off(): Roster {
    return this.rosters![this.pos as 0 | 1];
  }
  private def(): Roster {
    return this.rosters![this.other() as 0 | 1];
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
    if (!this.staffOn) return { complete: 0, rush: 0, sack: 0 };
    const oc = ocOffenseShift(this.offStaff().oc);
    const dc = dcDefenseShift(this.defStaff().dc);
    return { complete: oc.complete + dc.complete, rush: oc.rush + dc.rush, sack: dc.sack };
  }

  private offShift(kind: "M09" | "M04" | "M20"): Shift | null {
    if (!this.ratingsOn) return null;
    const o = this.off().offense();
    const d = this.def().defense(this.down >= 3 && this.ydstogo >= 6);
    const catchers = [o.WR1, o.WR2, o.WR3, o.TE1];
    const dbs = [d.CB1, d.CB2, d.S1, d.S2];
    if (d.CB3 !== undefined) dbs.push(d.CB3);
    const ol = [o.LT, o.LG, o.C, o.RG, o.RT];
    const rush = [d.EDGE1, d.EDGE2, d.DT1, d.DT2];
    const staff = this.staffOffShift();
    if (kind === "M09") {
      return {
        COMPLETE: completionLogitShift(catchers, dbs, o.QB1 ?? null) + staff.complete,
        INTERCEPTION: interceptionLogitShift(o.QB1 ?? null),
      };
    }
    if (kind === "M04") return { SACK: sackLogitShift(ol, rush) + staff.sack };
    if (kind === "M20") return { MADE: fgLogitShift(this.off().kicker()) };
    return null;
  }

  private rushYdMod(): number {
    if (!this.ratingsOn) return 0;
    const o = this.off().offense();
    const d = this.def().defense();
    const front7 = [d.EDGE1, d.EDGE2, d.DT1, d.DT2, d.ILB1, d.ILB2];
    return rushYardsShift([o.LT, o.LG, o.C, o.RG, o.RT], front7, o.RB1 ?? null) + this.staffOffShift().rush;
  }

  private yacYdMod(): number {
    if (!this.ratingsOn) return 0;
    const o = this.off().offense();
    const d = this.def().defense();
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
    const p =
      (predictProba("M25a", this.penCtx()).DEADBALL_PEN ?? 0.032) * PENALTY_HAZARD_SCALE * this.penScale();
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
    this.gsr = Math.max(0, this.gsr - 4);
    this.hsr = Math.max(0, this.hsr - 4);
    this.qsr = Math.max(0, this.qsr - 4);
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
    this.gsr = Math.max(0, this.gsr - 1);
    this.hsr = Math.max(0, this.hsr - 1);
    this.qsr = Math.max(0, this.qsr - 1);
    this.clockStopped = true;
    this.down = Math.min(this.down + 1, 4);
  }

  private kickFg(result = "field_goal", endOfHalf = false): void {
    this.st("fg_att");
    const ctx: Ctx = { kick_distance: this.yardline100 + 18, yardline_100: this.yardline100, ...ENV };
    const made = (predictProba("M20", ctx, this.offShift("M20")).MADE ?? 0.85) > this.rng.random();
    if (made) {
      this.st("fg_made");
      this.scorePts(3);
    }
    if (endOfHalf) {
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
      const dist = samplePuntDistance(this.yardline100, this.rng);
      const landing = this.yardline100 - dist;
      this.advanceClock("run_inbounds", 0, true);
      if (landing <= 0) {
        this.st("touchback");
        this.flipField(80.0); // receiving team, 1st-and-10 at its own 20
      } else {
        const out = sampleClass("M21", { yardline_100: this.yardline100, ...ENV }, this.rng);
        if (out === "RETURNED" && this.rng.random() < PUNT_RETURN_TD_RATE) {
          const r = this.other();
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
        this.flipField(100 - landing - ret);
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
}

/**
 * `home`/`away` team codes enable the rating layer. Team index 0 is `home`.
 * Pass `staff` (both sides) to enable the coaching layer on top; omitting it
 * leaves every coaching shift at exactly zero.
 */
export function simulateGame(
  seed: number,
  home?: string,
  away?: string,
  staff?: GameStaff,
): Game {
  const rosters: [Roster, Roster] | null =
    home && away ? [roster(home), roster(away)] : null;
  // the coaching layer rides on top of the rating layer — no rosters, no staff
  const staffPair: [Staff, Staff] | null =
    rosters && staff?.homeStaff && staff?.awayStaff
      ? [staff.homeStaff, staff.awayStaff]
      : null;
  return new Game(new Rng(seed), rosters, staffPair).run();
}
