# Milestone 2 focused playtest / re-review

The correction stays inside the standalone arcade module. No chance rolls,
franchise integration, drive rules, blocking, networking or new dependencies.

## Reachable deterministic demonstrations

Every row starts with Restart and uses only ordinary Snap, pass/action commands
and continuous movement. No player coordinates, ratings, saved state or ball state
are injected. The unit tests use exact 1/60-second steps. Browser tests send actual
keyboard events and control only browser time through Playwright; original
real-time movement/lifecycle coverage remains.

| Play and inputs from the default formation | Observed outcome |
| --- | --- |
| Slants, Snap, immediate Q; defense idle | #3 catches on flight tick 60 |
| Same throw; Orange holds Arrow Up from release | Breakup / incomplete on tick 60 |
| Same movement; Right Shift at flight tick 40 (about 0.67 s) | Human #1 intercepts on tick 60; zero offensive yards |
| Same movement; Hands pressed immediately at release | Hands expires; incomplete, not interception |
| Go, Snap, wait 50 ticks with neutral input, then Q | AI #3 intercepts by moving to the landing point |
| Handoff; Blue D + Orange Arrow Left | Human tackle, tick 24, **2.5 yards** |
| Same rushing input; Orange retreats with Arrow Right | AI tackle, tick 49, **5.1 yards** |
| Handoff; Blue W+D evasion + Orange Arrow Left | Tackle, tick 84, **6.2 yards** |

Both targets on both passing plays have immediate-completion regression cases
from the ordinary formation. Wrong-team passing/switch/hands commands are ignored.
After a reachable human interception, the browser test uses Orange comma to pass,
Blue R/F for defense, then checks actual human-controlled Orange #3 and Blue #2
movement. It observes each in a direction that cannot pass through AI movement.

These are repeatable demonstrations, **not sampled outcome percentages**. They
show input sensitivity, not a calibrated football model or arbitrary human skill.
The automated timing is exact; a person should follow the landing marker and
press Hands during the last half second of flight. No reflex-perfect input is
needed for basic positioning and breakups. For an interception demonstration,
press Arrow Up and Q together immediately after snapping Slants, then press Right
Shift about two-thirds of a second later.

## Regression gates and negative controls

Run from the repository root:

```sh
npm --prefix arcade test
npm --prefix arcade run e2e
npm --prefix arcade run verify
```

The focused files are `tests/agency.test.ts`, `tests/save.test.ts` and
`e2e/agency.spec.ts`. All browser cases use the awaited page-error fixture.

| Review gap | Direct oracle | Disposable mutation detected |
| --- | --- | --- |
| Unpaused airborne reload | Nonzero flight elapsed before reload; exact saved flight after reload, paused HUD, eventual result equals uninterrupted play | Remove restored flight; separately restore without pause |
| Completed-down reload / replay | Full snapshot, down number, possession, result and terminal count unchanged after reload and elapsed time; explicit Next down increments only the down | Discard completed save; separately step terminal snapshots again |
| Nonzero yards | Contact tick 24 and exactly 2.5 yards, independently calculated; browser checks literal 2.5 offensive yards | Force reported yards to zero (even though saved/HUD would agree) |
| Contact radius | At separation 1.81 yd no tackle; at 1.79 yd valid tackle | Enlarge radius; separately suppress valid contact |
| Human defensive agency | Same initial pass completes, breaks up or is intercepted based on movement / timed hands | Restore distant human defender; ignore human hands |
| Post-turnover control | Orange's actual #3 carrier moves left on Arrow Left | Disable Orange movement only when Orange has possession |

The geometric yardage oracle uses initial gap 7 yd and contact radius 1.8 yd:
`ceil((7 - 1.8) / (6.25 + 7) * 60) = 24` ticks, then
`6.25 * 24 / 60 = 2.5` yards. It does not derive expected yards from the saved
result or rendered text. The isolated contact-boundary and out-of-field tests are
focused geometry tests, explicitly separate from reachable playthrough evidence.

Negative controls run in an arcade-only disposable copy. Each must fail a relevant
expectation; navigation failures, page errors or test timeouts do not count.

## Remaining limitations

Local two-human practice only. Catch/deflection/interception is resolved at the
landing point, not along the entire airborne trajectory. AI uses simple coverage
and pursuit; automatic AI hands are more consistent than human timing. No first
down, four-down limit, scoreboard, kicks, blocking or network play. The save is a
small synchronous local snapshot, not a franchise save or server authority.
