"""Scheme fit (OQ-3) — Python mirror of ``src/engine/staff-fit.ts``.

A unit's fit fraction, centred on the league-mean fit for the same scheme (over
all 32 depth charts), times a small coefficient. ``pro_style`` / ``multiple``
are scheme-agnostic and contribute nothing — which keeps ``league_average_staff``
an exact no-op.
"""

from __future__ import annotations

from .scheme_tags import effective_scheme_tags
from .staff import DEF_SCHEME_TAGS, OFF_SCHEME_TAGS, scheme_fit_fraction

_NEUTRAL_OFF = "pro_style"
_NEUTRAL_DEF = "multiple"
_FIT_COMPLETE = 0.08
_FIT_RUSH = 0.40

_OFF_SLOTS = ("QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT")
_DEF_SLOTS = ("EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2")


def _tags(unit: dict, slots, derived: bool = False) -> list:
    out = []
    for s in slots:
        p = unit.get(s)
        if derived:
            out.append(effective_scheme_tags(p))
        else:
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


# ---- derived mode (Staff.scheme_fit == "derived"), mirror of staff-fit.ts ----

_slot: dict | None = None


def slot_baseline() -> dict:
    """Per-slot expected match shares: authored tags over the 32 reference charts,
    derived tags from artifacts/models/derived_fit_baseline.json."""
    global _slot
    if _slot is not None:
        return _slot
    import json
    from pathlib import Path
    from .roster import roster, team_list
    table = json.loads((Path(__file__).resolve().parents[2] / "artifacts/models/derived_fit_baseline.json").read_text())
    teams = team_list()

    def auth(slots, unit_of, want):
        w = set(want)
        out = []
        for slot in slots:
            a = an = 0
            for t in teams:
                p = unit_of(t).get(slot)
                if p and p.get("scheme_tags"):
                    an += 1
                    if any(x in w for x in p["scheme_tags"]):
                        a += 1
            out.append(a / an if an else 0.0)
        return out

    off = {s: {"auth": auth(_OFF_SLOTS, lambda t: roster(t).offense(), tg), "derived": table["off"][s]}
           for s, tg in OFF_SCHEME_TAGS.items()}
    dfn = {s: {"auth": auth(_DEF_SLOTS, lambda t: roster(t).defense(), tg), "derived": table["def"][s]}
           for s, tg in DEF_SCHEME_TAGS.items()}
    _slot = {"off": off, "def": dfn}
    return _slot


def _derived_deviation(unit: dict, slots, want, legacy_baseline: float, b: dict):
    w = set(want)
    fit = n = 0
    base = 0.0
    any_derived = False
    for i, slot in enumerate(slots):
        p = unit.get(slot)
        eff = effective_scheme_tags(p)
        if not eff:
            continue
        stored = bool(p.get("scheme_tags"))
        n += 1
        if any(x in w for x in eff):
            fit += 1
        if not stored:
            any_derived = True
        base += b["auth"][i] if stored else b["derived"][i]
    if n == 0:
        return None
    return fit / n - (base / n if any_derived else legacy_baseline)


def off_scheme_fit_shift_derived(scheme: str, offense_unit: dict) -> dict[str, float]:
    if scheme == _NEUTRAL_OFF:
        return {"complete": 0.0, "rush": 0.0}
    dev = _derived_deviation(offense_unit, _OFF_SLOTS, OFF_SCHEME_TAGS[scheme],
                             scheme_fit_baseline()["off"][scheme], slot_baseline()["off"][scheme])
    if dev is None:
        return {"complete": 0.0, "rush": 0.0}
    return {"complete": _FIT_COMPLETE * dev, "rush": _FIT_RUSH * dev}


def def_scheme_fit_shift_derived(scheme: str, defense_unit: dict) -> dict[str, float]:
    if scheme == _NEUTRAL_DEF:
        return {"complete": 0.0, "rush": 0.0}
    dev = _derived_deviation(defense_unit, _DEF_SLOTS, DEF_SCHEME_TAGS[scheme],
                             scheme_fit_baseline()["def"][scheme], slot_baseline()["def"][scheme])
    if dev is None:
        return {"complete": 0.0, "rush": 0.0}
    return {"complete": 0.0 - _FIT_COMPLETE * dev, "rush": 0.0 - _FIT_RUSH * dev}
