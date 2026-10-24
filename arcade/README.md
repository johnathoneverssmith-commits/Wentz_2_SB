# Backyard football: a complete two-player game

Milestone 4 of the isolated Wentz arcade track. Bluebirds and Foxes are fictional
five-player teams. This module has no franchise imports, API, database or network
play. It does not participate in the franchise production build. No dependencies,
shared verification rules or GitHub workflows are changed by this milestone.

## Launch and play

Use Node 22 or later. From the repository root:

```sh
npm ci
npm ci --prefix ui-source
npm --prefix arcade run dev
```

Open **http://127.0.0.1:5184**. The standalone server binds to loopback and refuses
an occupied port. Stop it with Ctrl+C. The existing root/UI lockfiles supply all
tools; do not install packages inside `arcade/`.

**A game** is four 3-minute quarters. Bluebirds open with the ball; Foxes receive the
second half. The leader at the end of regulation wins; a tie goes to overtime; the
game ends on a **final-score screen with a Rematch button**.

* **The clock** runs only while a play is live, one tenth of a game second per
  simulation tick, so a quarter is 30 seconds of live play. It stops between downs and
  while a kick is lined up. When it reaches 0:00 the **play in progress finishes** (a
  touchdown still gets its extra point); then the quarter ends. Q1 and Q3 end with the
  same team, spot and down; the end of Q2 is halftime, which gives **Foxes the ball at
  their own 28**. It is simulation time: it does not depend on the frame rate or the
  wall clock.
* **Downs.** Four downs to gain ten yards: the gold line is the marker, the HUD shows
  "2nd & 6.3" (or "Goal"), and a failed fourth down hands the ball to the other team at
  the spot.
* **Scoring.** Touchdown 6, **extra point 1**, **field goal 3**, safety 2 (to the
  defense). After any score or kick the other team gets the ball at its own 28.
* **Overtime** after a tied fourth quarter: each team gets one possession from its
  own 28 (Foxes first), four-down rules and first downs apply, and the possession ends
  on a score (touchdown plus point after, or a field goal), a turnover or a failed
  fourth down. The score is compared after **both** possessions; a tie plays another
  pair, up to five pairs, after which the game is declared a draw (this takes
  mirror-image play to happen).
* **Kicking.** A touchdown goes straight to the extra point (25 yards). Choose **Field
  goal** in the play menu on any down from within 57 yards of the posts, then **Kick
  field goal**. A **meter** swings by itself (a full swing is 100 ticks; after two swings
  it locks where it is): press your kick key as it crosses the centre. A kick is good
  when the marker is inside the green zone, and the zone is **wide for short kicks and
  narrow for long ones**. It is deterministic: the same press at the same distance
  always gives the same result. A miss gives the other team the ball where it was
  snapped, never deeper than its own 20.

**Controls.** Each player keeps the same keys all game:

| | Blue (left hand) | Orange (right hand) |
| --- | --- | --- |
| Move | `W A S D` | arrow keys |
| Pass to #3 / #4 (offense) | `Q` / `E` | `,` / `.` |
| Switch defender (defense) | `F` | `/` |
| Hands, to intercept (defense) | `R` | Right Shift |
| Kick (extra point, field goal) | `G` | `'` |
| Snap / Next down | `Enter` (either player) | |

1. Choose **Handoff**, **Slants**, **Go routes** or **Field goal**, then **Snap**. On a
   handoff the running back #2 takes the ball; on a pass the QB #1 holds it and #3/#4
   run routes. Your control follows the carrier; a white ring marks each human, gold
   marks the carrier.
2. **Passing.** The ball flies for one second to the dashed landing circle. Each route
   has its own depth, and one defender covers each receiver. The ball is caught cleanly
   only if the receiver is at the circle and no defender is within **2.2 yards** of it.
   A defender inside **1.6 yards** intercepts; between 1.6 and 2.2 he breaks it up. A
   human defender intercepts only with **Hands**, timed so the 0.6-second window overlaps
   the arrival. The covering AI defender holds coverage for a fraction of a second after
   the throw, then breaks on the ball, so **when you throw and to whom decides whether
   the pass is open**: see the timing table in [PLAYTEST.md](PLAYTEST.md). Throwing at
   once is one window; every route has others later in the play. No outcome is rolled.
