# COMP-006: does a scripted skilled GM dominate the default CPU GM?

Analysis only. No production gameplay, rating, pool, schema, cap or balance constant was changed. Harness: `analysis/comp006/`
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
10 leagues x up to 10 seasons x 4 seats. Interval = 95% percentile bootstrap resampling whole leagues (headline); t over league means and a team-cluster bootstrap are in `data/tables_skilled_vs_control.md` and agree.
**Censoring:** the hot-seat rule fires GMs (from season 4). 37 of 80 skilled seats and all 80 idle seats were fired at some point, after which the team is run by someone else, so those seat-seasons are dropped (n below). Later-season rows are therefore survivor-biased toward GMs who kept their job; **seasons 1-3 are uncensored** and are the cleanest.

| outcome (paired diff, skilled - control) | talent 1.0 | talent 1.5 |
|---|---|---|
| seat-seasons / leagues | 334 / 10 | 322 / 10 |
| regular-season wins | +0.72 [-0.05, +1.41] | **+1.49 [+0.62, +2.41]** |
| made playoffs | +0.090 [-0.031, +0.190] | **+0.149 [+0.050, +0.239]** |
| playoff depth (0-4) | +0.33 [+0.08, +0.54] | +0.49 [+0.20, +0.78] |
| won the Super Bowl (per seat-season; control 0.030 / 0.028) | +0.033 [+0.006, +0.059] | **+0.071 [+0.032, +0.109]** |
| unit score, start of season (roster strength as the engine reads it) | +3.62 [+2.70, +4.50] | +4.64 [+3.45, +5.77] |
| team rating, start of season | +1.44 [+1.05, +1.82] | +1.89 [+1.49, +2.29] |
| starting QB overall | -0.81 [-2.76, +0.92] | -0.21 [-0.63, +0.19] |
| cap space at the playoffs ($M) | +7.5 [+4.3, +10.9] | +7.5 [+4.7, +10.5] |
| dead money ($M) | -3.6 [-5.8, -1.9] | -3.1 [-4.6, -1.5] |
| next-year commitments / cap | +0.252 [+0.231, +0.271] | +0.244 [+0.227, +0.259] |
| mean age of top 24 | +0.81 [+0.70, +0.95] | +0.81 [+0.67, +0.94] |
| players on roster at the playoffs | -1.45 [-1.65, -1.26] | -1.49 [-1.61, -1.33] |

By tenure at talent 1.5 (wins): season 1 **+2.20** [1.57, 2.79]; seasons 2-3 **+1.77** [1.01, 2.55]; seasons 4-6 +0.69 [-0.97, 2.34]; seasons 7-10 +1.80 [0.27, 3.09]. At 1.0: +1.29, +1.22, +0.00, +0.87. Cap space is +30 M in seasons 2-3 and about 0 to -3 M later (spent). Pilot (3 leagues x 3 seasons, `tables_pilot_3x3.md`) pointed the same way (+0.8/+0.9 wins) with wide intervals.

