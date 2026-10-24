# Milestone 3 playtest: drives, scoring and agency

Everything below uses ordinary controls from the default formation: **Restart, Snap,
the pass/defense keys and held movement keys**. No coordinate, rating, ball or score
is injected. Unit tests step exact 1/60-second ticks; browser tests send real keyboard
events and only let Playwright control browser time (plus separate wall-clock tests).

## Deterministic demonstrations (exact, repeatable)

Same formation, same snap, only the human inputs differ.

| Play | Human inputs | Outcome |
| --- | --- | --- |
| Slants, Snap, `Q` at once | Orange idle | **Completion** to #3 |
| Same | Orange holds Up+Left for 40 ticks (about 0.67 s) | **Incomplete** (broken up) |
| Same | Same movement, then `Right Shift` at flight tick 40 | **Interception**, zero yards, ball to Foxes |
| Same | Same movement but `Right Shift` pressed at the throw | Hands expire: **incomplete**, not intercepted |
| Handoff | Blue holds D; Orange holds Left | tackle, tick 24, **2.5 yards** |
| Handoff | Blue holds D; Orange idle (no pursuit) | **5.1 yards** (AI tackle, tick 49) |
| Handoff | Blue holds D+W | **6.2 yards**: cutting off the defenders gains more |
| Handoff | Blue runs (1, -0.6) behind the blocker; Orange idle / chasing | **7.1** / **5.4 yards**, against 5.1 / 2.5 running straight |
| Four idle plays | Blue snaps and never moves | **Turnover on downs** at the 38; Foxes ball, 1st & 10 |
| A drive | Blue holds D every play, Orange idle | 6 first downs, **touchdown on play 14**, 6-0, Foxes ball at their 28 |
| Same drive | Orange chases left every play | the drive takes **29 plays** to score (7 first downs) |

**Receiver timing** (slants #3, #4; go #3, #4) against AI coverage with idle humans,
`c` complete, `x` incomplete, `I` interception, by throw tick 0, 6, ..., 90:

```
slants #3  c c c c c x x x x I I I I I I I
slants #4  c c c c x I I I I I I I I I I I
go     #3  c c I I I I I I I I I x x x x x
go     #4  c c I I I I I I I I I x x x x x
```

A throw made at once is open; a delayed throw meets the covering defender, and the
receiver you pick moves the window. The defender then decides the rest: a human can
turn any `c`/`I` cell into a break-up or an interception by position and Hands.

## Sampled evidence (not demonstrations)

A 1,500-down random-input sweep of the core (random plays, throws, switches, hands and
movement for both teams) ended every down exactly once, never changed the score except
by 6 for a touchdown or 2 for a safety (to the right team), changed possession only for a
turnover, a score or a failed fourth down, advanced the down by exactly one otherwise,
reset to 1st down after every first down and change of possession, never left an opposing
pair overlapping at the snap and never got stuck: 1,010 tackles, 344 interceptions, 140
incompletions, 6 touchdowns, 91 turnovers on downs and 160 first downs. These are
distributions of random play, not claims about human skill.

## Try it

`npm --prefix arcade run dev`, open http://127.0.0.1:5184. Blue: `WASD`, `Q/E` pass,
`F` switch, `R` hands. Orange: arrows, `,` `.` pass, `/` switch, Right Shift hands.
`Enter` snaps and starts the next down. Watch the landing circle, the gold marker and the
bars that show a blocked defender.

## Regression gates and negative controls

`npm --prefix arcade test` (81 tests), `npm --prefix arcade run e2e` (24 browser tests
on the Ubuntu advisory job), typecheck, standalone build; `verify` runs them in order.

Each defect below was applied alone to a disposable copy, and each failed on a
relevant assertion (the unmutated baseline passes 81 unit and 24 browser tests):

| Rule | Defect | Fails |
| --- | --- | --- |
| First down | never a first down; marker not reset | drive and first-down tests, browser drive |
| Down count | down never advances; incomplete uses no down | down-and-distance tests |
| Fourth down | no turnover on downs; the ball keeps its owner | fourth-down, drive tests, browser |
| Scoring | touchdown worth 7; credited to the defense; re-added by Next down; scorer keeps the ball; safety worth 0 | scoring, save, drive tests and browser |
| Persistence | save drops the score; migration forgets an old touchdown; reload re-scores a finished touchdown | save tests; browser reload tests |
| Marker | not clamped at the goal line | goal-to-go test, browser |
| Pass contest | catch radius widened / narrowed; break-up radius 0; human Hands not required | pass-boundary and agency tests |
| Blocking | no slowdown; blockers never assigned | blocking tests |
| Controls | home score shows away points; Orange pass key throws for Blue; interception not a turnover | browser and unit tests |
| Review fixes | break-up radius grows with the receiver's error; any blocker slows any nearby defender; field bars show every nearby defender; the result line ignores a turnover on downs | pass-boundary test; blocking tests (assignment, bars); browser fourth-down test |
| Carry-overs | everything from Milestones 1 and 2 | unchanged |

None of these failed by test timeout (one run during the session was stalled by the
laptop sleeping and was repeated cleanly).

## Limitations

Catches resolve at the landing point only. AI coverage is simple: its interceptions
need no timing, so a late throw into coverage is usually intercepted. Blocking is
two AI blockers and a speed penalty. There is no clock, kicking or end of game.

## After the review of PR #28

Three review findings were fixed: the break-up radius is the fixed 2.2 yards, a blocker
holds only his assigned defender (and the field bars show the same pairs), and the
result line counts a turnover on downs. Re-measured, the only demonstration that moved
was the straight handoff against an idle defender (5.2 yards at tick 50 became 5.1 at
tick 49, because a second defender no longer rides along with the blocked one); every
other figure and the receiver-timing table above are unchanged.
