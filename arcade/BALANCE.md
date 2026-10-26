# Passing balance: the measurement framework (Phase A)

This framework measures how passing and pass defense behave. It **changes no gameplay**: nothing under `core/` or `browser/` was touched.
It exists so the passing and coverage fixes that follow are driven by measurements and cannot silently make things worse.

```sh
npm --prefix arcade run balance:passing                       # the full report (about 2 minutes)
npm --prefix arcade run balance:passing -- --seeds 12 --games 6 --br 7 --json out.json
npm --prefix arcade run test:balance                          # the balance tests, including the framework's own
npm --prefix arcade run balance                               # the older whole-game pacing report
```

## What it contains

| File | Job |
| --- | --- |
| `balance/window.ts` | **The passing-window sweeper.** Throws one pass at a time from the same snapped play: every pass play, every eligible receiver (WR1, WR2, TE), every throw moment of the pocket. Records outcome, touchdown, yards, air distance, flight time, receiver separation at the throw and at arrival, the receiver's and the nearest defender's gap to the landing point, and both players' abilities. Aggregates by route, throw timing and air distance. |
| `balance/rng.ts` | Seeded randomness (mulberry32) and stream derivation (FNV-1a). Used **only** by the scripted players. |
| `balance/strategies.ts` | The strategy matrix: deep specialist, short specialist, balanced, timing-aware, best response. |
| `balance/matrix.ts` | Runs offenses x defenses x seeds x starting spots; summarises each cell; finds dominant strategies; reads cells against the provisional ranges; runs seeded regulation games. |
| `balance/stats.ts` | Wilson intervals, means with 95% intervals, percentiles, distributions, differences of proportions (Newcombe) and means, longest run. |
| `balance/imbalances.ts` | The registry of known imbalances, each with a detector and a status. |
| `balance/passing-report.ts` | The report. |
| `balance/sim.ts` | The existing harness; three additive changes only (see below). |

### Seeds, and why the engine is not random

The engine has no randomness: the same play, throw moment and receiver always give the same result. So a "seed" here varies the *scripted
player's choices* (which play, which receiver, when to throw) and nothing else. Each drive derives its own stream from
`hashSeed(seed, team, start)`, so a seed reproduces a matrix exactly and different seeds explore different choices. The best-response strategy
ignores seeds (it makes the same choices every time) and runs once per start.

### The strategies

* **deep specialist**: only the go route, to WR1 or WR2, at a random moment in ticks 20-160.
* **short specialist**: only slants, to any receiver, at a random moment in ticks 12-110.
* **balanced**: 30% runs, 35% slants, 35% go; any receiver; a random moment in ticks 12-140.
* **timing-aware**: waits until a receiver is *free* (nobody downfield of him in his lane and at least 2 yd of room), then throws to the most open one; gives up at 2.5 s. This models a person reading the defense.
* **best response**: from the real pre-snap situation, tries every pass play, receiver and throw moment (every 8 ticks, then the neighbouring ticks of the best) against the defense it will face and plays the highest-valued throw (touchdown 100, the signed yards for a catch, 0 for an incompletion, -60 for an interception). It sees the whole deterministic engine, so it is an **upper bound**: if it finds a window that scores nearly every time, a practiced person will too.

Defenses are the existing human-defender models: `idle`, `chase`, `attentive` (goes to the landing circle and presses Hands) and `cover` (shadows the first receiver, then ball and Hands). The ten other defenders are always the AI.

### Reading the report

Section 1 is the sweep: window maps (one letter per throw moment), rates by route, by throw timing and by air distance, and the telemetry
by outcome. Section 2 is the matrix with 95% intervals, each cell compared with the **provisional** ranges, the dominant strategy per defense
(significantly out-scores every other in points per drive: the 95% interval of each difference is above zero) with and without the best
response, and the scoring distribution. Section 3 (`--games`) plays regulation games. Section 4 lists the known imbalances and whether each is detected now.

Intervals are over drives, which are not fully independent (a seed and start spot share an engine path), so read them as a guide to which
differences are large, not as exact probabilities. A deterministic strategy's interval reflects only its spread over start spots.

The provisional ranges (completion 45-65%, interception 3-8%, touchdown drives up to 45%) are reference points from the design review.
**No test enforces them and nothing caps a probability**: a genuinely open receiver should be able to catch the ball.

## The baseline (before any passing change), recorded 2026-10-26 on master `df2e1a8`

Sweep: ticks 0-240 every 4, line 40, AI defense, humans idle (61 throws per route).

