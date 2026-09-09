"""Rating layer (spec §12–§14) — turns lineups into logit / yardage modifiers.

modifier(family) = Σ_attr  beta_per_z(attr) · clip(z(attr), -3, 3)

where z(attr) = (unit_mean_rating - ref_mean) / ref_sd over the participating
players who have that attribute. Signs are already folded into `beta_per_z`
(step 2 of 22_rating_calibration.py).

§12 centering: `ref_mean` is the mean over the whole 1,024-player reference
pool, but the engine only ever fields *starters*, who sit above that mean — so
a raw modifier is non-zero even for a league-average matchup and league
scoring drifts down (seen in the first §23 pass before this fix). Each
`*_shift` therefore subtracts that family's league-mean modifier over its
on-field slot (`_offsets()`), so an average real matchup → ≈0 shift and only
matchup *differences* move the outcome. With this in place the paired ON/OFF
§23 check holds league points flat and widens score-margin variance. Paired
invariant tests are unaffected (the offset is common to both cells, cancels).
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


# ---- §12 league centering -----------------------------------------------------
# Per-family mean modifier over the on-field slot across all 32 depth charts.
# Subtracting it makes an average real matchup produce ≈0 net shift.

@functools.lru_cache(maxsize=1)
def _offsets() -> dict[str, float]:
    from engine.roster import roster, team_list  # lazy: roster imports nothing here
    slots = {
        "qb_accuracy": lambda o, d: [o["QB1"]],
        "qb_ball_security": lambda o, d: [o["QB1"]],
        "receiver_hands_routes": lambda o, d: [o["WR1"], o["WR2"], o["WR3"], o["TE1"]],
        "yac_ballcarrier": lambda o, d: [o["WR1"]],
        "coverage": lambda o, d: [d["CB1"], d["CB2"], d["S1"], d["S2"]],
        "open_field_tackling": lambda o, d: [d["CB1"], d["CB2"], d["S1"], d["S2"], d["ILB1"], d["ILB2"]],
        "protection": lambda o, d: [o["LT"], o["LG"], o["C"], o["RG"], o["RT"]],
        "pass_rush": lambda o, d: [d["EDGE1"], d["EDGE2"], d["DT1"], d["DT2"]],
        "run_defense_front7": lambda o, d: [d["EDGE1"], d["EDGE2"], d["DT1"], d["DT2"], d["ILB1"], d["ILB2"]],
        "runner": lambda o, d: [o["RB1"]],
    }
    teams = team_list()
    off = {t: roster(t).offense() for t in teams}
    deff = {t: roster(t).defense() for t in teams}
    out: dict[str, float] = {}
    for fam, pick in slots.items():
        vals = [family_modifier(fam, pick(off[t], deff[t])) for t in teams]
        out[fam] = sum(vals) / len(vals)
    kx = [family_modifier("kicking", [roster(t).kicker()]) for t in teams]
    out["kicking"] = sum(kx) / len(kx)
    return out


def _centered(fam_key: str, players: list[dict]) -> float:
    return family_modifier(fam_key, players) - _offsets().get(fam_key, 0.0)


# ---- which families feed which resolver call (spec §11 player-modifier lists) --

def completion_logit_shift(off_pass_catchers, defenders, qb) -> float:
    """M09 COMPLETE: qb accuracy (+) + receiver hands/routes (+) + coverage (-)."""
    return (
        _centered("qb_accuracy", [qb])
        + _centered("receiver_hands_routes", off_pass_catchers)
        + _centered("coverage", defenders)
    )


def interception_logit_shift(qb) -> float:
    """M09 INTERCEPTION: qb ball security (-)."""
    return _centered("qb_ball_security", [qb])


def sack_logit_shift(ol, rushers) -> float:
    """M04 SACK: protection (-) + pass rush (+)."""
    return _centered("protection", ol) + _centered("pass_rush", rushers)


def rush_yards_shift(ol, front7, runner) -> float:
    """M14 yards: runner (+) + OL (folded into runner family weights) + front seven (-)."""
    return _centered("runner", [runner]) + _centered("run_defense_front7", front7)


def yac_yards_shift(receiver, tacklers) -> float:
    """M10 yards: ball-carrier (+) + open-field tackling (-)."""
    return _centered("yac_ballcarrier", [receiver]) + _centered("open_field_tackling", tacklers)


def fg_logit_shift(kicker) -> float:
    return _centered("kicking", [kicker])
