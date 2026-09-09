"""Rating layer (spec §12–§14) — turns lineups into logit / yardage modifiers.

modifier(family) = Σ_attr  beta_per_z(attr) · clip(z(attr), -3, 3)

where z(attr) = (unit_mean_rating - ref_mean) / ref_sd over the participating
players who have that attribute. Signs are already folded into `beta_per_z`
(step 2 of 22_rating_calibration.py). An all-average matchup → modifier ≈ 0,
so the empirical baseline is reproduced by construction (§12 centering).
"""

from __future__ import annotations

import functools
import json

from lib_py.report import ARTIFACTS

_CLIP = 3.0


@functools.lru_cache(maxsize=1)
def _coeffs() -> dict:
    return json.loads((ARTIFACTS / "ratings" / "rating_effect_coefficients.json").read_text())


@functools.lru_cache(maxsize=1)
def _ref() -> dict:
    return json.loads((ARTIFACTS / "ratings" / "attribute_reference_stats.json").read_text())[
        "attribute_reference_stats"
    ]


def families() -> dict:
    return _coeffs()["families"]


def _unit_mean(players: list[dict], attr: str) -> float | None:
    vals = [p["attributes"][attr] for p in players
            if p and isinstance(p.get("attributes"), dict) and p["attributes"].get(attr) is not None]
    return sum(vals) / len(vals) if vals else None


_mod_cache: dict = {}


def family_modifier(fam_key: str, players: list[dict], scale: float = 1.0) -> float:
    """Sum beta·z over the family's attributes for this set of participating players."""
    key = (fam_key, tuple(p["id"] if p else None for p in players))
    hit = _mod_cache.get(key)
    if hit is not None:
        return hit * scale
    fam = families()[fam_key]
    ref = _ref()
    total = 0.0
    for a in fam["attributes"]:
        attr = a["attribute"]
        m = _unit_mean(players, attr)
        r = ref.get(attr)
        if m is None or not r or not r.get("sd"):
            continue
        z = (m - r["mean"]) / r["sd"]
        z = max(-_CLIP, min(_CLIP, z))
        total += a["beta_per_z"] * z
    _mod_cache[key] = total
    return total * scale


# ---- which families feed which resolver call (spec §11 player-modifier lists) --

def completion_logit_shift(off_pass_catchers, defenders, qb) -> float:
    """M09 COMPLETE: qb accuracy (+) + receiver hands/routes (+) + coverage (-)."""
    return (
        family_modifier("qb_accuracy", [qb])
        + family_modifier("receiver_hands_routes", off_pass_catchers)
        + family_modifier("coverage", defenders)
    )


def interception_logit_shift(qb) -> float:
    """M09 INTERCEPTION: qb ball security (-)."""
    return family_modifier("qb_ball_security", [qb])


def sack_logit_shift(ol, rushers) -> float:
    """M04 SACK: protection (-) + pass rush (+)."""
    return family_modifier("protection", ol) + family_modifier("pass_rush", rushers)


def rush_yards_shift(ol, front7, runner) -> float:
    """M14 yards: runner (+) + OL (folded into runner family weights) + front seven (-)."""
    return family_modifier("runner", [runner]) + family_modifier("run_defense_front7", front7)


def yac_yards_shift(receiver, tacklers) -> float:
    """M10 yards: ball-carrier (+) + open-field tackling (-)."""
    return family_modifier("yac_ballcarrier", [receiver]) + family_modifier("open_field_tackling", tacklers)


def fg_logit_shift(kicker) -> float:
    return family_modifier("kicking", [kicker])
