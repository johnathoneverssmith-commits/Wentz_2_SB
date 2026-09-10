"""Coaching -> resolver nudges (spec §16) — Python mirror of
``src/engine/staff-shift.ts``. All coefficients small on purpose; a
``league_average_staff`` produces exactly zero from every function.

v0 uses only the quality ratings and the explicit tendency knobs. Scheme fit is
on the model but not yet wired (needs per-scheme league centering — v0.1).
"""

from __future__ import annotations

from .staff import Coordinator, HeadCoach, rating_norm

# --- coefficients (tunable v0) ---
_HC_GO_AGGRESSION = 0.38
_HC_GO_GAMEPLAN = 0.08
_HC_PENALTY_SWING = 0.08

_OC_COMPLETE = 0.028
_OC_RUSH = 0.15
_OC_TEMPO_RUNOFF = 0.05

_DC_COMPLETE = 0.028
_DC_RUSH = 0.15
_DC_SACK = 0.06
_DC_BLITZ_SACK = 0.14
_DC_BLITZ_COMPLETE = 0.09


# --- head coach ---
def hc_penalty_scale(hc: HeadCoach) -> float:
    """Multiplier on the pre-snap / live-ball penalty hazard (disciplined -> < 1)."""
    return 1.0 - _HC_PENALTY_SWING * rating_norm(hc.discipline)


def hc_go_for_it_delta(hc: HeadCoach) -> float:
    """Logit delta on the M01 GO_FOR_IT class."""
    return _HC_GO_AGGRESSION * hc.aggression + _HC_GO_GAMEPLAN * rating_norm(hc.game_management)


# --- offensive coordinator ---
def oc_tempo_scale(oc: Coordinator) -> float:
    """Multiplier on snap runoff (faster tempo -> < 1)."""
    return 1.0 - _OC_TEMPO_RUNOFF * oc.tempo


def oc_offense_shift(oc: Coordinator) -> dict[str, float]:
    """Possessing team's OC contribution: COMPLETE logit + rush yд/carry deltas."""
    q = rating_norm(oc.rating)
    return {"complete": _OC_COMPLETE * q, "rush": _OC_RUSH * q}


# --- defensive coordinator ---
def dc_defense_shift(dc: Coordinator) -> dict[str, float]:
    """Defending DC contribution, as deltas to apply to the *offense's* shifts:
    ``complete``/``rush`` negative (suppression), ``sack`` positive."""
    q = rating_norm(dc.rating)
    return {
        "complete": _DC_BLITZ_COMPLETE * dc.tendency - _DC_COMPLETE * q,
        "rush": 0.0 - _DC_RUSH * q,
        "sack": _DC_SACK * q + _DC_BLITZ_SACK * dc.tendency,
    }
