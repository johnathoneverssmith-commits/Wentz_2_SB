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

## Phase B2: defensive coverage (before and after), recorded 2026-10-26

Phase B2 changed only how the AI defense behaves. The ball physics, catch and break-up radii, the hybrid clock, the ratings and the plays are
untouched. The old defense read the play call (`state.play === 'go'` chose a 0-yd cushion, a 36-tick reaction and a trailing technique; a
slant got a 7-yd cushion and an 18-tick reaction); the new one reacts to what it can see:

* **Cornerbacks (man):** they hold the depth they line up at (a cushion of about 10 yd, scaled by the receiver's speed against their own: a burner gets more room) while the receiver is shallow, close the cushion as the receiver goes from 8 to 18 yd deep, and attack a receiver who breaks off the stem (up to 80% of the cushion at a full sideways break). They aim 0.15 s ahead of where they *read* the receiver to be going, and the reading follows the real velocity with a 0.15 s delay, so a cut costs them a step. They play 1.2 yd to the inside, and backpedal at 85% speed while their man is behind them.
* **Linebackers and safeties (zone):** a linebacker with a receiver assigned (the tight end) follows him anywhere within 10 yd of his landmark; the free safety stays 5 yd over the top of the deepest receiver running vertically.
* **The ball:** after about a quarter of a second (15 ticks; 21 if he is behind his man and has to turn) every defender who can reach the landing point before the ball lands, and the one covering the target, goes for it. One who can get there at least 0.15 s early plays it on the spot (where he intercepts); one who cannot plays it from beside (where he breaks it up). This replaces the 20-yd safety cliff and the 18/36-tick delays.
* A mirrored play now moves identically for either team (a zone defender's idle sway used his raw x).

| Route | Phase A: comp / INT | B1 | B2 |
| --- | --- | --- | --- |
| slants to WR1 | 3% / 26% | 43% / 11% | **28% / 3%** |
| slants to WR2 | 33% / 38% | 7% / 31% | **15% / 26%** |
| slants to TE | 61% / 13% | 80% / 5% | **46% / 8%** |
| go to WR1 | 69% / 11% | 69% / 28% | **5% / 36%** |
| go to WR2 | 79% / 2% | 75% / 21% | **5% / 28%** |
| go to TE | 0% / 62% | 30% / 52% | **2% / 80%** |

Separation (mean over throws): completions had 7.4 yd to the nearest defender at the throw and 6.2 at arrival (B1: 5.0 and 4.8); incompletions 4.4 and 2.6; interceptions 2.4 and 1.8. A completion needs about 7 yd of room at the throw because a defender who reads the ball in a quarter of a second closes about 4-5 yd during a 0.7 s flight and the break-up circle is 2.2 yd wide.

Ratings (completed / intercepted over the whole pocket, receiver speed across, corner speed down; base WR 70, CB 74):

| slants to WR1 | WR 60 | WR 70 | WR 80 | WR 99 |
| --- | --- | --- | --- | --- |
| CB 60 | 39% / 3 | 41% / 3 | 48% / 2 | 56% / 0 |
| CB 74 | 33% / 2 | **30% / 3** | 31% / 2 | 48% / 0 |
| CB 90 | 18% / 3 | 20% / 3 | 23% / 2 | 31% / 0 |

Deep throws only (lands 20+ yd past the line while the receiver is still at pace; both wideouts, every throw moment; speed and acceleration both set), completed % / intercepted % [mean separation at arrival]:

| deep | CB 60 | CB 74 | CB 90 |
| --- | --- | --- | --- |
| WR 60 | 42 / 16 [2.5] | 0 / 22 [2.4] | 0 / 27 [2.6] |
| WR 70 | 38 / 24 [3.3] | **10 / 36 [2.8]** | 0 / 40 [2.8] |
| WR 80 | 37 / 28 [4.2] | 26 / 37 [3.7] | 0 / 47 [3.4] |
| WR 90 | 33 / 32 [4.8] | 28 / 38 [4.3] | 18 / 51 [4.0] |
| WR 99 | 29 / 28 [5.4] | 27 / 39 [4.7] | 18 / 48 [4.6] |

(With the old stacked-in-front corner every cell of this table was 0% completed.)

Matrix (points per drive and touchdown drives vs idle; B1 to B2 final): deep specialist 4.44 (62%) to 0.27 (2%); short specialist 1.23 (5%) to 1.23 (1%); balanced 2.71 (32%) to 0.60 (2%); **timing-aware 5.05 (58%) to 2.58 (12%)**, against every defense alike, still ahead of the short specialist by 1.4 points per drive [0.8, 1.9]. The best response still scores a touchdown on every sampled drive, in 3.5 plays (9 before the trailing correction, 2-3 before B2): it finds the late deep window by search, which a human cannot. Regulation games run 12.4-12.7 real minutes with the scripted offenses (unchanged by B2).

**What B2 did not fix, and why (decisions for the next phase):**

* **The quick game is still open.** A throw in the first half-second to either wideout completes 100% of the time (the corner is ten yards off and needs a quarter of a second to see the ball), so a bot that repeats it wins every drive (7.0 points per drive for the scripted quick passer). The game has no randomness, so any window that exists is perfectly repeatable; this is what the hybrid seeded model and pressure are for.
* **(Fixed after review, see the next section.) The deep route was closed at baseline ratings and barely opened with a speed edge** (`deep-routes-closed-at-equal-speed`): the corner starts about ten yards off, a receiver needs more than two seconds of speed advantage to close that, and the 31-yd route is nearly over by then. This needs a design decision, not another constant: corner alignment depth, route stems, or ball placement.
* **The pocket still lasts 4.1 s**, so waiting for the one open window is free.
* **The tight end on the go play is still a turnover** (74% intercepted by the linebacker who is on the ball), and **a slants catch by the tight end is behind the line** (-0.4 yd): route geometry.

### Deep coverage correction: the corner trails (2.5 yd behind), recorded 2026-10-26

The first B2 model left the deep game closed for every pair of ratings (the old table: 0% in every cell). The traces showed why. After the
receiver was 18 yd deep the corner's target was 1.2 yd *in front of* him. A pass is led to where the receiver will be, so a defender in front of
him is nearer to every deep ball than the receiver is, and the receiver can only get past him by gaining the whole ten-yard cushion: 25 points of
speed is about 1.25 yd/s, 8 s, against a 4.1 s pocket and a 31-yd route. Catch resolution made it worse (below). The committed corner now plays
`MAN_STACK = -2.5`: at the receiver's hip, 2.5 yd behind. He still starts about ten yards off, in front, and is still a corner: an equal-speed
receiver is not freed (WR 70 against CB 74 completes 10% of deep throws), and the receiver must actually get past him, which takes a speed edge.

Experiments behind the choice (disposable probes, not in the engine): trailing 2 yd gives 0% at equal speed and 23% with a +15 edge; 2.5 gives 10% and 26%; 3 gives
32% at equal ratings, too generous for a corner who is faster than the receiver. A hip-turn speed penalty did nothing (the corner never gets to the
turn). Moving the free safety deeper, further over the top, or toward the deepest receiver changed deep completions by 6 points or less, because
he lines up in the middle of the field, 22 yd from the sideline routes: real deep help is Cover 3, a Phase D feature. Press or off alignment moves
the short game hugely (a 3.2 yd cushion: quick throws 78% to 11%, timing-aware 2.7 to 1.3 points per drive; 13.3 yd: timing-aware 6.6 and 90% touchdown
drives) but not the deep game, so alignment is not a small tuning change and is left to Phase D. Letting the nearer player win the ball (instead of
the 1.6/2.2 yd radii) opened the short game to 59-72% on slants and 89-100% on quick throws: it belongs to the catch model of Phase C.

Short game, before and after the correction: slants to WR1 30% / 3% to 28% / 3%, WR2 15% / 21% to 15% / 26%, tight end unchanged, the quick window unchanged (100% to both wideouts before tick 24).

**Why more speed beyond 80-90 stops adding completions (investigated, not a defect).** Against the same corner, a faster receiver's deep window
opens earlier and closes earlier; its length does not grow:

| CB 74, WR1 | window of completing throws (tick) | completing throws (2-tick grid) | deep throws before the window |
| --- | --- | --- | --- |
| WR 70 | 140-150 | 6 | 18 |
| WR 80 | 130-160 | 16 | 18 |
| WR 90 | 120-152 | 17 | 18 |
| WR 99 | 110-144 | 18 | 22 |

The window is the time between the receiver getting past the corner and running out of route: the go route ends at 31 yd, a 99-rated receiver is
there at about tick 128, and a ball led to the end of the route misses a receiver who has begun to settle (receiver-to-ball gap 2 yd at tick 148, then
a defender wins it). A faster receiver also reaches 20 yd, where a throw counts as deep, sooner, while the corner is still in front of him, so more of his
deep throws land before the window and are intercepted. The share of deep throws that complete therefore flattens (29% at WR 99 against a corner of 60, 42% at
WR 60) although the receiver is open earlier, and the separation at arrival keeps rising (2.5 yd to 5.4 yd). The benefit of speed is time: the window opens
at tick 110 instead of 140, half a second sooner in a 4 s pocket. Nothing was changed for this. A longer go route would widen the window; that is a route decision.

**Remaining interception concern.** Deep throws are intercepted 35% of the time against 8% completed at baseline. About half are thrown while the corner is still in front
of the receiver (correct: he is nearer the ball), and the rest are a catch-resolution effect: any defender inside 1.6 yd of the landing point intercepts even when the
receiver is nearer to it (in the traces: receiver 0.3 yd away, defender 1.4 yd away, interception). Entry `deep-interceptions-high` records it as open for the seeded catch model.

### Codex review fix (early defender keeps his spot)

A defender who reached the landing point early used to back out: the on-ball test compares the time he needs with the time left, so once the
ball was less than ~0.4 s from landing it flipped him to the 1.9 yd "beside" spot, outside the 1.6 yd interception radius (Codex measured 0.9 yd
at release backing out to 1.85 at arrival). A defender already within 0.95 yd of the spot now stays there. Side effect, measured: the deep
throws that were incomplete only because the defender retreated are now intercepted when a defender (safety over the top, trailing corner,
linebacker) is under the ball: go to WR1 0%/0% became 0%/49%, WR2 0%/39%, TE 2%/80%, slants to WR2 15%/21%. Completion rates, the matrix
(timing-aware 2.58 points per drive, 12% touchdown drives, best response 9 plays) and the quick windows did not move. The deep game is still
closed; a missed deep throw is now a turnover more often than an incompletion, which is a design question for the next phase.

## Known imbalances

`balance/imbalances.ts` holds the entries below (ten at Phase A, twelve after B1, fifteen after B2), each with a detector, and `balance/framework.test.ts` asserts that every `open` one **is detected today**
and every `fixed` one is **not**. A pull request that fixes one changes its `status` to `fixed`, and the same test then proves the fix and
guards against its return. Nothing was tuned to make a test pass.

Open now: `go-tight-end-intercepted`, `pocket-never-collapses`, `slants-tight-end-loses-yards`, `quick-slants-always-open`, `deep-interceptions-high`.
Fixed: `flight-time-constant`, `overthrow-catch-knife-edge`, `faster-receiver-worse-deep-game` (B1), `slants-wr1-dead-target`, `deep-ball-uncontested` (partly), and by B2
`deep-window-never-closes`, `early-slants-intercepted`, `slants-wr2-always-broken-up`, `tight-end-dump-off-always-open`, `deep-routes-closed-at-equal-speed` (the trailing corner). Each fixed entry carries a `resolution` note with the numbers.

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
