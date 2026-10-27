# Milestone 4 playtest: a whole game, and what the players decide

Every demonstration starts from a fresh game or a prepared save and uses ordinary
controls: **Snap, the pass/defense/kick keys and held movement keys**. Nothing is injected
into a running game. Unit tests step exact 1/60-second ticks; browser tests send real
keyboard events and only let Playwright control browser time, plus wall-clock tests for
the older lifecycle and pass cases.

## Passing: when, and to whom, decides it

One letter per throw made 0, 4, 8 ... 120 ticks (two seconds) after the snap, defenders
and receivers on their own, humans idle. `C` caught, `x` incomplete (broken up), `I`
intercepted. These rows are golden tests (`tests/passing.test.ts`); the whole pocket is mapped
in `balance/framework.test.ts` and `BALANCE.md`. They were re-measured for Phase B1 (the ball
flies for as long as its distance needs and is led to exactly where the receiver will be).

```
slants to WR1  CCCCCCCCCCCCCCCxxxxxxxxxxxxxxxx
slants to WR2  CCCCCCCCCxxxxxxxxxxxxxxxxxxIxII
go to WR1      xxxxxxxxxxxxxxxxIxxIIIIIIIIIIII
go to WR2      xxxxxxxxxxxxxxxxIxxIIIIIIIIIIII
go to TE       xIIIxCxxIIIIIIIIIIIIIIIIIIIIIII
```

Each letter is one throw, four ticks apart (re-measured for Phase B2, when the defense stopped reading the play call). Slants to WR1 is open
for the first second, until the corner has seen the cut and closed (tick 60), then covered; slants to WR2 is open for about half a second;
the go routes are covered at baseline ratings (the corner starts ten yards off and a receiver no faster than he is never gets past); the tight end on the go play is a turnover almost throughout. The human-defender table below was recorded at Milestone 4 (ten players) and has not been re-measured since the eleven-a-side
rewrite or Phase B1. A human defender changes the picture:

| Play | Human inputs | Outcome |
| --- | --- | --- |
| Slants #3, throw at once | Orange idle | **Completion** |
| Same | Orange holds Up for 32 ticks (0.53 s) | **Incomplete** (broken up) |
| Same | Same movement, then Right Shift at flight tick 40 | **Interception**, ball to Foxes |
| Same | Right Shift pressed at the throw | Hands expire: **incomplete**, not intercepted |
| Slants #3 | throw at tick 24 | **Incomplete** against the AI alone |
| Slants #3 | throw at tick 44 | **Completion** against the AI alone |

## Rushing and blocking

Same handoff, same defense; only the human inputs differ (measured):

| Blue | Orange | Result |
| --- | --- | --- |
| holds D | chases left from the start | tackle at tick 24, **2.5 yards** |
| holds D | idle | **5.1 yards** (tick 49) |
| holds D+W | idle | **8.0 yards** (tick 108) |
| runs (1, -0.6), behind the blocker | idle / chasing | **8.7** / **5.4 yards** |
| a whole drive, D held every play | idle | touchdown on **play 14**, 6 first downs |
| same | chases every play | touchdown on **play 29**, 7 first downs |

## Kicking

| Situation | Press | Outcome |
| --- | --- | --- |
| Extra point (25 yards) | at the centre crossing, tick 25 | **good**, +1 |
| Extra point | the first instant (far end) | **no good**, 6 stays 6, ball still changes sides |
| Field goal from 27 yards (line 100) | tick 35 | **good**, +3 |
| Field goal from 57 yards (line 70) | the same tick 35 | **no good**, Foxes ball at the 70 |
| Field goal from the 38 | not offered | menu option disabled; snapping it does nothing |
| Meter left alone | after two swings (200 ticks) | locks at the far end: **no good** |

The same press is good from 27 yards and no good from 57: the green zone shrinks with
distance (`kickTolerance`).

## The shape of a game (browser, prepared saves, real inputs)

