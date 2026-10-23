# Backyard football — a short two-player drive game

Milestone 3 of the isolated Wentz arcade track. Bluebirds and Foxes are fictional
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

**The game.** Blue attacks right, orange attacks left (the direction flips with
possession). The offense has **four downs to gain ten yards**: the gold line is the
first-down marker, the HUD shows "2nd & 6.3" (or "Goal" inside the ten). Reaching the
marker, judged on the yardage shown for the play, gives a fresh first down. Failing on
fourth down (a short tackle, an incomplete pass) hands the ball to the other team
**at the spot**. A **touchdown is worth six**; a **safety is worth two** to the defense.
After a score the *other* team gets the ball at its own 28-yard line. Interceptions
change possession at the interceptor's spot with no yards credited. There is no game
clock, kicking, extra point, penalty or game end: a game is a series of drives, and
**Restart** starts a new game at 0–0.

**Controls.** Each player keeps the same keys all game; the actions you need are on
your own side of the keyboard:

| | Blue (left hand) | Orange (right hand) |
| --- | --- | --- |
| Move | `W A S D` | arrow keys |
| Pass to #3 / #4 (offense) | `Q` / `E` | `,` / `.` |
| Switch defender (defense) | `F` | `/` |
| Hands, to intercept (defense) | `R` | Right Shift |
| Snap / Next down | `Enter` (either player) | |

1. Choose **Handoff**, **Slants** or **Go routes**, then **Snap** (button or
   `Enter`). On a handoff the running back #2 takes the ball; on a pass the QB #1 holds
   it and #3/#4 run routes. Your control follows the carrier (QB, RB, or the receiver
   after a catch); a white ring marks each human, gold marks the carrier.
2. **Passing.** The ball flies for one second to the dashed landing circle. The
   receivers run different routes (slants: #3 short, #4 a little deeper; go: #3 deep,
   #4 slightly less), and one defender covers each. The ball is caught cleanly only if
   the receiver is at the circle and no defender is within **2.2 yards** of it. A
   defender inside **1.6 yards** intercepts; a defender between 1.6 and 2.2 breaks
   the pass up (incomplete). A human defender intercepts only with **Hands** timed so
   the 0.6-second window overlaps the arrival; without it he can only break the pass
   up. Switching cancels the window. The covering AI defender holds his coverage for a
   fraction of a second after the throw, then breaks on the ball; so throwing early
   or choosing the receiver whose defender is farther from the landing circle matters,
   and so does where your defender stands. No outcome is rolled: it is geometry and
   timing at 1/60-second steps.
3. **Blocking.** Two AI blockers (the QB and #5 on a handoff, the back #2 and #5 on a
   pass) each take one of the defenders closest to the carrier and stand between him
   and the carrier. A defender within **1.8 yards** of a blocker, human or AI, moves at
   **40%** speed; a gold bar on the field joins each blocker to the defender he holds.
   A carrier who runs behind a blocker gains yards; a blocked human defender can
   switch to a free teammate.
4. **Tackles and the end of a down.** Touch the carrier within **1.8 yards** to
   tackle. Tackles, sidelines, touchdowns, interceptions, safeties, incomplete
   passes and a 15-second play limit each end the down **once**. **Next down** /
   `Enter` lines up the next snap (incomplete passes keep the spot).
5. **Pause / Resume** freezes the whole simulation. **Restart** resets to a fresh game.
   Snap, Next down, Restart and Pause clear held input. Changing windows or hiding
   the page pauses; explicitly resume and press movement again. Click the field after
   navigating controls to restore focus.

**Saving.** Only **`wentz.arcade.down.v1`** in localStorage is read/written. The
version-3 envelope holds the whole snapshot including the **score, down and marker**;
reload restores a finished down exactly (the score is recorded once, when the play
ends, never again by reload or Next down) and a live down reloads **paused**, even
mid-flight. Version-1 and version-2 saves migrate: the completed-play count, a fresh
1st down and marker are derived, and a finished touchdown or safety in an old save is
scored once. Invalid saves start fresh. A storage-denied browser can still play, with a
visible warning. Franchise saves and other keys are untouched. Open **Player
positions** to compare all ten identities and coordinates with the saved snapshot.

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

- `core/simulation.ts`: readonly IDs, teams, arcade speed abilities, immutable
  movement and field clamps. Gameplay supplies AI targets and per-player speed
  scales (blocked defenders). Speed is `4 + rating / 20` yards/second.
- `core/down.ts`: formations, play commands, routes, coverage and pursuit, blocking,
  ball flight and the catch/intercept/break-up contest, contact, terminal rules,
  downs, marker, scoring and the completed-play counter. No React, storage, browser
  time or random generator. Commands are one-shot; movement advances at 1/60 s.
  Terminal steps return the exact same snapshot and cannot award a second result.
- `core/clock.ts`: fixed-step accumulator, pause and capped 100 ms catch-up.
  Equal per-tick input at 30/60/144 ordinary rendering FPS produces equal state.
- `browser/`: keyboard/lifecycle adapter, Canvas view, React HUD and versioned
  arcade-only persistence with migration. No application test-state hooks.
- `tests/`, `e2e/`: core rules (downs, scoring, pass contest boundaries, blocking),
  snapshot round trips and migration, and real keyboard playthroughs. Browser tests
  that need exact timing let Playwright control the clock while keyboard events,
  React, animation frames and saving stay real; original real-time lifecycle tests
  and wall-clock pass/rush playthroughs are kept.

See [PLAYTEST.md](PLAYTEST.md) for reproducible demonstrations of player agency
and the negative-control results.

## Limits

A local shared-keyboard game: no kicking, extra points, penalties, returns, game
clock, end of game, touch controls, franchise roster import or network play. Blocking
is two AI blockers and a slowdown, not a contest of strength. Catches resolve at the
landing point, not along the flight path. The AI covers simply, so the gameplay is
tuned, not calibrated: late throws into coverage are usually intercepted, and the
offense mostly decides by play, target and timing. Keyboard rollover limits depend on
the physical keyboard. Only Chromium is exercised by current CI.