3. **Blocking.** Two AI blockers each take one of the closest defenders and stand
   between him and the carrier; a defender within 1.8 yards of his own blocker moves at
   40% speed.
4. **Tackles and the end of a down.** Touch the carrier within **1.8 yards** to tackle.
   Tackles, sidelines, touchdowns, interceptions, safeties, incompletions and a 15-second
   play limit end the down **once**.
5. **Pause / Resume** freezes the whole simulation. **Restart** and **Rematch** begin a
   new game at 0-0. Changing windows or hiding the page pauses and clears input.

**Saving.** Only **`wentz.arcade.down.v1`** in localStorage is read/written. The
version-4 envelope holds the whole snapshot: quarter, clock, score, down, marker, any
kick in progress, the overtime possession count and the winner. A live play or a swinging
kick **reloads paused**; a finished down, a kick that has been taken, overtime and the
final screen reload exactly, and nothing is scored, kicked or advanced twice. Version 1, 2
and 3 saves migrate (an old drive becomes the first quarter of a new game with a full
clock; a finished touchdown or safety is scored once; a finished touchdown still gets its
extra point). Invalid or self-contradictory saves start fresh. A storage-denied browser can
still play. Franchise saves and other keys are untouched.

## Verify

```sh
node node_modules/@playwright/test/cli.js install chromium
npm --prefix arcade run verify
```

Linux machines missing libraries use `install --with-deps chromium`. Installed
Chrome can be used locally via `E2E_BROWSER_CHANNEL=chrome` (PowerShell:
`$env:E2E_BROWSER_CHANNEL='chrome'`). `verify` explicitly runs typecheck, all arcade
unit tests, standalone production build and all arcade browser tests, failing at
the first failure. Individual scripts: `typecheck`, `test`, `build`, `e2e`.

Playwright owns its temporary server, blocks service workers, refuses an existing
server and tears it down afterwards. Tests block external requests. JSON results,
traces and screenshots are under ignored `arcade/test-results/`; the isolated
build is under ignored `arcade/dist/`.

The existing advisory **Arcade E2E** workflow executes these checks with Ubuntu
Chromium on the exact PR head, without production credentials or databases. The
required standard test/deployment workflow is unchanged. Standard green CI alone
is **not** evidence that arcade tests ran. `wentz-verify` still labels its arcade
check as manual attestation and qualifies its verdict; inspect the dedicated
workflow's actual steps, counts and head separately.

## Code and regression boundaries

- `core/simulation.ts`: readonly IDs, teams, arcade speed abilities, immutable movement
  and field clamps; per-player speed scales for blocked defenders.
- `core/kick.ts`: the meter, the distance-dependent tolerance and the kick constants.
- `core/down.ts`: formations, routes, coverage and pursuit, blocking, the pass contest,
  tackles, downs, scoring, the game clock, quarters, halftime, kicks, overtime and the
  final. No React, storage, browser time or random generator. Terminal steps return the
  exact same snapshot and cannot award a second result.
- `core/clock.ts`: fixed-step accumulator, pause and a 100 ms catch-up cap.
- `browser/`: keyboard/lifecycle adapter, Canvas view (including the kick meter), React
  HUD and versioned arcade-only persistence with migration.
- `tests/`, `e2e/`: core rules and golden timing tables, save round trips and migration,
  boundary tests for every radius, the clock and the kick meter, real keyboard
  playthroughs, prepared-save tests for halftime, overtime and the final, and **a
  complete real-browser game** in which both players attack and defend through four
  quarters to the final screen.

See [PLAYTEST.md](PLAYTEST.md) for the demonstrations of player agency, the measured
numbers and the negative controls.

## Limits

A local shared-keyboard game: no kickoffs, punts, onside kicks, two-point tries,
penalties, injuries, substitutions, touch controls, franchise roster import or network
play. Catches resolve at the landing point, not along the flight path. The AI covers
simply, so the game is tuned, not calibrated: an attentive human defender who goes to
the landing point and presses Hands intercepts most early throws, and two players who
both play perfectly mirrored football tie (hence the draw rule). Scoring in the scripted
full-game test is low. Keyboard rollover limits depend on the physical keyboard. Only
Chromium is exercised by current CI.