* **Clock:** a quarter is exactly **10,800 live ticks, three minutes at 60 ticks a second** (a unit test counts
  them). Pausing, reloading and a kick leave the clock where it was; after a finished play it runs for at most **six game seconds (360 ticks)** and then waits for the snap, however many times the menus are used (unit and browser tests).
* **Quarter end:** with 0:01 left and the ball at the 40, Blue runs; the clock hits 0:00
  mid-play, the HUD says the quarter ends after this play, the play finishes, and Next down
  opens **Q2 3:00** with the same team, spot and 2nd down.
* **Halftime:** the end of Q2 gives **Foxes the ball at their own 28**, 1st & 10, Q3 3:00.
  Reloading before and after changes nothing.
* **Regulation:** leading 10-3 at the end of Q4 ends the game on the final screen
  ("Final: Bluebirds win", the score, a Rematch button). Tied 7-7 goes to **overtime**:
  Foxes first, from their 28, no clock.
* **No limit on overtime:** with five tied pairs already played (eleven possessions), the next possession
  ends level and the game goes on; a sixth-pair touchdown and point after finally ends it, 16-9. Unit tests tie
  twelve and five hundred rounds in a row.
* **Overtime to a winner:** Foxes score and kick the point (7-14), Blue's possession fails
  on downs, the screen reads **"Final: Foxes win"**. Keys and buttons do nothing at the final;
  three reloads show the same final; Rematch starts Q1 3:00, 0-0.
* **A complete game** (`e2e/fullgame.spec.ts`): two scripted players attack and defend through
  all four quarters of 180 live seconds (43,200 simulation ticks). The quarterback waits half a second in
  the pocket and throws the quick slants window to the first receiver (Phase B2: the deep route is covered, so the old late go window no longer exists); the defender goes to the landing circle and presses
  Hands; after a catch the carrier runs for the goal line and the defender chases; kicks wait for the
  meter (Foxes' kicker misses every extra point and Foxes never kick field goals, so two otherwise identical
  teams cannot tie forever). It reaches the final screen: **122-0 after 278 completed plays, 260 passes,
  260 Hands presses, 17 touchdowns, 17 extra points, one field goal and 18 turnovers** (was 129-0 after 295 plays before the deep safety; recorded at the 5B head and not re-measured since: Phase B1 and B2 change pass timing and coverage), a mid-game reload
  that restores the finished down exactly, a check that the clock never spent more than the six-second allowance between plays, a reload at
  the final and a Rematch, in about **a minute and a half to two minutes**. The page is drawn ten times a second (the app steps
  the simulation six 1/60-second ticks per frame), which is the same game on a slower screen; the lopsided
  score comes from the scripts, not from how people will play.

## Sampled evidence (not demonstrations)

Scripted bots on the core, whole games: a mirror-image pair (same script both sides) ties and
plays overtime rounds for as long as it is allowed to; a run-only offense against an idle defense scores a
touchdown about every 15 plays; the same offense against a chasing defense stops at 4th down
and kicks field goals; early passes against an attentive defender that goes to the landing circle
and presses Hands are mostly intercepted. These numbers are why throwing at once is not the only
play and why the README says the game is tuned, not calibrated.

## Regression gates and negative controls

`npm --prefix arcade test` (137 tests), `npm --prefix arcade run test:balance` (22 gameplay-balance tests, run in the Arcade Chromium workflow too), `npm --prefix arcade run e2e` (39 browser tests, about 3.6 minutes locally),
typecheck, standalone build; `verify` runs them in order.

Each defect below was applied alone to a disposable copy and failed on a relevant assertion
(no test timeouts; the unmutated baseline passes the unit tests and the browser tests listed above). Where a
unit test caught it, the browser run was skipped.

