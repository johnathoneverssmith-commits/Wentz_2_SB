# COMP-006: does a scripted skilled GM dominate the default CPU GM?

Analysis only. **Primary comparison: seasons 1-3** (see section 3). Run accounting: `RUN_ACCOUNTING.md`. No production gameplay, rating, pool, schema, cap or balance constant was changed. Harness: `analysis/comp006/`
(README there). Raw per-run JSON (~15 MB) is regenerable (runs are deterministic) and is not committed; the committed data are
`data/*.csv` (seat-seasons, league-seasons, run metadata) and `data/tables_*.md`.

## 1. Pinned setup
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
Reads only: player table (overall, age, contract, injury), the public draft board (`collegeOverall`, `expectedRatings`), all rosters/caps/standings, market asking prices, and `judgeTrade` (the trade screen's own read). It knows the measured unit weights in `unitValue.ts` (published in-repo; knowledge, not hidden state). `info-guard.test.ts` fails if the policy touches `potential`, a prospect's `trueOverall`, CPU GM strategy/skill/difficulty, RNG, unwatched results (`state.games/history`), or the CPU's own decision procedures. Passes (7/7).

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

**Why seasons 1-3 are primary.** The hot-seat rule cannot fire a GM before season 4. From season 4 on, 37 of 80 skilled seats and all 80 idle seats were fired at some point (earliest: season 4). A fired seat's team is then run by someone else, so those seat-seasons are dropped. The surviving later seasons are therefore a selected set (GMs who kept their job), and the denominators fall with tenure. Seasons 1-3 have **no censoring**: 120 seat-seasons per talent setting (10 leagues x 4 seats x 3 seasons), every one with the same GM in both arms. Interval = 95% percentile bootstrap resampling whole leagues; t-intervals over league means and a team-cluster bootstrap are in `data/tables_PRIMARY_seasons1-3_skilled_vs_control.md` and agree. With only 10 leagues the intervals are approximate.

### 3a. PRIMARY: seasons 1-3, skilled - control (n = 120 seat-seasons, 10 leagues, per talent)
| outcome | talent 1.0 | talent 1.5 |
|---|---|---|
| regular-season wins (control 8.40 / 8.30) | **+1.24 [+0.72, +1.89]** | **+1.92 [+1.48, +2.33]** |
| made playoffs (control 0.425 / 0.417) | +0.158 [+0.092, +0.233] | +0.233 [+0.167, +0.308] |
| playoff depth 0-4 | +0.56 [+0.34, +0.78] | +0.73 [+0.53, +0.94] |
| won the Super Bowl, per seat-season (control 0.025 / 0.025) | +0.033 [+0.000, +0.067] | **+0.100 [+0.033, +0.167]** |
| roster strength: unit score at season start | +2.34 [+1.65, +3.06] | +2.29 [+1.42, +3.17] |
| team rating at season start | +1.23 [+0.95, +1.48] | +1.24 [+1.04, +1.49] |
| starting QB overall | -0.34 [-1.15, +0.48] | -0.79 [-1.80, +0.06] |
| cap space at the playoffs ($M) | +20.5 [+16.2, +24.9] | +21.3 [+17.4, +25.3] |
| dead money ($M) | -1.98 [-3.31, -0.70] | -1.24 [-2.11, -0.50] |
| next-year commitments / cap | +0.115 [+0.082, +0.146] | +0.096 [+0.073, +0.120] |
| mean age of top 24 | +0.34 [+0.21, +0.47] | +0.33 [+0.19, +0.47] |
| players on roster at the playoffs | -2.50 [-2.92, -2.08] | -2.44 [-2.67, -2.19] |

**Titles in seasons 1-3.** Skilled seats won 7 titles (talent 1.0) and 15 (talent 1.5) in 120 seat-seasons (5.8% [2.5, 9.2] and 12.5% [7.5, 17.5]); the same seats under control won 3 and 3 (2.5%). Over the 30 league-seasons that is 7 and 15 of the 30 league titles taken by the four skilled seats: **23% [10, 37] and 50% [30, 70]** (parity for four of 32 teams is 12.5%). So at the new-league default the early-tenure title share **reaches the TAFI "more than 50% of titles" line at its point estimate**, with an interval that spans 30-70% and 30 league-seasons behind it. This corrects the earlier draft of this report, which said the threshold was "not approached"; that statement rested on the full-horizon figure below, which dilutes the early advantage.

Sensitivity: dropping the one matched league that used the restructure fallback (seed 9608, talent 1.5) changes talent-1.5 wins from +1.92 to +1.86 [+1.40, +2.32], titles per seat-season from +0.100 to +0.102 [+0.028, +0.176], and the title count to 13 in 27 league-seasons (12.0% of seat-seasons; 48% share). Dropping seed 9608 at both talents: 1.0 wins +1.13 [+0.60, +1.81], 1.5 wins +1.86. No headline sign or interval changes (section 4, `data/tables_sensitivity_*`).

### 3b. Full horizon (secondary; survivor-selected after season 3)
Skilled - control over every usable seat-season. Denominators: **talent 1.0: 334 of 400 seat-seasons (66 dropped), 10 leagues; talent 1.5: 322 of 400 (78 dropped), 10 leagues.** Dropped = the seat's GM was fired earlier (in either arm). Seasons used by index: 120 (1-3), then 214 / 202 over seasons 4-10.
| outcome | talent 1.0 (n=334) | talent 1.5 (n=322) |
|---|---|---|
| regular-season wins | +0.72 [-0.05, +1.41] | +1.49 [+0.62, +2.41] |
| made playoffs | +0.090 [-0.031, +0.190] | +0.149 [+0.050, +0.239] |
| won the Super Bowl per seat-season (control 0.030 / 0.028) | +0.033 [+0.006, +0.059] | +0.071 [+0.032, +0.109] |
| unit score at season start | +3.62 [+2.70, +4.50] | +4.64 [+3.45, +5.77] |
| cap space ($M) / dead money ($M) | +7.5 / -3.6 | +7.5 / -3.1 |
| next-year commitments / cap; age of top 24; roster size | +0.252; +0.81 y; -1.45 | +0.244; +0.81 y; -1.49 |
Excluding (9608, 1.5): talent-1.5 wins +1.50 [+0.48, +2.50] (n = 284, 9 leagues), titles +0.074 [+0.029, +0.115], unit score +4.68. By tenure at 1.5 (wins): season 1 +2.20, seasons 2-3 +1.77, seasons 4-6 +0.69 [-0.97, +2.34], seasons 7-10 +1.80 [+0.27, +3.09]; the later bins rest on 103 and 99 selected seat-seasons.

### 3c. Which title figures count outcomes after a GM was fired
| figure | counts post-firing seasons? |
|---|---|
| Titles per seat-season in 3a ("per usable seat-season") | No. Only seat-seasons where the same GM ran the team in both arms. |
| "Share of the league's titles taken by the 4 seats" in 3a (7/30, 15/30) | No firing is possible yet, so no. |
| Full-horizon "share of titles" in the earlier draft (skilled 21 in 100 league-seasons at 1.0, 32 at 1.5; control 10, 13) | It counted a team's title whatever GM ran it and divided by all 100 league-seasons, including seasons when fewer than four seats were still held. For the skilled arm the numerator is identical to the usable count (21 and 32 titles, all won while the original GM held the seat), so nothing is contaminated there; but the 100-season denominator treats a league with 2 live seats like one with 4, so 21% / 32% **understate** the live-seat share and must not be compared with the 12.5% parity line. Idle: 12 and 6 titles counted vs 4 and 0 usable, i.e. idle's headline share did include post-firing titles. |
| Per usable seat-season, full horizon (3b) | No: 21/334 = 6.3% [4.0, 8.3] (1.0) and 32/322 = 9.9% [6.1, 13.4] (1.5), vs control 2.5% and 3.3% (400 each). |
| League-seasons in which all four seats were still held (full horizon) | 16 seat titles in 59 league-seasons (1.0) and 26 in 51 (1.5; 51%). Selected on survival, so also not a clean estimate. |
Longest seat title streak 3 (1.5) and 2 (1.0); back-to-back occurrences 6 and 3 (full horizon).

**Spillover.** CPU (non-seat) teams' start-of-season unit score is +3.1 [2.4, 3.8] higher in the skilled arm at both talents (full horizon). Why is not established here.
**Idle seats** (the seat does only what the production autopilot does; `data/tables_idle_vs_control_seasons1-3.md`): seasons 1-3 wins -1.23 [-1.60, -0.81] (1.0) and -0.98 [-1.16, -0.80] (1.5) vs control, with ~+45 M unspent cap space; they lose players they do not re-sign. Skilled vs idle, seasons 1-3: +2.48 [+1.97, +2.93] and +2.90 [+2.35, +3.44] wins. Idle seats were all fired by season 8, so their later seasons are not usable.

## 4. The run that used the restructure fallback, and the exclusion check
- Run: **skilled, seed 9608, talent 1.5** (seats ARI, DAL, LAC, NYJ). In batch 2 it aborted when DAL was $2.0M over the cap at the offseason free-agency summary after cuts and the staff fix (that aborted run's ledger was not saved). It was re-run with the fallback. In the re-run, DAL's ledger shows `cap.cuts 12`, `cap.restructure 1`, `cap.staffFix 10`, **`cap.stuckReconcile` absent (0)**.
- **Illegal roster recorded: none.** The fallback ran once in all 20 final skilled runs (175 cap cuts in total); after the single restructure the roster was legal and the run did not continue past an illegal state. A roster that stays illegal would have been counted in `cap.stuckReconcile`; the total over the final skilled runs is 0.
- Matched league excluded (effect on headlines): see 3a and 3b. Changes are small (wins -0.06 in seasons 1-3, +0.01 full horizon at 1.5) and no interval moves across zero.
- Earlier-batch runs vs the final code: skilled and control, seeds 9601 and 9605 at 1.5, 10 seasons re-run with the PR head: identical rows, ledgers and fingerprints.

## 5. Explanation (not direct measurement of the full policy): which decisions drove it
Ablation arms: 6 leagues x 8 seasons at talent 1.5, a module subset on and everything else at the idle behaviour, compared with the **idle** arm (`data/tables_ablations_vs_idle_*.md`). Small samples; modules interact, so the parts need not add up; the full policy was not run with one module off at full length against control. **Seasons 1-3** (n = 72 seat-seasons, 6 leagues each), wins vs idle (7.29):
| modules on | wins vs idle | titles/seat-season | unit score | cap space |
|---|---|---|---|---|
| trades only | **+1.50 [+0.54, +2.34]** | +0.083 [+0.042, +0.125] | +1.4 [+0.4, +2.3] | -7 M |
| free agency only | +0.39 [+0.24, +0.58] | +0.014 | +1.0 [+0.6, +1.6] | -8 M |
| contracts + cap only | +0.31 [-0.26, +0.83] | +0.014 | +1.0 [+0.6, +1.4] | -9 M |
| draft only | +0.26 [-0.16, +0.69] | 0.000 | +0.0 | +0 |
| lineup + plan + camp + coaching | -0.29 [-0.87, +0.27] | +0.014 | -0.4 | +0 |
| all except trades | +1.03 [+0.56, +1.47] | 0.000 | +1.4 [+0.4, +2.3] | -14 M |
Over the longer ablation horizon (up to 6 seasons usable) the picture shifts toward free agency and re-signing (free agency only +0.92 wins, contracts + cap +0.98, trades +1.18; all except trades +2.06). Reading: early on trades carry most of the edge over a neglected seat, with free agency, re-signing and cap management adding roster strength; later, spending and re-signing matter more as cap is used. The draft, lineup, plan, camp and coaching modules showed no detectable effect. The policy sells quarterbacks for higher-weighted unit players (QB overall -0.3 to -0.8 early), runs older (+0.3 y early, +0.8 y later) and more committed (+0.10 early, +0.25 later in next-year cap) rosters with 2-3 fewer bodies: the edge is partly bought with future flexibility. This is a description of behaviour, not a causal claim.

## 6. What this does and does not say
- At the new-league default (1.5) the scripted skilled GM beats the CPU default by about 1.9 wins in the first three seasons (+1.5 over the survivor-selected full horizon), reaches the playoffs about 23 points more often, and wins the Super Bowl 10 points more often per seat-season (4x control). At 1.0 the gains are about 1.2 wins and 3 points of title rate (the title interval touches zero).
- **Dominance:** the four skilled seats took 15 of 30 league titles in seasons 1-3 at 1.5 (50%, interval 30-70%), which is on the TAFI threshold, not under it. That is early tenure with 10 leagues behind it. Over the full horizon the per-live-seat rate is 9.9% per seat-season (about 40% of titles for four live seats). Whether this is "too much" remains a design call; it is the number the review should decide on.
- Not shown: whether any production constant should change. The experiment does not isolate QB price or plan values.
- Limits: one scripted policy and one skill level; seats interact only through CPU partners; 10 leagues is few for title rates (and 30 league-seasons in the primary window); the later seasons are survivor-selected; fictional-DNA leagues; the first rollover applies a year of aging before play; the game-plan lever is essentially untested; ablations are 6 leagues and the baseline is the idle seat; the "unit score" is the repo's own measured-weight model, not an independent measure of strength (wins and titles are); no fun/readability measure. Also not exercised: Hooded Figure, practice-squad moves, cross-position depth slots, post-draft coaching changes, multiplayer, UI discoverability.
- Policy history: see `RUN_ACCOUNTING.md` (4 completed + 16 aborted first-policy skilled runs discarded; 20 controls reused; 20 skilled re-run, 1 of them twice).

## 7. Cost
Final data set: 96 league-runs (control 20, skilled 20, idle 20, ablations 36), 888 league-seasons, 3,552 seat-season rows; plus the separate 12-run pilot. Attempted in the main study: 117 league-runs (21 discarded or aborted). CPU time for the 96 final runs 6.8 h; about 244 s (control), 310 s (skilled), 270 s (idle) per 10-season run on 4 parallel workers; wall time about 45 min for batch 1, 26 min for the skilled re-run, 72 min for batch 3 (idle + ablations + the 9608 re-run), on a 4-core machine; plus a 10-minute determinism check.
