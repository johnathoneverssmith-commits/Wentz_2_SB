"""Home-field advantage, measured rather than asserted (OQ-10).

Python port of `src/engine/home-field.ts`. This MUST stay behaviourally
identical to it; if one changes, change both and note it in
`docs/decisions.md`.

The engine used to give the home team nothing. Over 47,616 simulated games an
even matchup was a coin flip to within noise, and what little residual there
was turned out to be the tie rate rather than an edge. The real league is not
like that: over the 2018-2025 regular seasons the engine is calibrated against
- 2,127 games - the home team wins **54.02%** of the time (ties as half) by a
mean margin of **+1.57 points**.

`analysis/31_home_field.py` measures that, and more usefully measures *where*
in a game the advantage shows up by splitting each channel on `posteam_type`.
Every one of them favours the home offense:

    channel                          home       away
    completion rate                  0.60811    0.59647
    sack rate per dropback           0.06196    0.06473
    interception rate per dropback   0.01999    0.02056
    field goals made                 0.85023    0.84177
    yards per carry                  4.557      4.496
    pre-snap fouls per play          0.01857    0.01964

Two readings are worth pausing on. Field-goal *distance* attempted is 39.15 at
home against 39.21 away - all but identical - so the kicking gap is kickers
kicking better, not an easier set of attempts. And the foul gap is almost
entirely pre-snap: subtract those and the live-ball rate differs by 0.7%,
which is nothing. That is the crowd-noise story showing up exactly where the
story says it should, in the snap count.

**The split is symmetric, and that is the point.** Each channel's home-away
difference is halved and applied as `+half` to the home offense and `-half` to
the away one, so the league average does not move and nothing §22 measures
league-wide changes.

**The scale is 1.11.** `HOME_FIELD_SCALE` exists so the size of the effect
could be fitted rather than assumed. Swept over every ordered pair of the 32
teams (`analysis/32_fit_home_field.ts`): scale 0 gives a 50.18% home win rate,
scale 2 gives 57.27%, scale 4 gives 62.51%, and a 19,840-game check at scale 1
gives 53.62%. Anchored on that last and largest sample, the league's 54.02%
wants 1.11 - so the measured gaps need scaling by a tenth and no more.

Fitting the win rate rather than the mean margin is a deliberate choice: the
league's +1.57 margin would want 1.32, which puts the win rate two standard
errors above the league. The margin here comes out around +1.3.

**And it costs the calibration nothing.** Points per team-game across those
same three scales: 20.84, 20.82, 20.84. None of it applies without rosters
either - `simulate_game(seed)` with no team codes, which is how §22/§23
validate, is byte-identical to the pre-OQ-10 engine.
"""

from __future__ import annotations

import math
import os

# The measured home-minus-away gap in each channel, halved.
HOME_FIELD = {
    "complete": 0.0242982,        # M09 COMPLETE, logit
    "sack": -0.0233465,           # M04 SACK, logit; home offense sacked less
    "interception": -0.0143485,   # M09 INTERCEPTION, logit
    "fg_made": 0.0324745,         # M20 MADE, logit
    "rush_yards": 0.030280,       # yards per carry
    # Multiplier on the dead-ball foul hazard. Measured on fouls charged to
    # the team *with the ball* but applied to the whole hazard, which then
    # splits between offense and defense as it always did - a slight
    # over-application, worth about 0.07 flags a game, and separating the two
    # would mean reordering the RNG draws for a rounding error.
    "presnap_penalty": 0.9723782,
}


def _env_scale() -> float | None:
    raw = os.environ.get("HOME_FIELD_SCALE")
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


# Fitted at 1.11 by `analysis/32_fit_home_field.ts` against the league's home
# win rate. Zero reproduces the pre-OQ-10 engine exactly. The environment
# override exists for that script alone.
HOME_FIELD_SCALE = _env_scale()
if HOME_FIELD_SCALE is None:
    HOME_FIELD_SCALE = 1.11


def home_shift(edge: int, channel: str) -> float:
    """The home-field shift for one channel, for the team on offense.

    `edge` is +1 when the offense is the home team, -1 when it is the visitor,
    and 0 at a neutral site (the Super Bowl) or when there is no venue to
    speak of.
    """
    if edge == 0:
        return 0.0
    return edge * HOME_FIELD_SCALE * HOME_FIELD[channel]


def home_penalty_scale(edge: int) -> float:
    """Pre-snap foul multiplier for the offense.

    Multiplicative because it scales a hazard rate, with the scale as an
    exponent so home and away stay exact reciprocals at any scale.
    """
    if edge == 0:
        return 1.0
    return math.pow(HOME_FIELD["presnap_penalty"], edge * HOME_FIELD_SCALE)