| Route | Complete [95% CI] | Intercepted | Longest open run | Yards per catch |
| --- | --- | --- | --- | --- |
| slants to WR1 | 3% [1-11] | 26% | 2 | 11.0 |
| slants to WR2 | 33% [22-45] | 38% | 16 | 14.9 |
| slants to TE | 61% [48-72] | 13% | 33 | -0.3 |
| go to WR1 | 69% [56-79] | 11% | 41 (164 ticks) | 28.6 |
| go to WR2 | 79% [67-87] | 2% | 47 (188 ticks) | 33.2 |
| go to TE | 0% [0-6] | 62% | 0 | - |

Seeded matrix, 6 seeds x 14 drives per cell (points per drive [95% CI], touchdown drives):

| Strategy | vs idle | vs attentive | vs cover |
| --- | --- | --- | --- |
| deep specialist | 4.95 [4.27, 5.63], 70% | 4.79 [4.09, 5.48], 68% | 1.42 [0.81, 2.02], 20% |
| short specialist | 1.32 [0.88, 1.76], 7% | 0.99 [0.58, 1.40], 6% | 1.25 [0.81, 1.69], 7% |
| balanced | 2.11 [1.50, 2.71], 21% | 1.67 [1.10, 2.23], 17% | 0.93 [0.50, 1.35], 7% |
| timing-aware | 1.83 [1.21, 2.46], 23% | 1.42 [0.85, 1.98], 17% | 2.49 [1.78, 3.20], 35% |
| best response | 7.00, 100% (8 drives) | 7.00, 100% (8 drives) | not run |

**Dominant strategies:** the deep specialist dominates against `idle` (leads balanced by 2.85 points per drive [1.94, 3.75]) and `attentive`
(3.12 [2.22, 4.01]); against `cover` no practicable strategy is far ahead of the others in an obvious way (timing-aware leads by 1.07 [0.14, 2.01]).
The best response scores a touchdown on every sampled drive in 2-3 plays. A *blind* deep throw beats a bot that reads the defense.
Two mirrored deep specialists score about 300 points in a regulation game.

## Phase B1: ball physics (before and after), recorded 2026-10-26

