# Strategic-depth TAFI register (ids `STRAT-nnn`)

Baseline `master` @ `d0727ff`. All entries are **New** (intake only). Evidence and seeds: [REPORT.md](REPORT.md), [README.md](README.md), `data/`.
Grounding vocabulary follows `SUBMISSION-FORMAT.md`: controlled-sim, code-inspected, test-reproduced. **Sim path** is stated for each (issue #74).
Priorities are this report's proposal, not owner-approved. Nothing here is implemented.

## Deduplication against the central register
| New id | Relationship to existing | Decision |
|---|---|---|
| STRAT-001 | Quantifies the *strategic* cost of **GAP-001/002/004/005** and issue #74 (they cover wrong scores/stat lines and silent fallback) | **New**, cross-linked; does not replace them |
| STRAT-002 | Extends **Oct-2026 audit "unresolved: late-season dump probe"** and relates to **GH #37** (dead money on trimming) and **COMP-002a** (sign-and-flip) | **New** (different mechanism: CPU absorbs a *liability*) |
| STRAT-003 | No overlap found (COMP-007 listed draft decisions as "untested") | **New** |
| STRAT-004 | Adjacent to **COMP-005** (depth-chart guard) and **UI-TAFI-010/011** (season-end screens) | **New**; COMP-005 gets a confirmation (below) |
| STRAT-005 | Extends **COMP-009** | **Extension** (no new row in the master register) |
| STRAT-006 | Related to **REAL-001/009** (realism, burn-in) | **New, needs verification**; hand to realism owner |
| STRAT-007 | Related to **REAL-009** and Oct-2026 audit finding 2 | **Note only**, merge into REAL-009 |
| STRAT-008 | Related to **COMP-008** (CPU skill) | **New** (different: adaptation, not skill) |
| STRAT-009 | Docs only | **New**, trivial |
| STRAT-010 | Related to **COMP-002b** (K/P need bonus) | **Extension** of COMP-002b to all positions |

**Confirmation of existing items (no new id):** COMP-005 — the depth-chart screen has no warning when a weaker player starts ahead of a stronger one (`RosterCapManagement.tsx:269-280`, code-inspected; the Unit Grades dock does reflect the inversion in the grade, but nothing names it). COMP-009 — see STRAT-005. COMP-008 — Master ≈ Expert at 49–51% (repo docs) agrees with −0.55 ± 0.26 wins/season.

---

## STRAT-001 — Standalone (Mock) play makes roster decisions 2.5–6× less consequential
- Class: balance (consequence of a known bug) · Severity: High · Priority proposal: **P1** (tied to #74) · Mode: SP standalone
- Sim path: **Mock fallback** measured vs **real engine** on the same eight seeds (X5 vs X1)
- Grounding: controlled-sim (formula run) + code-inspected (`MockSimulationService.simGame`)
- Observed: wins per team-rating point 0.17 (Realistic) / 0.27 (Amplified) in the Mock vs 0.67 (year 1) / 1.04 (years 2–8) in the engine; r(rating, wins) 0.23 / 0.36 vs 0.54 / 0.69; sd of wins 1.8 vs 3.0 / 3.5. The Mock also adds +2.2 points of home field (engine: none, OQ-10). Plans, staffs, units and depth detail do not enter.
- Expected: roster quality should be the main driver of results in every build.
- Repro: `harness/x05_mock_sensitivity.test.ts` (README); reproducibility: always (deterministic).
- Root cause: confirmed — `simGame` margin ≈ 0.5 × scaled rating gap + home field, scores ~ N(·, 10).
- Proposed solution: issue #74 plan; interim: calibrate the Mock's slope toward the engine's and drop its home-field term (REPORT R1).
- Difficulty: L (engine in browser) / S (calibration). Benefit: every strategic system matters in the default build.
- Regression check: rerun X5 against the shipped standalone path; require slope ≥ 0.6, sd(wins) ≥ 2.8.
- Uncertainty: engine slope attenuated by measuring rating at playoff time; Mock slope not measured in a human playthrough.

## STRAT-002 — A CPU team takes a declining veteran's bad contract for free
- Class: balance/exploit · Severity: Medium–High if it holds under realistic caps · Priority proposal: **P2 (→ P1 if reproduced end-to-end under a tight cap)** · Mode: both
- Sim path: real trade model (`judgeTrade`); no game simulated
- Grounding: test-reproduced at model level; **no UI trade placed**
- Observed (X3-P5, seeds 9501/9502, league-creation cap, synthetic age-32 rating-70 players): $12M × 2 and $20M × 3 contracts are accepted with **no sweetener by 32 of 32** CPU teams with cap room (human's release penalty $5.3M / $13.2M); $30M × 4 by 23 of 32 for an EDGE, by at least one team for WR/OT in seed 9502, never for CB. Chart value stays positive because the performance term (≈ 17) outweighs the contract term at ≈ 1 chart point per $1.25M of surplus.
- Expected: absorbing a multi-year overpay should cost the receiver an asset about as large as the penalty the sender avoids.
- Repro: `A2S=1 A2S_ONLY=p5 A2S_OUT=… npm --prefix ui-source run test -- src/state/_a2s_x03.test.ts` (copy of `harness/x03_trade_exploit_probes.test.ts`, 2 s); reproducibility: always.
- Root cause: suspected — performance term not discounted by years-of-play-left for declining players; liability relief/absorb weights (`LIABILITY_RELIEF` 0.5).
- Proposed solution: REPORT R2. Alternatives: a per-team "absorbed dead-money" budget; require attached picks when the receiver's cap room would fall under a threshold.
- Difficulty: M · Benefit: gives contract decisions consequences.
- Related: Oct-2026 audit unresolved dump probe; GH #37; COMP-002a.
- Regression check: rerun on year-3 states; free takes ≤ 20% for release penalty ≥ $10M.
- Uncertainty: league-creation cap (all teams have room); throughput bounded by one deadline window; the human's legality at the deadline is intentionally relaxed.

## STRAT-003 — Draft Room shows an inflated grade and gives skill no way to improve
- Class: balance/UX · Severity: Medium · Priority proposal: **P2** · Mode: both
- Sim path: real engine (X2); UI reading is code-inspected
- Grounding: controlled-sim (4 leagues; 3 for the `board` arm) + code-inspected (`DraftRoom.tsx:160-166`)
- Observed: among 4,934 picks, headline college grade vs true rating r = 0.51–0.53 (restricted range) and policies that optimise the grade pick prospects ≈ 14.6 points below their grade (74.7 → 60.1). Perfect information is worth +1.0 team rating and +1.2 wins/season after three drafts; using only visible information (grade- or board-based) is not distinguishable from the CPU (−0.07 ± 0.30 to −0.03 ± 0.36 rating at +3); a position-blind draft loses ≈ 1 win/season (−0.9 ± 0.5 … −1.5 ± 0.5).
- Expected: a player who reads the information well should be able to outdraft a baseline; a draft screen should lead with the signal.
- Repro: `harness/x02_draft_policy.test.ts` (README); reproducibility: deterministic given seeds (the `base` arm equals X1 exactly).
- Root cause: confirmed for the display (rating column = `collegeOverall`); the absence of an information-buying mechanic is a code-read absence.
- Proposed solution: REPORT R3. Difficulty: M–L · Benefit: draft skill becomes learnable and rewarded.
- Regression check: informed-by-scouting arm; oracle-gap recovery proportional to the information bought.
- Uncertainty: 3–4 leagues; one definition per policy; no trade-up or need-aware variants; no scouting mechanic exists to compare against.

## STRAT-004 — No season-level or strategy-level attribution
- Class: UX/enhancement · Severity: Medium · Priority proposal: **P2** · Mode: both
- Grounding: code-inspected (searched `ui-source/src` for post-season attribution, expected-wins and "what went" text; found draft grade, unit grades, hot-seat score, recap of single games, not a season attribution)
- Observed: a player can see which pick was good and which unit is weak but not whether a season's record was talent, injuries or luck; no in-season warning of a depth-chart inversion.
- Expected: feedback that separates decision quality from outcome, which is what makes strategy learnable.
- Proposed solution: REPORT R4. Difficulty: M · Benefit: reduces "it's random" perception; protects against the cheapest mistake.
- Uncertainty: absence in code I searched, not verified in a played build.

## STRAT-005 — Game-plan agency is low; one dial is a uniform trap (extends COMP-009)
- Class: balance · Severity: Low–Medium · Priority proposal: **P3** · Mode: both (engine-backed play only)
- Sim path: real engine (X4)
- Grounding: controlled-sim (32 matchups × 7 plans × 100 paired games, talent 1.5)
- Observed: pass +15 = −1.73 pts/game [−2.29, −1.17] for everyone; five other plans within ±0.3 of standard (CIs include 0); run-heavy is the only dial with a reliable matchup effect (between-matchup sd ≈ 2.1, split-half r = 0.56); best-per-matchup choice beats standard by +0.5 to +1.1 out of sample, +0.55 pts/game over the best generic plan (≈ 0.25 wins/season).
- Proposed solution: REPORT R5. Uncertainty: seven hand-picked plans, no staffs/weather, real 2026 rosters, opponent on the standard plan.

## STRAT-006 — Low-win tail looks heavy (needs verification)
- Class: realism · Severity: Low · Priority proposal: **P3** · Mode: both · Hand to the realism owner
- Sim path: real engine (X1) · Grounding: controlled-sim
- Observed: 84 of 2,048 CPU team-seasons (4.1%) finish with ≤ 2 wins, including 0–17 (DEN 2028, KC 2031, seed 9401) with team ratings of 75–77. The modern NFL's rate is believed to be about 1–2% (from memory, **not verified**).
- Root cause: unknown (roster state of those teams, e.g. injuries at QB, was not recorded). Uncertainty: single configuration (Amplified, Standard).

## STRAT-007 — First-offseason talent step; short-horizon runs are not steady state
- Class: realism/documentation · Severity: Low · **P3** · Note only (merge into REAL-009)
- Observed: league mean of each team's top-24 players: 78.4 (year 1) → 81.2 (year 2) → 81.6 thereafter; age of top-24 rises 27.2 → 28.4 over 8 years. Any 1–3 season measurement (including X2's "+1 draft") includes the transition. Not the placeholder-72 artifact of the Oct audit (this uses player ratings, not `team.ratings.overall`).

## STRAT-008 — CPU teams do not adapt to the player
- Class: enhancement · Severity: Low · **P3** · Mode: both
- Grounding: code-inspected (`tradeModel.judgeWith`: acceptance is a pure function of team, season and assets; no memory of the human's past dealings)
- Proposed solution: REPORT R6. Uncertainty: reading, not run.

## STRAT-009 — Documentation says money is whole dollars; contracts are stored in $M
- Class: documentation · Severity: Low · **P3**
- Observed: `CLAUDE.md` → "Money is plain numbers in whole dollars"; `TeamState.cap` is "$M" (`seed.ts:127`) and contracts' `cap_hit_by_year` are in $M (a probe using whole dollars produced a chart value of −4,223,983). Cost me one failed experiment; likely to trip the next harness author.
- Proposed solution: one-line correction in `CLAUDE.md` / `player_schema.md`. Difficulty: XS.

## STRAT-010 — Need premium applies at every position, per incoming player (extends COMP-002b)
- Class: balance observation · Severity: Low · **P3**
- Sim path: real trade model · Grounding: test-reproduced (X3-P1)
- Observed: one replacement-level (58) player buys **1.4–2.1×** his chart value from some CPU team at positions where 3–13 teams are thin (C, DT, ILB, CB, S), ≈ 1.0× where nobody is thin (QB, WR, OT, RB, TE); three players buy 0.7–1.65×. Bounded; not a runaway.
- Root cause: the `needGained` term sums per player with no diminishing returns (`tradeModel.ts`). Proposed solution: diminish by position or cap total need credit at one player per position. Difficulty: S.

---

## Positive observations (protect against regressions)
- The headless entry points (`online/src/blocks.ts`) run the real engine, and the whole pipeline is **deterministic**: a no-intervention arm reproduces the control exactly (wins and ratings, 4 seasons).
- **Window arbitrage is closed**: max/min team multiplier 1.035 < `TRADE_FRICTION` (X3-P6).
- **Parity and luck are healthy** in CPU-run leagues: wins persistence r = 0.39, 23 champions in 64 seasons, champion's median pre-playoff rank 5.
- **Package discounting works**: 3 junk players never buy more than ≈ 1.65× (X3-P1).
- The Unit Grades dock puts engine-relevant explanation (weak links, synergy) on the draft, free-agency, trade and deadline screens.

## Suggested cross-agent follow-ups
- Realism: STRAT-006 (cause of 0–2 win teams), STRAT-007 (burn-in).
- Economy/contracts agent: STRAT-002 on tight-cap states; GH #37/#38.
- UI agent: STRAT-003 rating column, STRAT-004.
- A future pass: COMP-006 — a scripted skilled human over coaching draft, free agency, deadline and camp.
