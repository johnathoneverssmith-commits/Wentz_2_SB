"""Team rosters, depth charts, per-play lineups (spec §14, §15).

Depth-chart *order* uses `overall` (allowed — it only ranks players into
roles, §3/§15). Play *outcomes* use the individual skill attributes via the
rating layer (engine/ratings.py), never `overall`.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

_POOL = Path(__file__).resolve().parents[2] / "data" / "players.local.json"

OFF_SLOTS = ("QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT")
DEF_SLOTS_BASE = ("EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2")
DEF_SLOTS_NICKEL = ("EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "CB1", "CB2", "CB3", "S1", "S2")


@functools.lru_cache(maxsize=1)
def load_pool() -> dict[str, list[dict]]:
    players = json.loads(_POOL.read_text())
    by_team: dict[str, list[dict]] = {}
    for p in players:
        t = p.get("nfl_team", "")
        if not t or t == "FA":
            continue
        by_team.setdefault(t, []).append(p)
    return by_team


class Roster:
    def __init__(self, team: str, players: list[dict]):
        self.team = team
        self.depth: dict[str, list[dict]] = {}
        for p in players:
            self.depth.setdefault(p["position"], []).append(p)
        for pos in self.depth:
            self.depth[pos].sort(key=lambda x: x.get("overall", 0), reverse=True)
        self._off_cache: dict | None = None
        self._def_cache: dict[bool, dict] = {}

    def _nth(self, pos: str, i: int) -> dict | None:
        d = self.depth.get(pos, [])
        return d[i] if i < len(d) else (d[-1] if d else None)

    def offense(self) -> dict[str, dict]:
        if self._off_cache is None:
            self._off_cache = self._build_offense()
        return self._off_cache

    def defense(self, nickel: bool = False) -> dict[str, dict]:
        if nickel not in self._def_cache:
            self._def_cache[nickel] = self._build_defense(nickel)
        return self._def_cache[nickel]

    def _build_offense(self) -> dict[str, dict]:
        ot = self.depth.get("OT", [])
        og = self.depth.get("OG", [])
        return {
            "QB1": self._nth("QB", 0),
            "RB1": self._nth("RB", 0),
            "WR1": self._nth("WR", 0), "WR2": self._nth("WR", 1), "WR3": self._nth("WR", 2),
            "TE1": self._nth("TE", 0),
            "LT": ot[0] if ot else None, "RT": ot[1] if len(ot) > 1 else (ot[0] if ot else None),
            "LG": og[0] if og else None, "RG": og[1] if len(og) > 1 else (og[0] if og else None),
            "C": self._nth("C", 0),
        }

    def _build_defense(self, nickel: bool = False) -> dict[str, dict]:
        d = {
            "EDGE1": self._nth("EDGE", 0), "EDGE2": self._nth("EDGE", 1),
            "DT1": self._nth("DT", 0), "DT2": self._nth("DT", 1),
            "ILB1": self._nth("ILB", 0), "ILB2": self._nth("ILB", 1),
            "CB1": self._nth("CB", 0), "CB2": self._nth("CB", 1),
            "S1": self._nth("S", 0), "S2": self._nth("S", 1),
        }
        if nickel:
            d["CB3"] = self._nth("CB", 2)
        return d

    def kicker(self) -> dict | None:
        return self._nth("K", 0)


@functools.lru_cache(maxsize=64)
def roster(team: str) -> Roster:
    return Roster(team, load_pool()[team])


def team_list() -> list[str]:
    return sorted(load_pool())
