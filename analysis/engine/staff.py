"""Coaching staff model (spec §16) — Python mirror of ``src/engine/staff.ts``.

A small set of quality ratings plus explicit tendency knobs for the head coach
and the two coordinators. Feeds ``staff_shift.py``, which nudges the same
resolver logits/means the player rating layer touches. Effects are deliberately
subtle (best-vs-worst full staff ~= 3-4 points/team-game). No staff -> zero shift.

Kept behaviourally identical to the TypeScript module.
"""

from __future__ import annotations

from dataclasses import dataclass

OFF_SCHEMES = (
    "west_coast", "vertical", "spread", "power_run", "zone_run", "pro_style",
)
DEF_SCHEMES = (
    "four_three", "three_four", "multiple", "cover_3", "cover_2", "man_press",
)


@dataclass(frozen=True)
class HeadCoach:
    name: str
    game_management: float  # 1-99: 4th downs, timeouts, situational calls
    discipline: float       # 1-99: team discipline -> fewer penalties
    aggression: float       # -1..+1 vs the league-average 4th-down go rate


@dataclass(frozen=True)
class Coordinator:
    name: str
    rating: float           # 1-99: scheme design + in-game adjustments
    scheme: str
    tendency: float = 0.0   # OC: pass rate over expectation. DC: blitz rate. (-1..+1)
    tempo: float = 0.0      # OC only: -1..+1 snap tempo (positive = faster)


@dataclass(frozen=True)
class Staff:
    head_coach: HeadCoach
    oc: Coordinator
    dc: Coordinator


def league_average_staff(label: str = "League Average") -> Staff:
    """A perfectly neutral staff — every shift it produces is zero."""
    return Staff(
        head_coach=HeadCoach(f"{label} HC", 50.0, 50.0, 0.0),
        oc=Coordinator(f"{label} OC", 50.0, "pro_style", 0.0, 0.0),
        dc=Coordinator(f"{label} DC", 50.0, "multiple", 0.0, 0.0),
    )


def rating_norm(rating: float) -> float:
    """Map a 1-99 rating to roughly [-1, +1] (50 -> 0), clipped."""
    return max(-1.0, min(1.0, (rating - 50.0) / 40.0))


# scheme_tag values each scheme is a good fit for (mirror of the TS maps).
OFF_SCHEME_TAGS = {
    "west_coast": ("west_coast", "play_action", "move_te", "zone_run", "outside_zone"),
    "vertical": ("vertical", "spread", "play_action", "downhill"),
    "spread": ("spread", "rpo", "zone_run", "outside_zone", "west_coast"),
    "power_run": ("power_run", "gap_scheme", "inline", "downhill", "pass_pro"),
    "zone_run": ("zone_run", "outside_zone", "west_coast", "move_te"),
    "pro_style": ("play_action", "inline", "move_te", "power_run", "west_coast"),
}
DEF_SCHEME_TAGS = {
    "four_three": ("base_4_3", "one_gap", "penetrate", "attack", "wide_9"),
    "three_four": ("base_3_4", "two_gap", "contain", "nose"),
    "multiple": ("nickel", "cover_3", "split_safety", "robber", "move_te"),
    "cover_3": ("cover_3", "single_high", "zone", "robber"),
    "cover_2": ("cover_2", "split_safety", "zone"),
    "man_press": ("man_press", "cover_man", "cover_1", "nickel"),
}


def scheme_fit_fraction(tag_lists, scheme_tags) -> float:
    """Fraction of `tag_lists` (one per player) that overlap `scheme_tags`."""
    want = set(scheme_tags)
    fit = n = 0
    for tags in tag_lists:
        if not tags:
            continue
        n += 1
        if any(t in want for t in tags):
            fit += 1
    return fit / n if n else 0.0
