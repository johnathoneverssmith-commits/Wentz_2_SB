"""Game loop — event chronology per spec §4. Rating modifiers = 0 (§22 pass).

Simplifications flagged for later: no penalties (V1.5), qb_hit sampled from a
marginal, pass_location marginal (Model 06 not built), kickoff/XP hard-coded
empiricals (Model 22/23 not fitted), sack-yards a fixed empirical, individual
player attribution omitted (team aggregates only), OT = one drive each.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from .loaders import (
    predict_proba,
    sample_air_yards,
    sample_class,
    sample_exact_yards,
    sample_punt_distance,
    sample_punt_return,
    sample_runoff,
)

PASS_LOC = np.array(["left", "middle", "right"])
PASS_LOC_P = np.array([0.31, 0.38, 0.31])
QB_HIT_RATE = 0.135
FUMBLE_LOST_RATE = 0.48
XP_RATE = 0.940
KICKOFF_TOUCHBACK = 0.66
SACK_YARDS = np.array([-12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0])
SACK_YARDS_P = np.array([2, 4, 6, 9, 12, 16, 16, 12, 9, 5, 2, 1], float)
SACK_YARDS_P = SACK_YARDS_P / SACK_YARDS_P.sum()


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

    # ---- helpers -------------------------------------------------------
    def other(self) -> int:
        return 1 - self.pos

    def st(self, k: str, v: float = 1.0, team: int | None = None):
        self.teams[self.pos if team is None else team].s[k] += v

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
    def advance_clock(self, bucket: str, no_huddle: int = 0):
        cs = "final_5min" if self.gsr <= 300 else "final_10min" if self.gsr <= 600 else "normal"
        e = sample_runoff(bucket, no_huddle, cs, self.rng)
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
                self._kickoff(receiving=1 - self.received_opening)

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

    def _turnover(self, return_yards: float = 0.0, spot: float | None = None):
        yl = self.yardline_100 if spot is None else spot
        self.pos = self.other()
        self.yardline_100 = float(np.clip(100 - yl - return_yards, 1, 99))
        self.down, self.ydstogo = 1, min(10.0, self.yardline_100)
        self.teams[self.pos].s["drives"] += 1

    def _kickoff(self, receiving: int):
        self.pos = receiving
        if self.rng.random() < KICKOFF_TOUCHBACK:
            self.yardline_100 = 70.0
        else:
            spot = 25 + self.rng.normal(3, 6)
            self.yardline_100 = float(np.clip(100 - spot, 55, 99))
        self.down, self.ydstogo = 1, 10.0
        self.teams[receiving].s["drives"] += 1

    def _new_series(self, first_down: bool):
        if first_down:
            self.down = 1
            self.ydstogo = min(10.0, self.yardline_100)

    # ---- one play -------------------------------------------------
    def play(self):
        self.teams[self.pos].s["plays"] += 1
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
            made = predict_proba("M20", ctx).get("MADE", 0.85) > self.rng.random()
            self.advance_clock("run_inbounds")
            if made:
                self.st("fg_made")
                self._score(3)
                self._kickoff(receiving=self.other())
            else:
                self._turnover(spot=self.yardline_100)
            return
        if act == "PUNT":
            self.st("punt")
            d = sample_punt_distance(self.yardline_100, self.rng)
            landing = self.yardline_100 - d
            self.advance_clock("run_inbounds")
            if landing <= 0:
                self.st("touchback")
                self._flip_field(1 - 20)  # opp ball at own 20
            else:
                out = sample_class("M21", {"yardline_100": self.yardline_100, "roof": "outdoors",
                                           "env_temp": 60.0, "env_wind": 5.0, "temp_missing": 0}, self.rng)
                ret = sample_punt_return(self.rng) if out == "RETURNED" else 0
                self._flip_field(100 - landing + ret)
            return
        # GO_FOR_IT
        self._scrimmage(go_for_it=True)

    def _flip_field(self, new_yl_for_new_offense: float):
        self.pos = self.other()
        self.yardline_100 = float(np.clip(new_yl_for_new_offense, 1, 99))
        self.down, self.ydstogo = 1, min(10.0, self.yardline_100)
        self.teams[self.pos].s["drives"] += 1

    # ---- scrimmage play ----------------------------------------
    def _scrimmage(self, go_for_it: bool):
        call = sample_class("M02", self.ctx(0), self.rng)
        sg = int(sample_class("M03", {**self.ctx(0), "play_call": call}, self.rng) == "SHOTGUN")
        start_yl = self.yardline_100
        gained = 0.0
        turnover = False
        family = "designed_rush"
        outcome_bucket = "run_inbounds"

        if call == "DROPBACK":
            term = sample_class("M04", self.ctx(sg), self.rng)
            self.teams[self.pos].s["dropbacks"] += 1
            if term == "SACK":
                self.st("sack")
                loss = float(self.rng.choice(SACK_YARDS, p=SACK_YARDS_P))
                gained = loss
                family, outcome_bucket = "sack", "sack"
            elif term == "SCRAMBLE":
                self.st("scramble")
                cat = sample_class("M11", self.ctx(sg), self.rng)
                bucket = f"{self.down}|" + ("rz" if self.yardline_100 <= 20 else
                                            "mid" if self.yardline_100 <= 60 else "own")
                gained = float(sample_exact_yards("m11", cat, bucket, self.rng))
                family, outcome_bucket = "scramble", "scramble"
            else:  # THROW
                self.st("pass_att")
                depth = sample_class("M05", self.ctx(sg), self.rng)
                ay = sample_air_yards(depth, self.down, self.yardline_100, self.rng)
                ploc = str(self.rng.choice(PASS_LOC, p=PASS_LOC_P))
                qb_hit = int(self.rng.random() < QB_HIT_RATE)
                res = sample_class("M09", {**self.ctx(sg), "air_yards": ay, "depth_category": depth,
                                           "pass_location": ploc, "qb_hit": qb_hit}, self.rng)
                self.teams[self.pos].s["air_yards"] += ay
                if res == "INTERCEPTION":
                    self.st("int_thrown")
                    turnover, family, outcome_bucket = True, "reception", "pass_incomplete"
                    gained = 0.0
                    self._turnover(return_yards=self.rng.normal(6, 8),
                                   spot=float(np.clip(self.yardline_100 - ay, 1, 99)))
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
                    yac = float(sample_exact_yards("m10", yac_cat, yac_bucket, self.rng))
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
            gained = float(sample_exact_yards("m14", cat, f"{loc}|{fp}|{sd}", self.rng))
            self.teams[self.pos].s["rush_yards"] += gained
            outcome_bucket = "run_oob" if self.rng.random() < 0.10 else "run_inbounds"
            if gained >= 15:
                self.st("explosive_rush")

        # fumble check (post-yardage)
        if not turnover and family in ("designed_rush", "scramble", "reception", "sack"):
            pf = predict_proba("M15", {"yards_gained": gained, "qb_hit": 0, "yardline_100": self.yardline_100,
                                       "down": self.down, "event_family": family}).get("FUMBLE", 0.011)
            if self.rng.random() < pf:
                self.st("fumble")
                if self.rng.random() < FUMBLE_LOST_RATE:
                    self.st("fumble_lost")
                    self.st("turnover")
                    turnover = True
                    self._turnover(spot=float(np.clip(self.yardline_100 - gained, 1, 99)))
                    self.advance_clock(outcome_bucket)
                    return

        # yardage bookkeeping
        if call == "DROPBACK" and family == "reception":
            self.teams[self.pos].s["pass_yards"] += gained

        self.advance_clock(outcome_bucket)  # clock runs before score/possession resolution

        # state update
        self.yardline_100 -= gained
        if self.yardline_100 <= 0:
            self._touchdown()
            return
        if self.yardline_100 >= 100:  # safety
            self._score(2, team=self.other())
            self.teams[self.other()].s["safety"] += 1
            self._free_kick()
            return
        self.ydstogo -= gained
        if self.ydstogo <= 0:
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

    def _free_kick(self):
        # `self.pos` currently = team that conceded the safety; they free-kick, other receives
        self.pos = self.other()
        self.yardline_100 = 60.0
        self.down, self.ydstogo = 1, 10.0
        self.teams[self.pos].s["drives"] += 1

    # ---- run a full game -----------------------------------------
    def run(self):
        self.received_opening = int(self.rng.random() < 0.5)
        self._kickoff(receiving=self.received_opening)
        guard = 0
        while self.gsr > 0 and guard < 400:
            guard += 1
            self.play()
        # simple OT: one possession each if tied
        if self.score[0] == self.score[1]:
            for t in (0, 1):
                self.pos = t
                self.yardline_100, self.down, self.ydstogo = 75.0, 1, 10.0
                self.gsr = 600
                g2 = 0
                start = tuple(self.score)
                while self.score == list(start) and g2 < 30 and self.gsr > 0:
                    g2 += 1
                    self.play()
        return self


def simulate_game(seed: int) -> Game:
    return Game(rng=np.random.default_rng(seed)).run()
