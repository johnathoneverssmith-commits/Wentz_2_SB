# Backyard football — one playable down

Milestone 2 of the isolated Wentz arcade track. Bluebirds and Foxes are fictional
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

1. Choose **Handoff**, **Slants** or **Go routes**, then click **Snap** or press
   **Enter** while the field has focus. Players wait in formation before the snap.
2. Blue uses **W A S D**; orange uses the **arrow keys**. These mappings never
   swap. On offense your control follows the carrier: QB #1, RB #2 on a handoff,
   or receiver #3/#4 after a catch. White rings identify human control; gold marks
   the carrier. Blue attacks right; orange attacks left after a turnover.
3. Blue passes with **Q / E**; orange passes with **comma / period**. Each
   player's keys stay theirs after a turnover. The QB can move before throwing.
   The two routes lead #3/#4 to different spaces. Flight lasts **one second**;
   the landing circle shows the target. A catch transfers held movement input
   immediately to the receiver.
4. Blue defense switches with **F** and contests with **R**. Orange defense
   switches with **/** and contests with **Right Shift**. Touch a carrier within
   **1.8 yards** to tackle. Stand within **2.2 yards** of a pass landing to break
   it up. To intercept, get within **1.6 yards** and time **Hands** near arrival:
   its visible ring lasts **0.6 seconds**. Early hands expire; switching cancels
   the window. AI covers receivers before a throw, moves toward the landing
   point during flight, and pursues a carrier after a catch. There are no random
   outcome rolls or predetermined success percentages. Players may overlap;
   blocking remains out of scope.
5. Tackles, sidelines, touchdowns, interceptions, safeties and a 15-second play
   limit end the down once. The HUD reports signed yards, turnover and touchdown.
   Interceptions award **zero offensive yards** and have no return in this milestone. **Next down** / **Enter**
   reforms at the spot (within the playable 2–98-yard range). Incompletions keep
   the original spot; turnovers change teams and attack direction. A touchdown
   resets practice to the same offense's own 28-yard line. A safety changes sides
   and resets practice. Down N is a practice sequence number, not NFL down/distance.
6. **Pause / Resume** freezes the whole simulation. **Restart** resets to a fresh,
   unpaused pre-snap formation. Snap, Next down, Restart and Pause clear held
   input. Changing windows or hiding the page pauses; explicitly resume and press
   movement again. Click the field after navigating controls to restore focus.

Only **`wentz.arcade.down.v1`** in localStorage is read/written. Reload preserves
positions, phase, possession, result and completed-play count; a live down reloads
paused, including during flight. Changed simulation frames save independently of
the slower HUD updates. The version-2 envelope retains this key and migrates
version-1 saves, deriving prior completions from their down number. Invalid saves
start fresh. A storage-denied browser can still play, with a visible warning.
Franchise saves and other keys are untouched. Open **Player positions** to compare
all ten identities and coordinates with the saved arcade snapshot.

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
  movement and field clamps. Gameplay supplies AI targets; defaults retain the
  original movement-drill contract. Speed is `4 + rating / 20` yards/second.
- `core/down.ts`: formation, play commands, routes, pursuit, ball flight, catches,
  contact and terminal rules, timed hands and the completed-play counter. No React,
  storage, browser time or random generator.
  Commands are one-shot; movement advances at 1/60 second. Terminal steps return
  the exact same snapshot and cannot award a second result.
- `core/clock.ts`: fixed-step accumulator, pause and capped 100 ms catch-up.
  Equal per-tick input at 30/60/144 ordinary rendering FPS produces equal state;
  long suspension deliberately does not simulate missed minutes.
- `browser/`: keyboard/lifecycle adapter, Canvas view, React HUD and versioned
  arcade-only persistence. No application test-state hooks are exposed.
- `tests/`, `e2e/`: core rules, snapshot round trips, real simultaneous keyboard
  interactions, pass/catch control, result/next-down flow and reload assertions.
  All eight original lifecycle/browser cases remain, with explicit snaps into a
  passing down. Strict Mode replay must leave exactly one active keyboard
  listener set and animation callback. Awaited page-error collection remains.

See [PLAYTEST.md](PLAYTEST.md) for reachable input sequences, the independent
yardage oracle and the focused correction evidence. New browser scenarios use
Playwright to control time while sending real keyboard events through the UI;
they do not inject or teleport gameplay state. Existing real-time lifecycle tests
are retained.

Negative controls run in a disposable copy, never in the PR branch. Removing the
handoff, catch-control transfer, defender switching, tackle, interception or
correct touchdown flag must fail direct rule assertions. Allowing terminal
simulation must fail snapshot identity. Browser result text is compared against
the actual saved completed down. These controls must fail relevant assertions,
not navigation errors. A timeout during flight has a save round-trip regression.

## Limits / Milestone 3

This is a local shared-keyboard practice loop: no first-down marker, four-down
possession rules, scoreboard, kicks, penalties, return plays, blocking, animations,
touch controls, franchise roster import or network play. Catches/interceptions
resolve at the endpoint, not at intermediate flight intersections. Auto-leading
open receivers is intentionally generous; defenders can now contest their actual
landing points. Keyboard rollover limits depend on the
physical keyboard. Only Chromium is exercised by current CI.

Milestone 3 should focus on down-and-distance, scoring/drive flow, better defensive
coverage/blocking and gameplay tuning before roster integration or networking.