| Area | Defect | Caught by |
| --- | --- | --- |
| Clock | a kick burns game clock; the clock runs twice as fast; expiry never flagged | clock tests |
| Quarters | the quarter does not advance; halftime after Q1; halftime ball to the opening team | clock and halftime tests |
| End of regulation | overtime without a tie; the leader loses | end-of-regulation tests |
| Scoring | extra point worth 2; field goal worth 2; a kick scores twice | scoring tests |
| Kicking | tolerance ignores distance; no range limit; the meter never swings; no auto-lock | meter and field-goal tests |
| Kick outcomes | a miss keeps the ball; a miss spotted unclamped | field-goal tests |
| Overtime | ends after one possession; draws at once | overtime tests |
| Game over | the final does not freeze the game | game-over test |
| Corrections | a quarter of 30 seconds again; the clock six times too fast; clock text rounding down; the save limit stuck at the old clock | clock, text and save tests |
| Overtime | ends after five pairs; the pair counter stuck or forgotten by the save | long-tie, overtime and save tests |
| Clock | a paused game keeps running; a kick burns clock | pause, kick and browser clock tests |
| Routes | a deep route leaves the field near the goal line | goal-line pass test |
| Save | the clock is dropped; migration empties the clock | save tests |
| Browser | reload resumes a kick unpaused; Rematch keeps the score; the final names the loser; Orange's kick key kicks for Blue | browser tests |
| Balance | slants route depth; go coverage reaction time | the golden timing table |
| Menu | a field goal from anywhere | field-goal range tests |

## Limitations

Catches resolve at the landing point only. The AI's coverage is simple, and its interceptions
need no timing. Blocking is two AI blockers and a speed penalty. No kickoffs, punts, two-point
tries or penalties. Two perfect mirror-image players can stay tied in overtime indefinitely, which is the specified behaviour.

## Pacing and balance (hybrid clock, deep safety, balance suite)

Measured with `npm --prefix arcade run balance` (scripted offenses, defenses and reaction delays; deterministic; 7 starting spots, both teams). Before = `b069f24` (clock stopped between downs, no deep safety); after = this head.

| | before | after |
|---|---|---|
| Plays per regulation game (think 2-8 s per snap) | 64-1800 (late/rush scripts looped without end) | 84-286 |
| Estimated real minutes per game (live play + think time + 3 s per kick) | 17-274 | 12-18 |
| Late deep pass vs idle/chasing defender: TD per drive, completions, interceptions | 100%, 100%, 0% (about 450 ticks of live play per throw) | 57%, 86%, 14% (3 plays a drive, about 175 ticks per throw) |
| Late deep pass vs attentive defender: points per drive | 6.0 | 4.0 |
| Late deep pass vs covering defender: points per drive | 1.3 | 1.3 (unchanged) |
| Early pass vs idle/chasing defender: points per drive, completion | 2.0, 88% | 2.0, 88% (unchanged) |
| Intermediate pass vs idle/chasing defender: points per drive, completion | 1.3, 74% | 0.4, 80% (see below) |
| Run-only vs idle / vs chasing defender: points per drive | 7.0 / 3.0 | 7.0 / 3.0 (unchanged) |
| Balanced offense vs covering defender: points per drive | 7.0 | 3.3 |

What changed: the fifth defender no longer rushes on a pass. He plays a deep safety (26 yards past the line, in the middle) and breaks on any pass that lands 20 or more yards downfield after 24 ticks of its flight, so a receiver who beats his man now meets someone ahead of him. A late go pass against a defense that does not react to the ball gains about 19 yards and is tackled, instead of scoring from anywhere; it scores only when thrown from close to the goal line (from the 98 in testing, not from the 86 or earlier). Deep passing is still the strongest offense against such a defender and its completions are unchanged (the catch window and Hands timing are not touched). Early passes do not change at all.

Intermediate passes drive differently: the same plays and yards happen, but the last play near the goal can now be an interception by the safety rather than an incomplete pass, and fewer drives end in a field goal; points per drive against an idle defender fell from 1.3 to 0.4 across the 14 sampled drives. This is a measured side effect, not a tuned target; it is not asserted by the suite.

The balance suite (`balance/balance.test.ts`) is separate from the technical tests and checks invariants only: late deep passes score on fewer than 80% of drives against non-covering defenders yet complete over half their throws and can be intercepted; a covering defender stops them more; early and intermediate passes still complete over 70% against defenders that ignore them; slower defender reactions never help the defense; a drive and its mirror image give identical results; deep starting spots never score less than own-end ones; a regulation game takes 40-400 plays and 6-30 estimated minutes for each offense style; slow thinking cannot stretch the game clock. Removing the safety fails it (negative control).

