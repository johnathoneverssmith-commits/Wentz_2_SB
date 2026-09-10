"""Scheme fit (OQ-3) — Python mirror of ``src/engine/staff-fit.ts``.

A unit's fit fraction, centred on the league-mean fit for the same scheme (over
all 32 depth charts), times a small coefficient. ``pro_style`` / ``multiple``
are scheme-agnostic and contribute nothing — which keeps ``league_average_staff``
an exact no-op.
"""

from __future__ import annotations

from .staff import DEF_SCHEME_TAGS, OFF_SCHEME_TAGS, scheme_fit_fraction

_NEUTRAL_OFF = "pro_style"
_NEUTRAL_DEF = "multiple"
_FIT_COMPLETE = 0.08
_FIT_RUSH = 0.40

_OFF_SLOTS = ("QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT")
_DEF_SLOTS = ("EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2")


def _tags(unit: dict, slots) -> list:
    out = []
    for s in slots:
        p = unit.get(s)
        out.append(p.get("scheme_tags") if p else None)
    return out


_baseline: dict | None = None


def scheme_fit_baseline() -> dict:
    """League-mean fit fraction per scheme, over all 32 current depth charts."""
    global _baseline
    if _baseline is not None:
        return _baseline
    from .roster import roster, team_list
    teams = team_list()
    offs = [_tags(roster(t).offense(), _OFF_SLOTS) for t in teams]
    defs = [_tags(roster(t).defense(), _DEF_SLOTS) for t in teams]
    off = {s: sum(scheme_fit_fraction(u, tg) for u in offs) / len(teams)
           for s, tg in OFF_SCHEME_TAGS.items()}
    dfn = {s: sum(scheme_fit_fraction(u, tg) for u in defs) / len(teams)
           for s, tg in DEF_SCHEME_TAGS.items()}
    _baseline = {"off": off, "def": dfn}
    return _baseline


def off_scheme_fit_shift(scheme: str, offense_unit: dict) -> dict[str, float]:
    """Offense's scheme-fit contribution for its OC scheme. Zero for pro_style."""
    if scheme == _NEUTRAL_OFF:
        return {"complete": 0.0, "rush": 0.0}
    dev = (scheme_fit_fraction(_tags(offense_unit, _OFF_SLOTS), OFF_SCHEME_TAGS[scheme])
           - scheme_fit_baseline()["off"][scheme])
    return {"complete": _FIT_COMPLETE * dev, "rush": _FIT_RUSH * dev}


def def_scheme_fit_shift(scheme: str, defense_unit: dict) -> dict[str, float]:
    """Defense's scheme-fit contribution (deltas to the offense's shifts). Zero for multiple."""
    if scheme == _NEUTRAL_DEF:
        return {"complete": 0.0, "rush": 0.0}
    dev = (scheme_fit_fraction(_tags(defense_unit, _DEF_SLOTS), DEF_SCHEME_TAGS[scheme])
           - scheme_fit_baseline()["def"][scheme])
    return {"complete": 0.0 - _FIT_COMPLETE * dev, "rush": 0.0 - _FIT_RUSH * dev}