Phase B1 changed only how the ball flies and where it is thrown (`BALL_SPEED` 26 yd/s, flights of 0.35 to 2 s in whole ticks, and the
ball led to the receiver's projected position at arrival, `PASS_LEAD` 1, solved together with the flight time). Defense, catch radii,
clock and ratings were not touched. The sweep and matrix are the same as the baseline above.

| Route | Phase A: complete / intercepted / open run | Phase B1: complete / intercepted / open run |
| --- | --- | --- |
| slants to WR1 | 3% / 26% / 2 | **43%** / 11% / 22 |
| slants to WR2 | 33% / 38% / 16 | **7%** / 31% / 2 |
| slants to TE | 61% / 13% / 33 (-0.3 yd per catch) | **80%** / 5% / 34 (+2.0 yd) |
| go to WR1 | 69% / 11% / 41 | 69% / **28%** / 42 |
| go to WR2 | 79% / 2% / 47 | 75% / **21%** / 46 |
| go to TE | 0% / 62% / 0 | **30%** / 52% / 15 |

* Flight times: constant 1.0 s (air distance 7-44 yd) became 0.37-1.72 s, median 0.82 s.
* Receiver-to-ball gap on completed deep throws: 1.50 yd became 0.00 yd (an uncovered receiver on a straight route is within 0.1 yd of the ball whatever his speed).
* The speed-80 bug: go to WR1 completes 95% at receiver speed 70 and at 80 (it was 76% and 0%). Slow receivers (speed 40 or 55) complete 10% and 22%: they cannot get free of the corner, which is realistic.

Matrix (points per drive, then touchdown drives), 6 seeds x 14 drives:

| Strategy | vs idle: A to B1 | vs cover: A to B1 |
| --- | --- | --- |
| deep specialist | 4.95 (70%) to 4.44 (62%) | 1.42 (20%) to 1.17 (17%) |
| short specialist | 1.32 (7%) to 1.23 (5%) | 1.25 (7%) to 1.05 (1%) |
| balanced | 2.11 (21%) to 2.71 (32%) | 0.93 (7%) to 1.11 (11%) |
| timing-aware | 1.83 (23%) to **5.05 (58%)** | 2.49 (35%) to **5.05 (58%)** |
| best response | 7.00 (100%) to 7.00 (100%) | not run |

**What it means.** The ball physics did what they were meant to, and exposed what the old 20% overthrow had been hiding:

* A player who waits for a free receiver (the timing-aware strategy) is now the best practicable strategy against every defense: 58% touchdown drives, 1% interceptions, and the *same* result against idle, attentive and cover defenders, which means the human defender cannot affect the windows it picks. It dominates the cover defense (leads the deep specialist by 3.88 points per drive [3.11, 4.65]); against idle and attentive it leads the deep specialist by 0.6 [-0.3, 1.5], not significant. Skill is now rewarded; the AI defense is too weak to answer it (the next phases).
* Slants to WR2 fell from 33% to 7% because the corner shadows the receiver about 2 yd away, inside the 2.2 yd break-up circle. The old overthrow had put the ball past him.
* The tight end underneath is always open (80% complete, from tick 100 on every throw): a patient dump-off drive scores every time (125 completions in 125 throws in a spot check).
* The deep window still never closes (42-46 consecutive completions), and late throws after the route ends are intercepted.
* A short pass (0.35-0.5 s in the air) arrives before the defenders' reaction timers (18 ticks for most) expire, so short throws cannot be contested by reaction at all.
* Limit of the lead: it assumes straight running along the route, so a receiver who has finished his route and drifts can land up to about 4 yd from the ball on a late throw. Within the route the miss is under 0.1 yd (straight) or about 1 yd (through the slants cut).

Known imbalances after B1 (`balance/imbalances.ts`): **fixed** flight-time-constant, overthrow-catch-knife-edge, faster-receiver-worse-deep-game; **improved** slants-wr1-dead-target (3% to 43%), go-tight-end-intercepted (62% to 52% intercepted, completions 0% to 30%), deep-ball-uncontested (median gap 4.1 to 2.7 yd), slants-tight-end-loses-yards (-0.3 to +2.0 yd); **unchanged** deep-window-never-closes, early-slants-intercepted (93% to 87%), pocket-never-collapses; **worsened or new** slants-wr2-always-broken-up (33% to 7%), tight-end-dump-off-always-open (61% to 80%).

## Known imbalances

`balance/imbalances.ts` holds the entries below (ten at Phase A, twelve after B1), each with a detector, and `balance/framework.test.ts` asserts that every `open` one **is detected today**
and every `fixed` one is **not**. A pull request that fixes one changes its `status` to `fixed`, and the same test then proves the fix and
guards against its return. Nothing was tuned to make a test pass.

Open now: `deep-window-never-closes`, `early-slants-intercepted`, `go-tight-end-intercepted`, `pocket-never-collapses`, `slants-wr2-always-broken-up`,
`tight-end-dump-off-always-open`. Fixed: `flight-time-constant`, `overthrow-catch-knife-edge`, `faster-receiver-worse-deep-game`, `slants-wr1-dead-target`,
`deep-ball-uncontested` (partly), `slants-tight-end-loses-yards`. Each fixed entry carries a `resolution` note with the numbers.

Some reported numbers came from the scripted players rather than the engine: the older "balanced" bot threw to the always-covered WR1, the
"early" bot's tick-16 throw lies inside the always-intercepted window, the same drive from seven start spots was one measurement repeated
seven times, and "140-140" was a regulation score of two mirrored late-passing bots, not overtime.

## How the framework is tested

* `tests/balance-stats.test.ts` (unit suite): the statistics against hand calculation and published values, and the generator pinned to known outputs.
* `balance/framework.test.ts` (balance suite): the sweeper's telemetry against the same throws made by hand with the engine's own functions;
  reproducibility (same seeds and sweeps give identical results, a strategy's choices are fixed within a play); the strategies' behaviour;
  field-position handling; the statistics on real data; matrix consistency; comparison and dominance logic; the registry; and golden window
  maps of today's engine.
* Field position: in the interior of the field a route has the same windows from any line of scrimmage (within a throw or two flipping at a
  boundary tick); near the goal lines the end zone and the dead-ball line change them, and a catch into the end zone is a touchdown.

## Changes to the existing harness (`balance/sim.ts`)

Additive only: `control` and `fresh` are exported; an offense's `target` may be a function of the situation (and may be the tight end);
an offense may supply `throwNow` to throw when its own rule says so. The existing policies and every existing report number are unchanged.

## Using it for the next phases

Each fix should come with the sweep and matrix run before and after, the imbalances it fixes flipped to `fixed`, and the golden window maps
updated deliberately. Monotonicity checks for the Milestone 5C ratings (a faster or more skilled receiver never lowers completion; a better
defender never raises it) belong beside the sweeper's `abilities` overrides once the rating seams exist.