Remaining limitations: a late go pass against a defender who never switches to the ball is still the best play in the game (4.0 points per drive against 2.0 for early passes), because the scripted defenders are simple and a human defender who watches the throw can stop it; the balance numbers describe scripted players, not people.

### Review-cycle corrections (Codex findings on `1b0b572`)

* **Balance tests in CI:** the Arcade workflow runs `npm --prefix arcade run test:balance` after the unit tests (the unit config does not include `balance/`, so nothing runs twice). Negative control: restoring the pre-safety `core/down.ts` fails exactly that command (exit 1).
* **Save compatibility:** the last deployed format is version 3; it migrates. Unreleased version 4 (written by builds with 30-second and 180-second quarters) and unknown versions are rejected with a visible notice, never converted. Unit tests cover migration, rejection and the current format; a browser test checks the notice and the fresh game; negative controls: accepting version 4, removing the notice.
* **Clock accounting:** the balance report counts live-play and between-play clock separately; the suite requires both to be non-zero and their sum to equal four quarters (43,200 ticks). Dropping either component fails five tests.
* **Browser coverage:** the full-game test asserts its mid-game reload happened; disabling the reload condition fails it. The on-screen instructions now describe the hybrid clock.

## Milestone 5A: visual overhaul (what to judge by eye)

Automated tests show the scene is drawn (canvas size and aspect, turf and both team colours present, animations run without
errors, camera maths) but not that it looks good. Please judge by playing: sprites and animation (idle, run, throw, catch, block,
tackle and fall, celebrate, kick), the field and stadium, camera framing on deep passes, scoreboard and hints, banners
(touchdown, interception, first down, quarters), kick presentation, and whether anything obscures play.

Known visual limitations: sprites are procedurally drawn in a hand-inked style rather than hand-painted; the larger players overlap in the tight five-player formation (a gameplay layout, unchanged); players are 5 a side (11-on-11 is later);
the kicker is a stand-in sprite; field goal posts are simplified; no sound.

## Milestone 5B: eleven on eleven (what to judge by playing)

How to test it: snap a handoff (Enter), then run with WASD behind the line and watch the blockers lock up defenders and the
secondary and linebackers close on you. Pick Slants or Go routes: Q / E / Z throw to the first receiver, the second receiver and the
tight end (shown with key caps above them). Scramble with the quarterback (WASD before you throw): everybody keeps playing, the line
turns to run blocking, and the defense converges. Press F to take control of the next-nearest defender and / for Orange.

Measured on the scripted harness (`npm --prefix arcade run balance`), 11 against 11:

* a straight run gains about 3.5 yards a carry; a scrambling quarterback averages about 4 and is never longer than 10 (tests assert under 22);
* an idle quarterback is sacked after about 2.6 to 4 seconds;
* passes into coverage right after the snap are broken up or intercepted; throws timed to a receiver getting free complete about half the time;
* late deep passes (a go route thrown after 1.5 s) still complete about 90% of the time against a defense that does not cover the
  receiver, and score on most drives. This is the same imbalance 5C is meant to address with attributes (corner speed, safety range), and is the main thing to judge.

Known limitations: man coverage and zone drops are simple; there is no kickoff, coin toss, penalty or substitution; the defense reads
the play call; the tight formation near the goal line is squeezed; sprites overlap a little when linemen engage; players have
momentum, so a released key coasts to a stop in about a yard.

Verification at the 5B head: typecheck, build, 183 unit tests (personnel, behavior, movement and collision, passing windows, saves,
game flow), 22 balance tests, and 48 browser tests including a complete four-quarter game in the real page. Negative controls (each
breaks one behavior and the suite fails): no blocks forming, defenders that never pursue, a blocked defender who can still tackle,
receivers that stop after their routes, no collision separation, a line that keeps pass-blocking during a scramble, and pass
rushers that do not rush.
