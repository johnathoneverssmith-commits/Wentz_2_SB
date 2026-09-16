"""Team quality the modelled families cannot see — mirror of
`src/engine/team-strength.ts`.

See the long docstring in the TypeScript file for the measurements, the sweep
and the reasoning. The short version: the rating layer carried about half the
team-quality signal it should (between-team points sd 2.15 against a real
4.28; favourite win rate 56-59% against a real 66-70%), every one of the seven
modelled families was already calibrated correctly at 0.99-1.0x its historical
anchor, and the shortfall is the channels V1 does not model at all — depth,
special teams, blocking. This is that remainder as one fitted channel.

Kept in step with the TypeScript by hand, like `staff*.py`. If you change one,
change both, or the validation pipeline stops measuring the engine that ships.
"""
from __future__ import annotations

# Snap weight by depth-chart position. Steeper than playing time really is, on
# purpose: weight toward the players who decide games without letting a long
# roster of camp bodies dominate the average.
DEPTH_WEIGHTS = [1.0, 0.35, 0.12, 0.05]

# Fitted, not chosen — see the sweep table in the TypeScript file.
TEAM_STRENGTH_SCALE = 1.2

# Per point of index, from the offense's point of view. The one fitted number
# is the scale above; these set how it spreads across the channels.
PER_POINT = {
    "complete": 0.055,   # logit, M09 COMPLETE
    "sack": -0.045,      # logit, M04 SACK
    "rush_yards": 0.055,  # yards, M15 rush
}


def strength_index(roster) -> float:
    """How good is the team that actually takes the field, 0-99.

    Memoised on the roster object: this is read three times a play, and
    walking a 53-man roster each time cost about two orders of magnitude. A
    depth chart does not change inside a game, and the franchise layer builds
    a fresh roster per game, so the memo never outlives what it describes.
    """
    hit = getattr(roster, "_strength_index", None)
    if hit is not None:
        return hit

    num = 0.0
    den = 0.0
    for players in roster.depth.values():
        for i, p in enumerate(players):
            w = DEPTH_WEIGHTS[i] if i < len(DEPTH_WEIGHTS) else 0.0
            if w == 0.0:
                continue
            num += w * float(p.get("overall", 0) or 0)
            den += w
    out = num / den if den > 0 else 0.0
    try:
        roster._strength_index = out
    except AttributeError:  # a slotted roster: correct, just uncached
        pass
    return out


def strength_shift(off: float, deff: float, channel: str) -> float:
    """The shift for one channel, from the two teams' indices.

    A difference and nothing else: centring both on a league mean before
    subtracting reads as though it matters and cancels exactly. It is also why
    the league average cannot move — across a balanced schedule every team is
    on both sides of this.
    """
    return (off - deff) * PER_POINT[channel] * TEAM_STRENGTH_SCALE
