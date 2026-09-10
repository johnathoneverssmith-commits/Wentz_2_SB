"""Game loop — event chronology per spec §4. Rating modifiers = 0 (§22 pass).

Simplifications flagged for later: qb_hit sampled from a marginal, pass_location
marginal (Model 06 not built), kickoff/XP hard-coded empiricals (Model 22/23 not
fitted), sack-yards a fixed empirical, individual player attribution omitted
(team aggregates only), OT = one drive each. Penalties (Model 25) are wired for
scrimmage + punt plays; FG penalties (~0.4%) are still skipped.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from .loaders import (
    predict_proba,
    sample_air_yards,
    sample_class,
    sample_dpi_yards,
    sample_exact_yards,
    sample_penalty_bucket,
    sample_punt_distance,
    sample_punt_return,
    sample_runoff,
)

PASS_LOC = np.array(["left", "middle", "right"])
PASS_LOC_P = np.array([0.31, 0.38, 0.31])
QB_HIT_RATE = 0.135
# empirical qb_hit rate by pass depth (2023–25) — a flat rate over-pressures
# checkdowns (quick release) and slightly under-pressures deep drops.
QB_HIT_BY_DEPTH = {"BEHIND_LOS": 0.065, "SHORT": 0.084, "INTERMEDIATE": 0.113, "DEEP": 0.132}
# M09 regresses completion toward the pass mean: it under-predicts behind-LOS /
# checkdown completions (~7pp) and over-predicts intermediate / deep (~3pp).
# Point-of-use per-depth COMPLETE-logit corrections so completion % matches the
# empirical at every depth. This removes the old deep-ball over-completion that
# was masking ~1–2 pts of an unrelated scoring deficit (docs/decisions.md).
M09_COMPLETE_CALIB = {"BEHIND_LOS": 0.30, "SHORT": 0.03, "INTERMEDIATE": -0.07, "DEEP": -0.10}
FUMBLE_LOST_RATE = 0.48
# M24 same-drive snap gaps run ~1 s/play long in the engine (sec/play 27.4 v
# empirical 26.4 on a like-for-like play count), so drives eat ~8 s more wall
# clock and ~0.5 fewer drives fit per team-game. A small global trim closes it;
# fewer seconds/drive => MORE drives => MORE scoring chances (helps points).
CLOCK_SCALE = 0.958
XP_RATE = 0.958             # empirical PAT-kick make rate, 2023–25
KICKOFF_TOUCHBACK = 0.66
PICK_SIX_RATE = 0.088      # share of INTs returned for a TD (2023–25: 111/1254)
SCOOP_SIX_RATE = 0.064     # share of lost fumbles returned for a TD (2023–25: 55/863)
KICK_RETURN_TD_RATE = 0.007  # per returned kickoff (~0.023/game ÷ ~3.4 returns)
PUNT_RETURN_TD_RATE = 0.020  # per returned punt (~0.044/game ÷ ~2.2 returns)
SACK_YARDS = np.array([-12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0])
SACK_YARDS_P = np.array([2, 4, 6, 9, 12, 16, 16, 12, 9, 5, 2, 1], float)
SACK_YARDS_P = SACK_YARDS_P / SACK_YARDS_P.sum()
# M25a/M25b are fit per raw-stream row; the engine runs fewer scrimmage snaps
# per team-game, so the raw hazard lands ~25% low on penalties/team-game. Left
# at 1.0: the V1.6 sweep (NFLSIM_PEN_SCALE, see v16_points_gap_plan.md) showed
# scale 1.30 hits the empirical count but does NOT improve points — the extra
# offensive fouls cancel the drive-extending defensive ones. It's a fidelity
# metric, not a points lever. NFLSIM_PEN_SCALE is a Python-dev sweep override
# only; unset (the default) it is exactly 1.0, matching src/engine/sim.ts.
import os as _os
PENALTY_HAZARD_SCALE = float(_os.environ.get("NFLSIM_PEN_SCALE", "1.0"))


@dataclass
class Team:
    s: dict = field(default_factory=lambda: defaultdict(float))


@dataclass
class Game:
    rng: np.random.Generator
    score: list[int] = field(default_factory=lambda: [0, 0])
    teams: list[Team] = field(default_factory=lambda: [Team(), Team()])
    qtr: int = 1
    gsr: int = 3600
    hsr: int = 1800
    qsr: int = 900
    pos: int = 0
    to_remaining: list[int] = field(default_factory=lambda: [3, 3])
    yardline_100: float = 75.0
    down: int = 1
    ydstogo: float = 10.0
    received_opening: int = 1  # team that received the opening kickoff
    rosters: list | None = None  # [Roster, Roster] to enable the rating layer, else off
    rz_flag: bool = False  # current drive has reached the red zone (<=20)

    # ---- per-drive instrumentation (V1.6 points-gap work) --------------
    # One record per drive: {team, start_yl, result, plays, crossed_mid, points}.
    # `result` uses the canonical keys in lib_py.drives.PTS_BY_RESULT.
    drives_log: list = field(default_factory=list)
    # optional per-scrimmage-play trace (V1.6 long-field-drive probe). Left None
    # in normal runs; a caller sets it to [] to collect
    # {down, ydstogo, yardline_100, call, drive_start_yl, gained, converted}.
    play_trace: list | None = None
    _drive_open: bool = False
    _dstart_yl: float = 75.0
    _dplays: int = 0
    _dcross: bool = False
    _dteam: int = 0
    _dpts0: int = 0
    _dfd0: float = 0.0

    # ---- helpers -------------------------------------------------------
    def other(self) -> int:
        return 1 - self.pos

    @property
    def ratings_on(self) -> bool:
        return self.rosters is not None

    def _off(self):
        return self.rosters[self.pos]

    def _def(self):
        return self.rosters[self.other()]

    def _off_shift(self, kind: str, **kw) -> dict[str, float] | None:
        """Compute a per-class logit shift for a resolver from the current lineups."""
        if not self.ratings_on:
            return None
        from . import ratings as R
        o, d = self._off().offense(), self._def().defense(nickel=(self.down >= 3 and self.ydstogo >= 6))
        catchers = [o["WR1"], o["WR2"], o["WR3"], o["TE1"]]
        dbs = [d["CB1"], d["CB2"], d["S1"], d["S2"]] + ([d["CB3"]] if "CB3" in d else [])
        ol = [o["LT"], o["LG"], o["C"], o["RG"], o["RT"]]
        rush = [d["EDGE1"], d["EDGE2"], d["DT1"], d["DT2"]]
        front7 = rush + [d["ILB1"], d["ILB2"]]
        if kind == "M09":
            return {"COMPLETE": R.completion_logit_shift(catchers, dbs, o["QB1"]),
                    "INTERCEPTION": R.interception_logit_shift(o["QB1"])}
        if kind == "M04":
            return {"SACK": R.sack_logit_shift(ol, rush)}
        if kind == "M20":
            return {"MADE": R.fg_logit_shift(self._off().kicker())}
        return None

    def _rush_yd_mod(self) -> float:
        if not self.ratings_on:
            return 0.0
        from . import ratings as R
        o, d = self._off().offense(), self._def().defense()
        front7 = [d["EDGE1"], d["EDGE2"], d["DT1"], d["DT2"], d["ILB1"], d["ILB2"]]
        return R.rush_yards_shift([o["LT"], o["LG"], o["C"], o["RG"], o["RT"]], front7, o["RB1"])

    def _yac_yd_mod(self) -> float:
        if not self.ratings_on:
            return 0.0
        from . import ratings as R
        o, d = self._off().offense(), self._def().defense()
        tacklers = [d["CB1"], d["CB2"], d["S1"], d["S2"], d["ILB1"], d["ILB2"]]
        return R.yac_yards_shift(o["WR1"], tacklers)

    def st(self, k: str, v: float = 1.0, team: int | None = None):
        self.teams[self.pos if team is None else team].s[k] += v

    # ---- per-drive instrumentation ---------------------------------
    def _start_drive(self):
        """Open a new drive record. Called at the end of every possession-change
        method, once `pos` and `yardline_100` are set."""
        self._drive_open = True
        self._dstart_yl = float(self.yardline_100)
        self._dplays = 0
        self._dcross = self.yardline_100 < 50.0
        self._dteam = self.pos
        self._dpts0 = self.score[self.pos]
        self._dfd0 = self.teams[self.pos].s["first_down"]

    def _finish_drive(self, result: str):
        """Close the current drive with `result` (a lib_py.drives canonical key).
        No-op before the first drive or after it is already closed."""
        if not self._drive_open:
            return
        self._drive_open = False
        self.drives_log.append({
            "team": self._dteam,
            "start_yl": self._dstart_yl,
            "result": result,
            "plays": self._dplays,
            "crossed_mid": self._dcross,
            "points": self.score[self._dteam] - self._dpts0,
            "first_downs": self.teams[self._dteam].s["first_down"] - self._dfd0,
        })

    def ctx(self, shotgun: int = 0) -> dict:
        return {
            "down": self.down, "ydstogo": self.ydstogo, "yardline_100": self.yardline_100,
            "goal_to_go": int(self.yardline_100 <= self.ydstogo), "qtr": self.qtr,
            "game_seconds_remaining": self.gsr, "half_seconds_remaining": self.hsr,
            "score_differential": self.score[self.pos] - self.score[self.other()],
            "posteam_timeouts_remaining": self.to_remaining[self.pos],
            "defteam_timeouts_remaining": self.to_remaining[self.other()],
            "shotgun": shotgun, "is_home_offense": 1 - self.pos,
            "roof": "outdoors", "env_temp": 60.0, "env_wind": 5.0, "temp_missing": 0,
        }

    # ---- clock -------------------------------------------------------
    def advance_clock(self, bucket: str, no_huddle: int = 0, drive_ends: bool = False):
        # M24 elapsed spans snap -> next SAME-DRIVE snap (~35s incl. huddle). On the
        # play that ENDS a drive there is no offensive huddle after it — the clock
        # either stops (score, INT, incompletion, out of bounds) or only the kick
        # team's hustle time runs. Blend to ~14s rather than the full ~35s.
        cs = "final_5min" if self.gsr <= 300 else "final_10min" if self.gsr <= 600 else "normal"
        e = sample_runoff(bucket, no_huddle, cs, self.rng) * CLOCK_SCALE
        if drive_ends:
            # ~65% of the same-drive gap: clock stops on some drive-enders (score,
            # INT, incompletion, OOB); on others the kick team hustles on.
            e = e * 0.65
        e = int(round(e))
        e = min(e, self.qsr) if self.qsr > 0 else e
        self.gsr = max(0, self.gsr - e)
        self.hsr = max(0, self.hsr - e)
        self.qsr = max(0, self.qsr - e)
        self.teams[self.pos].s["top"] += e
        if self.qsr == 0 and self.gsr > 0:
            self.qtr += 1
            self.qsr = 900
            if self.qtr == 3:  # second-half kickoff to the other opener
                self.hsr = 1800
                self.to_remaining = [3, 3]
                self._kickoff(receiving=1 - self.received_opening, result="end_of_half")

    # ---- scoring / possession ------------------------------------
    def _score(self, pts: int, team: int | None = None):
        self.score[self.pos if team is None else team] += pts
        self.st("points", pts, team)

    def _touchdown(self):
        self._score(6)
        self.st("td")
        if self.rng.random() < XP_RATE:
            self._score(1)
        self._kickoff(receiving=self.other())

    def _turnover(self, return_yards: float = 0.0, spot: float | None = None,
                  result: str = "downs"):
        self._finish_drive(result)
        yl = self.yardline_100 if spot is None else spot
        self.pos = self.other()
        self.yardline_100 = float(np.clip(100 - yl - return_yards, 1, 99))
        self.down, self.ydstogo = 1, min(10.0, self.yardline_100)
        self.teams[self.pos].s["drives"] += 1
        self.rz_flag = False
        self._start_drive()

    def _kickoff(self, receiving: int, result: str = "touchdown"):
        self._finish_drive(result)  # close the drive that led to this kickoff
        self.pos = receiving
        if self.rng.random() < KICKOFF_TOUCHBACK:
            self.yardline_100 = 70.0
        else:
            if self.rng.random() < KICK_RETURN_TD_RATE:
                self._score(6, team=receiving)
                self.teams[receiving].s["st_td"] += 1
                if self.rng.random() < XP_RATE:
                    self._score(1, team=receiving)
                self._kickoff(receiving=1 - receiving)  # kick back to the other team
                return
            spot = 25 + self.rng.normal(3, 6)
            self.yardline_100 = float(np.clip(100 - spot, 55, 99))
        self.down, self.ydstogo = 1, 10.0
        self.teams[receiving].s["drives"] += 1
        self.rz_flag = False
        self._start_drive()

    def _new_series(self, first_down: bool):
        if first_down:
            self.down = 1
            self.ydstogo = min(10.0, self.yardline_100)

    # ---- penalties (Model 25) -----------------------------------
    def _pen_ctx(self, play_family: str | None = None) -> dict:
        c = {**self.ctx(0), "posteam_type": "home" if self.pos == 0 else "away"}
        if play_family is not None:
            c["play_family"] = play_family
        return c

    def _presnap_penalty(self) -> bool:
        """M25a: a dead-ball foul before the snap. Enforced (not declinable),
        the down is replayed. Returns True if one occurred."""
        p = predict_proba("M25a", self._pen_ctx()).get("DEADBALL_PEN", 0.032) * PENALTY_HAZARD_SCALE
        if self.rng.random() >= p:
            return False
        b = sample_penalty_bucket("deadball", "ALL", self.rng)
        on_off = self.rng.random() < b["off_share"]
        team = self.pos if on_off else self.other()
        self.st("penalty", team=team)
        self.st("penalty_yards", 5.0, team=team)
        if on_off:
            self.yardline_100 = min(self.yardline_100 + 5.0, 99.0)
            self.ydstogo += 5.0
        else:
            self.yardline_100 = max(self.yardline_100 - 5.0, 1.0)
            if 5.0 >= self.ydstogo:
                self.st("first_down")
                self._new_series(first_down=True)
            else:
                self.ydstogo -= 5.0
        # dead-ball: mostly play-clock cost; a little game clock on delay of game.
        for a in ("gsr", "hsr", "qsr"):
            setattr(self, a, max(0, getattr(self, a) - 4))
        return True

    def _liveball_penalty(self, play_family: str, gained: float, s0: dict) -> bool:
        """M25b/25c: a live-ball foul after the physical outcome. Deterministic
        accept/decline (the non-penalised side takes the better outcome). On
        accept the play is nullified (stats restored from `s0`). Returns True if
        the play was replaced by the penalty."""
        b = sample_penalty_bucket("liveball", play_family, self.rng)
        on_off = self.rng.random() < b["off_share"]
        if b["is_spot_foul"]:  # DPI — spot foul, capped at the 1
            band = ("opp_rz" if self.yardline_100 <= 20 else
                    "opp_mid" if self.yardline_100 <= 50 else "own_half")
            yd = min(float(sample_dpi_yards(band, self.rng)), self.yardline_100 - 1.0)
        else:
            yd = float(round(b["mean_yards"] / 5.0) * 5) or 5.0
        auto_first = self.rng.random() < b["p_auto_first"]
        gained_first = (self.ydstogo - gained) <= 0

        if on_off:  # defense decides — decline only if the play already hurt the
            if gained <= -yd and not gained_first:   # offense more than the flag
                return False
        elif auto_first:  # offense: an automatic first down beats almost any play
            if gained_first and gained >= yd:
                return False
        else:       # offense: decline if the play already gained at least as much
            if gained_first or gained >= yd:
                return False

        # accept: nullify the play
        for i in (0, 1):
            self.teams[i].s.clear()
            self.teams[i].s.update(s0[i])
        team = self.pos if on_off else self.other()
        self.st("penalty", team=team)
        self.st("penalty_yards", yd, team=team)
        if b["bucket"] == "defensive_pass_interference":
            self.st("dpi", team=self.other())

        if on_off:
            self.yardline_100 = min(self.yardline_100 + yd, 99.0)
            self.ydstogo += yd
            if b["bucket"] == "intentional_grounding":
                self.down = min(self.down + 1, 4)     # loss of down
        else:
            self.yardline_100 = max(self.yardline_100 - yd, 1.0)
            if auto_first or yd >= self.ydstogo:
                self.st("auto_first_pen")
                self.st("first_down")  # nflverse counts a penalty first down
                self._new_series(first_down=True)
            else:
                self.ydstogo -= yd
        self.advance_clock("pass_incomplete")
        return True

    # ---- one play -------------------------------------------------
    def _can_kneel_out(self) -> bool:
        """Leading team near a half boundary that can burn the rest of the clock
        with kneel-downs. Empirically ~7% of drives end this way ('End of half')."""
        if self.score[self.pos] - self.score[self.other()] <= 0:
            return False
        if not (self.qsr <= 150 and self.qtr in (2, 4)):
            return False
        # ~2 s/snap + ~40 s play-clock per kneel, minus what defensive timeouts save
        burnable = 2 + 42 * (4 - self.down) - 40 * self.to_remaining[self.other()]
        return self.hsr <= burnable

    def _kneel_out(self):
        self.st("kneel_out")
        self._dplays += 1
        e = min(self.hsr, self.qsr) if self.qsr > 0 else self.hsr
        self.gsr = max(0, self.gsr - e)
        self.hsr = max(0, self.hsr - e)
        self.qsr = max(0, self.qsr - e)
        self.teams[self.pos].s["top"] += e
        if self.qsr == 0 and self.gsr > 0:          # end of Q2 → Q3 kickoff
            self.qtr += 1
            self.qsr = 900
            if self.qtr == 3:
                self.hsr = 1800
                self.to_remaining = [3, 3]
                self._kickoff(receiving=1 - self.received_opening, result="end_of_half")

    def play(self):
        self.teams[self.pos].s["plays"] += 1
        if self._can_kneel_out():
            return self._kneel_out()
        self._dplays += 1
        if self.down == 3:
            self.st("third_att")
        if self.down == 4:
            return self._fourth_down()
        return self._scrimmage(go_for_it=False)

    def _fourth_down(self):
        act = sample_class("M01", self.ctx(), self.rng)
        if act == "FIELD_GOAL":
            self.st("fg_att")
            dist = self.yardline_100 + 18
            ctx = {"kick_distance": dist, "yardline_100": self.yardline_100,
                   "roof": "outdoors", "env_temp": 60.0, "env_wind": 5.0, "temp_missing": 0}
            made = predict_proba("M20", ctx, self._off_shift("M20")).get("MADE", 0.85) > self.rng.random()
            self.advance_clock("run_inbounds", drive_ends=True)
            if made:
                self.st("fg_made")
                self._score(3)
                self._kickoff(receiving=self.other(), result="field_goal")
            else:
                self._turnover(spot=self.yardline_100, result="missed_fg")
            return
        if act == "PUNT":
            self.st("punt")
            d = sample_punt_distance(self.yardline_100, self.rng)
            landing = self.yardline_100 - d
            self.advance_clock("run_inbounds", drive_ends=True)
            if landing <= 0:
                self.st("touchback")
                self._flip_field(80.0)  # receiving team, 1st-and-10 at its own 20
            else:
                out = sample_class("M21", {"yardline_100": self.yardline_100, "roof": "outdoors",
                                           "env_temp": 60.0, "env_wind": 5.0, "temp_missing": 0}, self.rng)
                if out == "RETURNED" and self.rng.random() < PUNT_RETURN_TD_RATE:
                    r = self.other()
                    self._score(6, team=r)
                    self.teams[r].s["st_td"] += 1
                    if self.rng.random() < XP_RATE:
                        self._score(1, team=r)
                    self._kickoff(receiving=self.pos, result="punt")  # returning team kicks back
                    return
                ret = sample_punt_return(self.rng) if out == "RETURNED" else 0
                # receiving team's yardline_100 = 100 − landing spot, then a return
                # advances them toward the punting team's goal (−ret).
                self._flip_field(100 - landing - ret)
            self._punt_penalty()
            return
        # GO_FOR_IT
        self._scrimmage(go_for_it=True)

    def _punt_penalty(self) -> None:
        """M25b on a punt (mostly return-team holding, or running-into/roughing
        the kicker). Marked off from the new spot; not declined in V1.5."""
        if self.rng.random() >= predict_proba("M25b", self._pen_ctx("punt")).get("LIVEBALL_PEN", 0.084) * PENALTY_HAZARD_SCALE:
            return
        b = sample_penalty_bucket("liveball", "punt", self.rng)
        yd = float(round(b["mean_yards"] / 5.0) * 5) or 10.0
        on_off = self.rng.random() < b["off_share"]   # off == the new (receiving) offense
        team = self.pos if on_off else self.other()
        self.st("penalty", team=team)
        self.st("penalty_yards", yd, team=team)
        if on_off:
            self.yardline_100 = min(self.yardline_100 + yd, 99.0)
        else:
            self.yardline_100 = max(self.yardline_100 - yd, 1.0)
        self.ydstogo = min(10.0, self.yardline_100)

    def _flip_field(self, new_yl_for_new_offense: float, result: str = "punt"):
        self._finish_drive(result)
        self.pos = self.other()
        self.yardline_100 = float(np.clip(new_yl_for_new_offense, 1, 99))
        self.down, self.ydstogo = 1, min(10.0, self.yardline_100)
        self.teams[self.pos].s["drives"] += 1
        self.rz_flag = False
        self._start_drive()

    # ---- scrimmage play ----------------------------------------
    def _scrimmage(self, go_for_it: bool):
        # §4: pre-snap dead-ball fouls fire before the play call. Cap at 2 so a
        # false-start loop can't stall the drive; a defensive one can hand over
        # a first down (then this snap just runs on the new down).
        for _ in range(2):
            if not self._presnap_penalty():
                break
            self._dplays += 1  # a dead-ball foul is its own nflverse no_play row

        # snapshot AFTER pre-snap fouls: an accepted live-ball foul nullifies the
        # play back to here, not back past the dead-ball enforcement.
        s0 = {i: dict(self.teams[i].s) for i in (0, 1)}
        call = sample_class("M02", self.ctx(0), self.rng)
        sg = int(sample_class("M03", {**self.ctx(0), "play_call": call}, self.rng) == "SHOTGUN")
        start_yl = self.yardline_100
        gained = 0.0
        turnover = False
        _trec = None
        if self.play_trace is not None:
            _trec = {"down": self.down, "ydstogo": float(self.ydstogo),
                     "yardline_100": float(self.yardline_100), "call": call,
                     "drive_start_yl": float(self._dstart_yl), "gained": None,
                     "converted": None, "turnover": False, "td": False,
                     "outcome": "run" if call != "DROPBACK" else "?", "depth": ""}
            self.play_trace.append(_trec)
        family = "designed_rush"
        outcome_bucket = "run_inbounds"

        if call == "DROPBACK":
            term = sample_class("M04", self.ctx(sg), self.rng, self._off_shift("M04"))
            self.teams[self.pos].s["dropbacks"] += 1
            if term == "SACK":
                self.st("sack")
                loss = float(self.rng.choice(SACK_YARDS, p=SACK_YARDS_P))
                gained = loss
                family, outcome_bucket = "sack", "sack"
                if _trec is not None:
                    _trec["outcome"] = "sack"
            elif term == "SCRAMBLE":
                self.st("scramble")
                if _trec is not None:
                    _trec["outcome"] = "scramble"
                cat = sample_class("M11", self.ctx(sg), self.rng)
                bucket = f"{self.down}|" + ("rz" if self.yardline_100 <= 20 else
                                            "mid" if self.yardline_100 <= 60 else "own")
                gained = float(sample_exact_yards("m11", cat, bucket, self.rng))
                family, outcome_bucket = "scramble", "scramble"
            else:  # THROW
                self.st("pass_att")
                depth = sample_class("M05", self.ctx(sg), self.rng)
                ay = sample_air_yards(depth, self.down, self.yardline_100, self.rng)
                # you can't throw more than a few yards past the end zone. The RZ
                # air-yards buckets (loaders.sample_air_yards gl1..gl4) now track
                # the goal line, so this cap only bites on the rare deep shot.
                ay = int(min(ay, self.yardline_100 + 3))
                depth = ("BEHIND_LOS" if ay < 0 else "SHORT" if ay <= 9
                         else "INTERMEDIATE" if ay <= 19 else "DEEP")
                ploc = str(self.rng.choice(PASS_LOC, p=PASS_LOC_P))
                qb_hit = int(self.rng.random() < QB_HIT_BY_DEPTH.get(depth, QB_HIT_RATE))
                m09_shift = self._off_shift("M09") or {}
                m09_shift = {**m09_shift,
                             "COMPLETE": m09_shift.get("COMPLETE", 0.0) + M09_COMPLETE_CALIB.get(depth, 0.0)}
                res = sample_class("M09", {**self.ctx(sg), "air_yards": ay, "depth_category": depth,
                                           "pass_location": ploc, "qb_hit": qb_hit}, self.rng, m09_shift)
                self.teams[self.pos].s["air_yards"] += ay
                if _trec is not None:
                    _trec["depth"] = depth
                    _trec["ay"] = int(ay)
                    _trec["outcome"] = {"INTERCEPTION": "int", "OTHER_INCOMPLETE": "pass_inc",
                                        "COMPLETE": "pass_comp"}.get(res, res)
                if res == "INTERCEPTION":
                    if _trec is not None:
                        _trec["turnover"] = True
                    self.st("int_thrown")
                    self.st("turnover")
                    if self.rng.random() < PICK_SIX_RATE:
                        self.advance_clock("pass_incomplete")
                        d = self.other()
                        self._score(6, team=d)
                        self.teams[d].s["def_td"] += 1
                        if self.rng.random() < XP_RATE:
                            self._score(1, team=d)
                        self._kickoff(receiving=self.pos, result="opp_touchdown")
                        return
                    self._turnover(return_yards=self.rng.normal(6, 8),
                                   spot=float(np.clip(self.yardline_100 - ay, 1, 99)),
                                   result="interception")
                    self.advance_clock("pass_incomplete")
                    return
                if res == "OTHER_INCOMPLETE":
                    outcome_bucket = "pass_incomplete"
                    gained = 0.0
                else:  # COMPLETE
                    self.st("completion")
                    yac_cat = sample_class("M10", {**self.ctx(sg), "air_yards": ay,
                                                   "depth_category": depth, "pass_location": ploc}, self.rng)
                    yac_bucket = depth + "|" + ("rz" if self.yardline_100 <= 15 else "field")
                    yac = float(sample_exact_yards("m10", yac_cat, yac_bucket, self.rng)) + self._yac_yd_mod()
                    yac = max(yac, -4.0)
                    gained = ay + yac
                    self.teams[self.pos].s["yac"] += max(yac, 0)
                    family = "reception"
                    ob = "pass_complete_oob" if self.rng.random() < 0.18 else "pass_complete_inbounds"
                    outcome_bucket = ob
                    if gained >= 20:
                        self.st("explosive_pass")
        else:  # DESIGNED_RUN
            self.st("rush_att")
            loc = sample_class("M13", self.ctx(sg), self.rng)
            cat = sample_class("M14", {**self.ctx(sg), "run_location": loc}, self.rng)
            fp = "gl" if self.yardline_100 <= 10 else "opp" if self.yardline_100 <= 50 else "own"
            sd = "short" if self.ydstogo <= 2 else "norm"
            gained = float(sample_exact_yards("m14", cat, f"{loc}|{fp}|{sd}", self.rng)) + self._rush_yd_mod()
            gained = max(gained, -12.0)
            self.teams[self.pos].s["rush_yards"] += gained
            outcome_bucket = "run_oob" if self.rng.random() < 0.10 else "run_inbounds"
            if gained >= 15:
                self.st("explosive_rush")

        # fumble check (post-yardage). A sack IS a QB hit — 94% of historical sack
        # rows have qb_hit == 1, and the M15 model's qb_hit=0 main effect blows up
        # P(fumble) to ~0.5 for sacks if we pass 0 here.
        if not turnover and family in ("designed_rush", "scramble", "reception", "sack"):
            fum_qb_hit = 1 if family == "sack" else 0
            pf = predict_proba("M15", {"yards_gained": gained, "qb_hit": fum_qb_hit,
                                       "yardline_100": self.yardline_100, "down": self.down,
                                       "event_family": family}).get("FUMBLE", 0.011)
            if self.rng.random() < pf:
                self.st("fumble")
                if _trec is not None:
                    _trec["gained"] = float(gained)
                    _trec["converted"] = False
                if self.rng.random() < FUMBLE_LOST_RATE:
                    if _trec is not None:
                        _trec["turnover"] = True
                    self.st("fumble_lost")
                    self.st("turnover")
                    turnover = True
                    self.advance_clock(outcome_bucket, drive_ends=True)
                    if self.rng.random() < SCOOP_SIX_RATE:
                        d = self.other()
                        self._score(6, team=d)
                        self.teams[d].s["def_td"] += 1
                        if self.rng.random() < XP_RATE:
                            self._score(1, team=d)
                        self._kickoff(receiving=self.pos, result="opp_touchdown")
                        return
                    self._turnover(spot=float(np.clip(self.yardline_100 - gained, 1, 99)),
                                   result="fumble")
                    return

        # yardage bookkeeping
        if call == "DROPBACK" and family == "reception":
            self.teams[self.pos].s["pass_yards"] += gained

        # §4: live-ball fouls fire after the physical outcome. Not on a turnover
        # (those branches have already returned). M25b hazard, then M25c
        # bucket/enforcement + deterministic accept/decline.
        if not turnover:
            pfam = "dropback" if call == "DROPBACK" else "designed_run"
            pp = predict_proba("M25b", self._pen_ctx(pfam)).get("LIVEBALL_PEN", 0.049) * PENALTY_HAZARD_SCALE
            if self.rng.random() < pp and self._liveball_penalty(pfam, gained, s0):
                # this snap already counted in _dplays (the nflverse no_play row);
                # the replay is a fresh play() call that counts itself.
                return

        # resolve state first, so the clock knows whether the drive continues
        new_yl = self.yardline_100 - gained
        is_td = new_yl <= 0
        is_safety = new_yl >= 100
        gained_first = (self.ydstogo - gained) <= 0 and not is_td and not is_safety
        failed_4th = (self.down == 4 and not gained_first and not is_td and not is_safety)
        drive_ends = is_td or is_safety or failed_4th
        if _trec is not None:
            _trec["gained"] = float(gained)
            _trec["converted"] = bool(is_td or gained_first)
            _trec["td"] = bool(is_td)
        self.advance_clock(outcome_bucket, drive_ends=drive_ends)

        self.yardline_100 = new_yl
        if 0 < new_yl < 50.0:
            self._dcross = True
        # red-zone trip bookkeeping (§22 finishing metric): a drive is an RZ trip
        # once the ball sits inside the 20 (or is snapped there on a short field);
        # a TD from a flagged drive is an RZ TD.
        pre_play_yl = new_yl + gained
        reached_rz = (0 < pre_play_yl <= 20) or (not is_td and 0 < new_yl <= 20)
        if not self.rz_flag and reached_rz:
            self.rz_flag = True
            self.st("rz_trip")
        if is_td:
            if self.rz_flag:
                self.st("rz_td")
            self.st("first_down")  # NFL counts the scoring play as a first down
            if self.down == 3:
                self.st("third_conv")
            self._touchdown()
            return
        if is_safety:
            self._score(2, team=self.other())
            self.teams[self.other()].s["safety"] += 1
            self._free_kick()
            return
        self.ydstogo -= gained
        converted = self.ydstogo <= 0
        if converted:
            self.st("first_down")
            if self.down == 3:
                self.st("third_conv")
            if self.down == 4:
                self.st("fourth_conv")
            self._new_series(first_down=True)
        elif self.down == 4:  # failed go-for-it
            self.st("fourth_att")
            self._turnover(spot=self.yardline_100)
        else:
            self.down += 1

    def _free_kick(self, result: str = "safety"):
        # `self.pos` currently = team that conceded the safety; they free-kick, other receives
        self._finish_drive(result)
        self.pos = self.other()
        self.yardline_100 = 60.0
        self.down, self.ydstogo = 1, 10.0
        self.teams[self.pos].s["drives"] += 1
        self.rz_flag = False
        self._start_drive()

    # ---- run a full game -----------------------------------------
    def run(self):
        self.received_opening = int(self.rng.random() < 0.5)
        self._kickoff(receiving=self.received_opening)
        guard = 0
        while self.gsr > 0 and guard < 400:
            guard += 1
            self.play()
        self._finish_drive("end_of_half")  # clock expired mid-drive (regulation)
        # simple OT: one possession each if tied
        if self.score[0] == self.score[1]:
            for t in (0, 1):
                self.pos = t
                self.yardline_100, self.down, self.ydstogo = 75.0, 1, 10.0
                self.gsr = 600
                self._start_drive()
                g2 = 0
                start = tuple(self.score)
                while self.score == list(start) and g2 < 30 and self.gsr > 0:
                    g2 += 1
                    self.play()
                self._finish_drive("end_of_half")
        return self


def simulate_game(seed: int, home: str | None = None, away: str | None = None) -> Game:
    """`home`/`away` team codes enable the rating layer (spec §12–§14).
    Team index 0 is `home`, 1 is `away`."""
    rosters = None
    if home and away:
        from .roster import roster
        rosters = [roster(home), roster(away)]
    return Game(rng=np.random.default_rng(seed), rosters=rosters).run()