**Titles.** Skilled seats won 21 titles in 100 league-seasons at 1.0 and 32 at 1.5, against 10 and 13 for the same seats under control (parity for four of 32 teams is 12.5 per 100). Share of all titles won by the 4 seats: 21% [12, 29] and 32% [19, 45] (this count includes seasons after a seat's GM was fired, so it is slightly contaminated; per uncensored seat-season the rate is 6.3% / 9.9% vs 2.5% / 3.3% control). Longest streak 2 (1.0) and 3 (1.5); back-to-back occurrences 3 and 6. The TAFI regression threshold ("fail if a scripted human wins >50% of titles over 100 team-seasons") is **not reached** (point estimates 21-32% with the 4 seats; upper bounds 29% / 45%).
**Spillover.** CPU teams' start-of-season unit score is +3.1 higher when seats are skilled ([2.4, 3.8] at both settings), i.e. the skilled seats' gain is not at the expense of the CPU teams' unit score on this measure. Why is not established here (the likely candidates are the CPU teams' trades and the skilled seats' market activity shifting who is on which roster).
**Idle seats** (`tables_idle_vs_control.md`; all fired by season 8, so only the early seasons pair): -2.8 wins at 1.0 and -2.3 at 1.5 versus control (cap space +85 M unspent; they do not re-sign players); title rate no better than control. Skilled vs idle: +3.8 and +4.3 wins. Being skilled matters; the CPU default is itself far better than a neglected seat.

## 4. Explanation (not direct measurement of the full policy): which decisions drove it
Ablation arms: 6 leagues x 8 seasons at talent 1.5, a module subset on, everything else at the idle behaviour, compared with the **idle** arm (`tables_ablations_vs_idle.md`). Small samples (about 100 seat-seasons each; many wins intervals span 1+ win), and modules interact, so shares need not add up. Wins vs idle (idle = 6.0):
| modules on | wins vs idle | unit score vs idle | cap space vs idle |
|---|---|---|---|
| trades only | +1.18 [+0.31, +2.22] | +0.9 [-0.4, +2.5] | -20 M |
| free agency only | +0.92 [+0.55, +1.25] | +2.7 [+2.2, +3.3] | -29 M |
| contracts + cap only | +0.98 [+0.26, +1.83] | +3.3 [+2.4, +4.0] | -34 M |
| draft only | +0.11 [-0.47, +0.65] | -0.1 | +0 |
| lineup + plan + camp + coaching | -0.29 [-0.81, +0.22] | -0.2 | -0 |
| everything except trades | +2.06 [+1.57, +2.54] | +4.5 [+3.2, +5.7] | -50 M |
Reading: re-signing and spending cap (contracts, free agency) account for most of the roster-strength and win gain over a neglected seat; trades add a smaller win gain and, alone, a title bump (+0.06/seat-season, n small); the draft, lineup, plan, camp and coaching modules showed **no detectable effect** here (draft: the CPU's board is already what the screen shows, matching #105 X2). Because the CPU control already re-signs and spends, the full policy's edge over **control** (section 3) is the part not available to a neglectful seat; ablations against control (not the idle baseline) are in the data folder only as raw tables and are confounded by the idle penalty, so they are not used for conclusions. "Everything except trades" was not compared to control with the same seats at full length; do not read the table as "trades don't matter".
The policy sells quarterbacks for higher-weighted unit players more than control does (QB overall -0.8 at 1.0, ~0 at 1.5) and runs older (+0.8 years), more committed (+25 points of next-year cap) rosters, with fewer bodies (-1.5): the edge is bought with future flexibility. That is a description of what the policy did, not a causal claim.

## 5. What this does and does not say
- At the new-league default (1.5) the scripted skilled GM beats the CPU default by about 1.5 wins and 7 points of title probability per season, tripling the title rate; at 1.0 about half the win gain and a doubling of the title rate. It does **not** dominate: roughly 1 in 10 seat-seasons yields a title and the 50%-share threshold is not approached. Whether +1.5 wins a season is "too much" is a design judgement, not settled here.
- The effect shows up in the first season (+2.2 wins at 1.5), mostly before cap space is spent, then persists while strength is +4-6 units above control.
- Not shown: any change to production constants is warranted, or not. This experiment does not support tuning QB price or plan values on its own; it does show the trade, free-agency and re-signing levers move roster strength.
- Limits: one scripted policy (one skill level, one set of heuristics, no learning); 4 seats per league interact only through CPU partners; 10 leagues is few for title rates (intervals are wide); survivor bias after season 3 (hot seat); fictional-DNA leagues; the first rollover applies a year of aging before play; the game-plan lever is essentially untested; no fun/readability measure.
- Policy history (disclosed): the first skilled batch aborted 16 of 20 runs because the policy let itself end over the cap with no legal cut; the 24 completed runs from that policy were discarded and all skilled runs redone after adding value-aware cap cuts, a cap-feasibility check on trades and a max-contract clamp. One later run stuck on the same issue; a restructure fallback was added (it only executes on the path that previously aborted, so the other runs are unchanged) and that run was redone.

## 6. Cost
Completed: control 20 runs (10 leagues x 2 talents x 10 seasons), skilled 20, idle 20 (10 seasons; seats fired from season 4), ablations 36 (8 seasons) = 96 league-runs in the final data set (plus a separate 12-run, 3-season pilot), 888 league-seasons, 3,552 seat-season rows. CPU time 6.8 h in total; about 244 s (control), 310 s (skilled), 270 s (idle) per 10-season run on 4 parallel workers; wall time about 45 min for the first batch, 26 min for the skilled rerun, 72 min for idle + ablations, on a 4-core machine.
