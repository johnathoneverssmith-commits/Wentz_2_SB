# COMP-006: does a scripted skilled GM dominate the default CPU GM?

Analysis only. **Primary comparison: seasons 1-3** (see section 3). Run accounting: `RUN_ACCOUNTING.md`. No production gameplay, rating, pool, schema, cap or balance constant was changed. Harness: `harness/` (this folder; see `harness/README.md`)
(README there). Raw per-run JSON (~15 MB) is regenerable (runs are deterministic) and is not committed; the committed data are
`data/*.csv` (seat-seasons, league-seasons, run metadata) and `data/tables_*.md`.

## 1. Pinned setup
**All measurements use the pinned baseline below (`origin/master` `d219564`, with the pool and engine path listed). The branch has since merged a later `origin/master` to stay mergeable; that merge touches no file in this folder and no measurement was re-run on it. Do not read these results as describing current master.**

| | |
|---|---|
| Baseline | `origin/master` `d219564` (merge of PR #115). #115 is an ancestor (`git merge-base --is-ancestor c29858a d219564`), so the trade-model fix for contract dumping / specialist need is in force. |
| Pool | `ui-source/src/data/pool-2026.json`, sha256 `136d2e5e284d95edad6b32490cf98376fce97570732f6184da57c686fa4660fa`; leagues are the shipped Seeded League DNA leagues from `createLeague(seed)` (fictional players), `fantasyDraft` off, so play starts at `setup` and the first stages are the coaching draft and the year-one market. |
| Engine path | `online/src/phases.ts` -> `online/src/blocks.ts` -> `src/engine/sim.ts` `simulateGame`, headless, no DB. Every run file records the call count, the `talentScale` each call received (1 or 1.5 only), and Mock calls (schedule, draft class, bracket seeding, trade evaluation, never a game). `runs.csv`. |
| Talent | 1.0 = `realistic`, 1.5 = `amplified`. (A first attempt passed the number 1.5 and silently ran at 1.0 because the config takes string keys; caught by the scale assertion and fixed before any reported run.) |
| Seeds | 9601-9610 (disjoint from #95's 9301-9303 and #105's 9401-9408/9501-9502); pilot 9611-9613. |
| Design | Per league: 4 seat teams (spread over the alphabetical team list, offset by seed). **Control**: all 32 teams CPU. **Skilled**: the same 4 seats run by the scripted GM, 28 stay CPU. Same starting league (player-table fingerprint equal), schedule and CPU GM line-up (seated before seats are taken, so no CPU team's GM changes). After the first decision the random streams diverge: a pair is "same team, same league, different GM". |
| Extra arm | **Idle**: the same seats as human seats whose GM does what the production autopilot does (board's top pick, pass in free agency, skip/deny at the deadline, no re-signings, default plan, no depth edits). It separates "being a human seat" from "being skilled". |

## 2. The skilled GM and the information rule
Acts only through `online/src/decide.ts` (the functions behind the buttons), on its own turn, so every rule, turn order and refusal is real.
Decisions covered per season: coaching draft (the staff-suggestion value); five free-agency rounds, offseason and midseason (one bid per turn, unit-value-per-dollar, at 1.04x ask); the three-round trade deadline (propose upgrades paid with bench players and picks, respond to CPU offers); rookie draft (all rounds by hand, board projection valued by unit gain, positional caps) and rookie sign/release; extensions, franchise tag, fifth-year options; bench trimming, value-aware cap cuts and restructures at the reconciliation summaries; depth charts before each block; a small roster-based game-plan tilt (pass rate +-4); training-camp focus.
Reads only: player table (overall, age, contract, injury), the public draft board (`collegeOverall`, `expectedRatings`), all rosters/caps/standings, market asking prices, and `judgeTrade` (the trade screen's own read). It knows the measured unit weights in `unitValue.ts` (published in-repo; knowledge, not hidden state). `info-guard.test.ts` fails if the policy source touches `potential`, a prospect's `trueOverall`, CPU GM strategy/skill/difficulty, RNG, unwatched results (`state.games/history`), or the CPU's own decision procedures, and a behavioural test fails if any decision changes when those hidden fields are perturbed (the driver also runs every policy call against a view that has them removed, as the client does). Passes (10/10).

**Stages not exercised / limits of the harness** (also in every output file):
- Hooded Figure: skilled seats decline; CPU never gets one. Hot-seat firing is **on** and censors seats (below).
- Restructures only as a last-resort cap fix; no practice-squad moves; no cross-position depth slots.
- No per-opponent game-plan tailoring and no plan-preview tool (160 sims a look); the plan is a mild roster tilt. So **game-plan skill is not tested**.
- No coaching-staff changes after the year-one coaching draft (none is routed in this build).
- No multiplayer: seats never trade with each other; collusion/fairness untested.
- Instant signings and ad-hoc trades are refused by the server, so they cannot be used.
- No UI: the policy reads the same fields a screen shows, not what a person would *find* or understand. A scripted GM has no fatigue or misclicks.
- Free-agency bid quality is a single heuristic (one bid per turn at 1.04x ask); no bid-war play.

## 3. Direct measurements: skilled vs control (paired)

**Why seasons 1-3 are primary.** The hot-seat rule cannot fire a GM before season 4. From season 4 on, a seat-season is dropped once the seat's GM changed in **either** arm (skilled seat fired; or the control run's CPU GM on that team replaced, tracked per season as `seatGm`). Over 10 seasons 39 of 80 skilled seats, 39 of 80 control seats and all 80 idle seats were fired at some point (earliest: season 4 in every arm). The surviving later seasons are a selected set and the denominators fall with tenure. Seasons 1-3 have **no censoring**: 120 seat-seasons per talent setting (10 leagues x 4 seats x 3 seasons), the same GM in both arms. Interval = 95% percentile bootstrap resampling whole leagues; t-intervals over league means and a team-cluster bootstrap are in `data/tables_PRIMARY_seasons1-3_skilled_vs_control.md` and agree. With only 10 leagues the intervals are approximate.

### 3a. PRIMARY: seasons 1-3, skilled - control (n = 120 seat-seasons, 10 leagues, per talent)
| outcome | talent 1.0 | talent 1.5 |
|---|---|---|
| regular-season wins (control 8.40 / 8.30) | **+1.11 [+0.35, +1.94]** | **+1.85 [+1.36, +2.30]** |
| made playoffs (control 0.425 / 0.417) | +0.150 [+0.058, +0.233] | +0.225 [+0.158, +0.292] |
| playoff depth 0-4 | +0.51 [+0.30, +0.72] | +0.78 [+0.57, +0.98] |
| won the Super Bowl, per seat-season (control 0.025 / 0.025) | +0.042 [+0.008, +0.083] | **+0.100 [+0.067, +0.133]** |
| roster strength: unit score at season start | +3.20 [+2.35, +4.11] | +2.68 [+1.75, +3.60] |
| team rating at season start | +1.41 [+1.12, +1.68] | +1.30 [+1.09, +1.57] |
| starting QB overall | -0.56 [-1.23, +0.05] | -0.67 [-1.73, +0.31] |
| cap space at the playoffs ($M) | +20.3 [+16.4, +24.3] | +21.1 [+17.6, +24.7] |
| dead money ($M) | -1.80 [-3.05, -0.60] | -1.34 [-2.30, -0.50] |
| next-year commitments / cap | +0.119 [+0.092, +0.142] | +0.109 [+0.091, +0.127] |
| mean age of top 24 | +0.33 [+0.18, +0.46] | +0.34 [+0.20, +0.47] |
| players on roster at the playoffs | -2.52 [-2.92, -2.08] | -2.46 [-2.77, -2.17] |

**Titles in seasons 1-3.** Skilled seats won 8 titles (talent 1.0) and 15 (talent 1.5) in 120 seat-seasons (6.7% [2.5, 11.7] and 12.5% [8.3, 17.5]); the same seats under control won 3 and 3 (2.5%). Over the 30 league-seasons that is 8 and 15 of the 30 league titles taken by the four skilled seats: **27% [10, 47] and 50% [33, 70]** (parity for four of 32 teams is 12.5%). At the new-league default the early-tenure title share **reaches the TAFI "more than 50% of titles" line at its point estimate**, with an interval of 33-70% and 30 league-seasons behind it; at 1.0 it is well under. (An earlier draft said the threshold was "not approached"; that rested on the diluted full-horizon figure.)

**Fallback-exclusion sensitivity, beside the primary (seasons 1-3, skilled - control).** The two leagues dropped are those in which the restructure fallback ran (skilled seeds 9602 and 9604, both talent 1.0; section 4). Talent 1.5 has no such league, so its column is the primary unchanged.
| outcome | talent 1.0 primary (10 leagues, n=120) | talent 1.0 without 9602, 9604 (8 leagues, n=96) | talent 1.5 (no change, n=120) |
|---|---|---|---|
| regular-season wins | **+1.11 [+0.35, +1.94]** | **+0.72 [-0.03, +1.49]** | +1.85 [+1.36, +2.30] |
| made playoffs | +0.150 [+0.058, +0.233] | +0.135 [+0.021, +0.250] | +0.225 [+0.158, +0.292] |
| playoff depth 0-4 | +0.51 [+0.30, +0.72] | +0.40 [+0.20, +0.59] | +0.78 [+0.57, +0.98] |
| Super Bowl per seat-season | +0.042 [+0.008, +0.083] | +0.031 [0.000, +0.073] | +0.100 [+0.067, +0.133] |
| unit score at season start | +3.20 [+2.35, +4.11] | +2.62 [+1.99, +3.19] | +2.68 [+1.75, +3.60] |
| cap space at the playoffs ($M) | +20.3 [+16.4, +24.3] | +20.0 [+15.2, +24.7] | +21.1 [+17.6, +24.7] |
The talent-1.0 wins effect falls by about a third and its interval now touches zero; playoffs, depth, unit score and cap space keep their sign and interval. So the talent-1.0 wins headline is not robust to those two leagues; the talent-1.5 headlines do not depend on the fallback (`data/tables_sensitivity_*`).

### 3b. Full horizon (secondary; survivor-selected after season 3)
Skilled - control over every usable seat-season. Denominators: **talent 1.0: 270 of 400 seat-seasons (130 dropped), 10 leagues; talent 1.5: 256 of 400 (144 dropped), 10 leagues.** Dropped = the seat's GM was replaced earlier in either arm. Seasons used by index: 120 (1-3), then 150 / 136 over seasons 4-10.
| outcome | talent 1.0 (n=270) | talent 1.5 (n=256) |
|---|---|---|
| regular-season wins | +0.48 [-0.24, +1.25] | +1.27 [+0.43, +2.16] |
| made playoffs | +0.059 [-0.015, +0.143] | +0.160 [+0.034, +0.275] |
| won the Super Bowl per seat-season (control 0.026 / 0.027) | +0.030 [-0.004, +0.060] | +0.066 [+0.035, +0.103] |
| unit score at season start | +5.07 [+3.71, +6.46] | +4.70 [+3.60, +5.97] |
| cap space ($M) / dead money ($M) | +8.4 / -3.0 | +11.4 / -2.6 |
| next-year commitments / cap; age of top 24; roster size | +0.243; +0.94 y; -1.58 | +0.221; +0.72 y; -1.62 |
By tenure (wins): talent 1.0 seasons 4-6 -0.49 [-1.60, +0.56] (n=88), 7-10 +0.65 [-1.11, +2.24] (n=62); talent 1.5 seasons 4-6 +0.92 [-0.90, +2.71] (n=79), 7-10 +0.54 [-1.24, +2.31] (n=57). The unit-score advantage grows with tenure (+6 to +7 by season 4-10) while the wins advantage does not clearly: the later bins are survivor-selected and imprecise, so no conclusion about long-run dominance is drawn. Excluding the fallback leagues at 1.0: full-horizon wins -0.01 [-0.49, +0.52] (n=203, 8 leagues).

### 3c. Which title figures count outcomes after a GM was fired
| figure | counts post-firing seasons? |
|---|---|
| Titles per seat-season in 3a ("per usable seat-season") | No. Only seat-seasons where the same GM ran the team in both arms. |
| "Share of the league's titles taken by the 4 seats" in 3a (8/30, 15/30; control 3/30 each) | No firing is possible before season 4, so no. |
| "Title share of the 4 seats" in the full-horizon table file (skilled 18/100 league-seasons at 1.0, 27/100 at 1.5; control 10/100 and 13/100) | **Yes.** It counts a team's title whatever GM ran it, over all 100 league-seasons. This figure is not a clean estimate: it mixes live and fired seats and must not be compared with the 12.5% parity line. Skilled and control are both computed this way, so their ratio is comparable, their level is not. Idle's equivalent counts post-firing titles too (all idle seats are fired by season 8). |
| Per usable seat-season, full horizon (3b) | No: 15/270 = 5.6% [2.4, 8.5] (1.0) and 24/256 = 9.4% [6.0, 13.4] (1.5), vs control 7/270 = 2.6% and 7/256 = 2.7%; the same seat-seasons in both arms. |
| League-seasons in which all four seats were still held (full horizon) | 10 seat titles in 37 league-seasons (1.0) and 17 in 35 (1.5; 49%). Selected on survival; not a clean estimate. |
Seat title streaks: in seasons 1-3 the longest is 2 and there is 1 back-to-back occurrence at both talents; over the full horizon the longest is 3 (1.5) and 2 (1.0), with 3 and 2 back-to-back occurrences (full-horizon counts include seasons after a firing).

**Spillover.** CPU (non-seat) teams' start-of-season unit score is higher in the skilled arm: in seasons 1-3 by +1.25 [0.79, 1.70] (1.0) and +1.19 [0.69, 1.70] (1.5); over the full horizon by +3.2 [2.5, 4.0] and +2.9 [2.1, 3.6]. The full-horizon figure includes seasons after seat GMs were fired, so only the seasons 1-3 figure is an early-tenure effect. Why it arises is not established here.
**Idle seats** (the seat does only what the production autopilot does; `data/tables_idle_vs_control_seasons1-3.md`): seasons 1-3 wins -1.23 [-1.60, -0.81] (1.0) and -0.98 [-1.16, -0.80] (1.5) vs control, with about +44 M unspent cap space; they lose players they do not re-sign. Skilled vs idle, seasons 1-3: +2.35 [+1.64, +3.04] and +2.83 [+2.27, +3.31] wins; titles 8/120 vs 4/120 (1.0) and 15/120 vs 0/120 (1.5). All idle seats were fired by season 8, so their later seasons are not usable.

## 4. The runs that used the restructure fallback, and the exclusion check
- In the regenerated data the fallback executed in **two** skilled runs, both at talent 1.0: **seed 9602, PIT** (`cap.restructure` 1, `cap.cuts` 26) and **seed 9604, CAR** (`cap.restructure` 2, `cap.cuts` 13). It ran 3 times in all across the 20 final skilled runs (217 cap cuts). `skilled s9608 t1.5`, the run that needed the fallback under the previous policy, no longer needs it (no restructure; DAL stays legal after cuts and the staff fix): the policy changed (section 6 of `RUN_ACCOUNTING.md`) and so did the path.
- **Illegal roster recorded: none.** `cap.stuckReconcile` is absent (0) in every run, so no roster stayed illegal after the fallback; no run aborted in the regenerated set (76 of 76 completed, 0 failed).
- Exclusion check: section 3a and `data/tables_sensitivity_seasons1-3_drop_fallback_leagues.md` / `..._full_...`. Talent 1.5 is unaffected. At talent 1.0 wins go from +1.11 to +0.72 [-0.03, +1.49] in seasons 1-3, so that headline depends on these two matched leagues (see 3a).
- **Why the fallback runs changed.** The fallback only fires when a roster is still over the cap after value-aware cuts and the staff fix, so it is a tail event of each seat's cap path. The regenerated skilled policy differs from the one that needed it (it runs against a view without `potential`, so free-agency, trade and re-signing valuations that used it changed, and the per-season draft counters were fixed), and a run's random streams diverge from the first decision. Different valuations give different contracts and cap paths, so the over-cap tail landed on different leagues (one run before, two now). I did not isolate which change moved which league, and three events in 20 runs cannot support a causal story; the sensitivity check, not an explanation, is what protects the headline.
- **Driver version and snapshot timing.** All 96 retained runs were produced by one driver, `harness/driver.ts` sha256 `23a9076f7f6925fc7790b29eeb550f1bb5ba916fbf8c1dbd8b8a4282d6043ed2`; every run file post-dates that file (checked by modification time) and nothing from earlier batches is retained. "Start of season" strength is captured at the last pre-season stage (`preseason` / `leagueDevelopments`), before the opening nine-week block is simulated, because that block applies injuries and strength excludes injured players. Against the previous capture, all season results (wins, losses, points, playoff rounds, champions, end-of-season strength) are identical in all 96 runs; only the start-of-season strengths changed (15,579 team-seasons).
- Controls: the new control runs reproduce the old control runs' rows exactly for seasons 1-3 (20 of 20 files, season rows compared with the new `seatGm` field removed); only per-season GM tracking was added.

## 5. Explanation (not direct measurement of the full policy): which decisions drove it
Ablation arms: 6 leagues x 8 seasons at talent 1.5, a module subset on and everything else at the idle behaviour, compared with the **idle** arm (`data/tables_ablations_vs_idle_*.md`). Small samples; modules interact, so the parts need not add up; the full policy was not run with one module off at full length against control. **Seasons 1-3** (n = 72 seat-seasons, 6 leagues each), wins vs idle (7.29):
| modules on | wins vs idle | titles/seat-season | unit score | cap space |
|---|---|---|---|---|
| trades only | **+1.34 [+0.41, +2.30]** | +0.028 | +1.5 [+0.5, +2.5] | -9 M |
| free agency only | +0.39 [+0.24, +0.58] | +0.014 | +1.4 [+0.8, +2.0] | -8 M |
| contracts + cap only | +0.31 [-0.26, +0.83] | +0.014 | +1.0 [+0.5, +1.5] | -9 M |
| draft only | +0.36 [+0.01, +0.69] | 0.000 | -0.1 | +0 |
| lineup + plan + camp + coaching | -0.23 [-0.63, +0.14] | +0.014 | -0.3 | +0 |
| all except trades | +0.48 [+0.10, +0.93] | 0.000 | +1.7 [+1.4, +2.0] | -12 M |
Over the longer ablation horizon (up to 6 seasons usable) the picture shifts toward free agency and re-signing: free agency only +0.92 [+0.55, +1.25], contracts + cap +0.98 [+0.26, +1.83], trades +1.19 [+0.29, +2.16], all except trades +1.42 [+0.79, +1.96], with unit-score gains of +3.0 to +4.2 for those modules and much lower cap space. Reading: early on trades carry most of the edge over a neglected seat, with free agency, re-signing and cap management adding roster strength; later, spending and re-signing matter more as cap is used. Draft, lineup, plan, camp and coaching modules show little or no detectable effect (draft only +0.36 early, near zero later). The policy sells quarterbacks for higher-weighted unit players (QB overall -0.6 early), runs older (+0.3 y early, +0.7 to +0.9 y later) and more committed (+0.11 early, +0.22 to +0.24 later in next-year cap) rosters with 2-3 fewer bodies: the edge is partly bought with future flexibility. This is a description of behaviour, not a causal claim.

## 6. What this does and does not say
- At the new-league default (1.5) the scripted skilled GM beats the CPU default by about 1.9 wins in the first three seasons (+1.3 over the survivor-selected full horizon), reaches the playoffs about 22 points more often, and wins the Super Bowl 10 points more often per seat-season (5x control). At 1.0 the gains are about 1.1 wins (+0.7 without the two fallback leagues, interval touching zero) and 4 points of title rate.
- **Dominance:** the four skilled seats took 15 of 30 league titles in seasons 1-3 at 1.5 (50%, interval 33-70%), which is on the TAFI threshold, not under it. That is early tenure with 10 leagues behind it. Over the full horizon the per-usable-seat-season rate is 9.4% (about 38% of titles for four live seats), and the later-season wins effect is imprecise. Whether this is "too much" remains a design call.
- Not shown: whether any production constant should change. The experiment does not isolate QB price or plan values.
- Information rule, tested twice: a text guard (`info-guard.test.ts`) and a behavioural test that the policy's decisions are unchanged when `potential` and prospects' `trueOverall` are perturbed. All policy calls run in a client-equivalent view that withholds both (a hidden-`potential` read in the first version was found in review and removed; the skilled and ablation arms were regenerated).
- Limits: one scripted policy and one skill level; seats interact only through CPU partners; 10 leagues is few for title rates (and 30 league-seasons in the primary window); the later seasons are survivor-selected; fictional-DNA leagues; the first rollover applies a year of aging before play; the game-plan lever is essentially untested; ablations are 6 leagues and the baseline is the idle seat; the "unit score" is the repo's own measured-weight model, not an independent measure of strength (wins and titles are); no fun/readability measure. Also not exercised: Hooded Figure, practice-squad moves, cross-position depth slots, post-draft coaching changes, multiplayer, UI discoverability.
- Policy history: see `RUN_ACCOUNTING.md`. The data in this folder are the regeneration after the review fixes; older batches are superseded and not used.

## 7. Cost
Final data set: 96 league-runs (control 20, skilled 20, idle 20, ablations 36), 888 league-seasons, 3,552 seat-season rows, all produced by one driver version; plus the separate 12-run pilot (first-policy; not pooled). All 96 were regenerated in the last round. Per-10-season run time: about 263 s (control), 347 s (skilled), 270 s (idle); ablations 8 seasons, 2.45 h in total. CPU time for the 96 runs about 7.4 h on 4 parallel workers; the last regeneration was interrupted by worker restarts and resumed, so its wall time is not meaningful.
