# Simulation defect: the second-half kickoff is overwritten when Q2 ends mid-play

Found during the play-by-play audit (PBP-1). **Not fixed in PBP-1**: correcting it changes who has the ball and where, so it moves
scoring and belongs to the simulation-realism workstream, which should re-run the §22/§23 calibration after the change.

## What happens

`src/engine/sim.ts`, `scrimmage()`: the play's clock is spent by `advanceClock(...)`, which ends in `rollQuarter()` unless `deferRoll`
is passed (only touchdowns, safeties and failed fourth downs pass it). When that play uses up the second quarter:

1. `rollQuarter()` sets `qtr = 3`, resets the half clocks and runs `kickoff(1 - receivedOpening, "end_of_half")`: possession, yard line
   (about the 25) and 1st-and-10 are set for the second-half receiver.
2. `scrimmage()` has not finished. It then runs its own resolution against the **old** state: `this.yardline100 = newYl`, `ydstogo -= gained`,
   `down += 1` (or `newSeries`, or `turnover()` on a failed fourth down).

The second half therefore opens with the receiver at the spot, down and distance the *previous team's* play reached, or with the ball
flipped back to the team that had it at the end of Q2.

## Reproduction (committed fixture pool, no other setup)

```bash
NFL_POOL_PATH=test/fixtures/pool.json npx tsx -e '
import { simulateGame } from "./src/engine/sim.ts";
const g = simulateGame(1, "KC", "BUF", { trace: true, injuries: true, overtime: "nfl" });
const t = g.playTrace; const i = t.findIndex((p) => p.quarter === 3);
for (const p of t.slice(i - 2, i + 2)) console.log(p.team, "Q" + p.quarter, p.clock, p.down + "&" + p.ydstogo, "ball" + p.ballOn, p.call, p.gained);'
```

Seed 1, KC (home, team 0) at the end of Q2: `3&8.2 ball34 pass complete +15` (to the opponent's 19). Next traced play: `team 0 Q3 15:00 1&10 ball19`.
KC keeps the ball at the exact spot it reached, at the half, with a fresh clock. A half kickoff would have started someone at about ball75.
Seed 2: `ball58, +12` then `Q3 15:00 1&10 ball46` for the same team.

## How often

Over 600 games (pool-2026 rosters): the half kickoff fired inside a play in 448; in 381 of those the first second-half snap disagreed
with the kickoff's own start (median 25 yards of field position moved to the receiver; 12 of 305 comparable games flipped possession).
Control: with the kickoff at a play boundary it disagreed in 0 of 120. Measured by temporary instrumentation in `startDrive`,
not committed.

## Suggested direction (not applied)

Pass `deferRoll` for every play that can end Q2 and call `rollQuarter()` after the play's state is resolved, as the touchdown/safety
path already does; or make the roll idempotent against the state it replaced. Either way, expect points/team-game and the
second-half receiver's win rate to move.

## What PBP-1 does about it

Nothing in the simulation. The play-by-play shows the second-half opening as the engine produced it, with the drive boundary
at the half; it does not invent a kickoff row or "correct" the spot.
