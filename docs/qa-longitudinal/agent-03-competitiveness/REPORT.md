# Agent 3 — Competitiveness & Strategic Depth: findings report

Baseline `3abcfff` · pool `pool-2026.json` · all numbers are from files in `data/`; nothing here is from memory or the UI.
**Read [README.md](README.md) first for which experiment arms are complete and which are not.** Full CI tables: [data/analysis_unit_summary.md](data/analysis_unit_summary.md).

## 0. Answer to the central question (with its limits)

Within what was tested, **the engine strongly rewards roster quality and lineup choices**: elite-versus-replacement swings are large relative to game noise, and the league that results is not degenerate (CPU-only parity is healthy). The strongest levers are the quarterback and the defensive back seven/front. Coaching staff is a small lever, and kicker/punter are close to irrelevant. Two things look like **repeatable-exploit candidates but are unproven**: the quarterback's price relative to his measured value, and the free-agent-salary versus trade-chart gap by position. The decision systems that most need testing — draft, free agency, trades, multi-season human play, and multiplayer — were **not** exercised by simulation here (see §9); statements about them are code/table reviews only.

## 1. Five-season playthrough (what was and was not done)

- **Real UI, four human strategies: not done.** This cloud session has no usable browser stack for driving the app against the real engine, and the repo's `franchise:stress` runner uses a mock backend (excluded as evidence, as instructed).
- **Done instead — headless real-engine longitudinal (not UI play):** 3 leagues × 5 seasons, `online/src/blocks.ts` games (real `simulateGame`), CPU running every team (no human GM, so no contender/rebuilder/balanced strategy was exercised). KC was the focal team: CPU-managed vs. depth chart set worst-first (the "poor-decision control"). See §4 and §7.

## 2. Player-rating impact (talent 1.0 unless stated; paired seeds)

Group = whole unit shifted together; per-starter = group ÷ number of starters (derived, so its CI is the group CI ÷ n). Margin = points/game.

| Unit (starters) | −10 group margin [95% CI] | +10 group margin [95% CI] | +10 win% pts [95% CI] | pairs |
|---|---|---|---|---|
| QB (1; set to 72 / 95, league mean 82.2) | −5.06 [−5.88,−4.24] | +5.39 [+4.60,+6.19] | −13.8 / +15.2 | 1,280 |
| OL (5) | −4.41 [−5.31,−3.51] | +3.38 [+2.50,+4.26] | +8.4 [+5.1,+11.6] | 1,280 |
| WR+TE (4) | −4.14 [−5.01,−3.28] | +3.65 [+2.80,+4.50] | +10.6 [+7.4,+13.8] | 1,280 |
| Front: 2 EDGE + 2 DT (4) | −3.46 [−4.73,−2.18] | +5.11 [+3.82,+6.40] | +16.0 [+11.5,+20.5] | 640 |
| Secondary: 3 CB + 2 S (5) | −4.64 [−5.95,−3.33] | +5.59 [+4.25,+6.94] | +16.3 [+11.7,+21.0] | 640 |
| ILB (2) | −2.04 [−3.26,−0.82] | +2.22 [+0.95,+3.50] | +5.6 [+0.7,+10.5] | 640 |
| RB (1) | −1.07 [−1.84,−0.30] | +1.04 [+0.20,+1.88] | +3.2 [0.0,+6.4] | 1,280 |
| K (1) | −0.36 [−0.69,−0.04] | +0.29 [−0.04,+0.61] | +0.9 [−0.5,+2.4] | 640 |
| P (1) | −0.22 [−1.17,+0.74] | −0.42 [−1.38,+0.53] | −1.2 [−4.8,+2.5] | 640 |

**Group vs marginal starter.** Per +10 rating points, a typical non-QB starter is worth ≈ 0.8–1.1 margin points (OL 0.78, WR/TE 0.97, RB 1.05, front 1.07, ILB 1.07, secondary 1.02; CIs on each roughly ±0.15–0.3, RB ±0.8). The QB alone is worth ≈ 4.2–5.0 per +10 (0.42–0.50 per rating point over the 10–13-point gaps used), i.e. about **4–5× a typical starter and about the same as the entire secondary (5 starters) or front (4)**. Qualitative reading: whole units matter a lot because there are many starters, but upgrading *one* non-QB starter is a ~1-point-of-margin (~2–3 win-% points) decision; upgrading the QB is the only single-player move that is worth a whole unit.

**Elite vs replacement QB (the brief's example).** 72 → 95: swing 10.5 margin points and 29.0 win-% points at talent 1.0 (−5.06 / +5.39, each CI above); 14.9 and 37.0 at the Amplified default 1.5 (−7.49 [−8.79,−6.18] / +7.46 [+6.32,+8.60]; 640 pairs). Win-% is vs. random opponents on each base team's own roster.

**Too much / too little.** QB high (but see price, §5). OL is the lowest-valued group per starter (0.78 vs ≈1.0; tentative, difference not tested directly). K is small (≈0.3 per +10); P is **not detectable** at 640 pairs (SE 0.49 margin, so effects below ≈1 margin point are not ruled out). Talent 1.5 scales the unit effects by ≈1.4–1.6× (QB 5.2→7.5 per side, OL 3.9→6.0), so the new-league default makes roster quality matter more.
**Tentative, not supported at this sample size:** RB/ILB are "cheap for what they do" in trade (§5); needs more pairs.

## 3. Drafting and roster construction

**Not simulated.** Evidence limited to pool statistics (`analysis_unit_summary.md`, scarcity table): the QB position has the biggest drop from starter to first backup (82.2 vs 68.4, 13.8 points) while most other positions drop 6–9 — scarcity and engine leverage both concentrate at QB. Draft-order, CPU draft intelligence, and recoverability-from-a-bad-pick need a dedicated experiment (§9, TAFI-COMP-007).

## 4. Coaching and game planning

Staff (talent 1.5; 640 pairs/arm; opponent = league-average staff):

| Focal staff | margin [95% CI] | win% pts [95% CI] |
|---|---|---|
| HC+OC+DC all 95 | +2.90 [+1.68,+4.13] | +4.06 [0.00,+8.12] |
| HC 95 | +0.64 [+0.02,+1.26] | +0.70 [−1.59,+2.99] |
| OC 95 | +1.62 [+0.55,+2.69] | +0.55 [−3.21,+4.31] |
| DC 95 | +1.85 [+0.77,+2.94] | +0.94 [−3.04,+4.92] |
| HC+OC+DC all 20 | −1.00 [−2.11,+0.11] | −4.06 [−8.10,−0.02] |
| HC 20 / OC 20 / DC 20 | +0.17 / +0.19 / −0.74 (all CIs include 0) | all CIs include 0 |

An elite full staff ≈ +3 margin points (about a fifth of the QB 72→95 swing at the same 1.5 talent, 2.9 vs 14.9); the head coach alone is ≈ 0.6 and a bad head coach shows no measurable harm. The staff effect is positive for good staffs and statistically indistinguishable from zero for bad ones. Game-plan levers (`analysis/42_strategy_tournament.ts`, `43_lever_audit.ts`) exist and measure fit-dependent plan effects; they were **not re-run** here, so no game-plan conclusion is made. The UI's communication of plan effects was not reviewed.

## 5. Free agency, contracts and trades — value vs price

Price tables are `TRADE_POSITION_VALUE` and `POSITION_VALUE` in `ui-source/src/sim/MockSimulationService.ts` (~L1514, ~L1606). Measured per-starter margin per +10 divided by position price (group averages; derived, CIs wide):

| Unit | per-starter margin/+10 | trade price | FA price | margin per trade-price unit | per FA-price unit |
|---|---|---|---|---|---|
| QB | ≈4.2–5.0 | 2.92 | 2.92 | **≈1.4–1.7** | **≈1.4–1.7** |
| OL | 0.78 | 1.00 | 0.94 | 0.78 | 0.83 |
| WR+TE | 0.97 | 1.09 | 0.86 | 0.90 | 1.13 |
| Front | 1.07 | 1.19 | 1.07 | 0.90 | 1.00 |
| Secondary | 1.02 | 1.05 | 1.30 | 0.97 | 0.79 |
| ILB | 1.07 | 0.85 | 0.97 | 1.25 | 1.10 |
| RB | 1.05 | 0.78 | 1.21 | 1.35 | 0.87 |

Reading: by this crude measure the QB is **the most underpriced position** (≈1.6× the engine value per price unit) and the others cluster 0.8–1.3. But the QB's salary is also capped at 24% of the cap (`MockSimulationService.ts` max-deal comment), so the brake on QB hoarding is the contract clamp, not the multiplier; a 92 QB asks $59.5M (23% of the $255M cap) for ≈ +5 margin.

**Free-agent salary vs trade-chart value** (`data/price_arbitrage.csv`, age 27, synthetic players). Chart points per $M of asking salary at 85 overall: QB 15.4, DT 6.6, WR 6.4, OT 5.6, TE 5.2, OG 4.9, C 4.7, EDGE 4.6, ILB 4.2, CB 3.9, S 3.9, K 2.9, RB 2.8. DT/WR/OT/TE are 1.4–2.3× more valuable *to a CPU's trade chart* per cap dollar than CB/S/RB. If CPU teams accept on the chart (`tradeAccepts` ≥ 0.5, `tradeModel.ts`), a human can sign cheap-salary, high-chart positions and flip them. This is **a hypothesis**: the chart also adds a contract-surplus term that should be near zero at market price, and no actual sign-and-flip was simulated (TAFI-COMP-002).

Trade deadline, rebuilding via trades, overpaying for short-term gains, and CPU trade acceptance behavior were **not** simulated. The existing `docs/AUDIT_multiseason_2026-10.md` reports stable deadline trading in two-human leagues, buyer paid/received ≈ 1.1; I did not re-verify it.

## 6. CPU opponent intelligence

Only the CPU-only longitudinal data (3 seeds × 5 seasons) supports statements:
- League mean team overall rose ≈1.3, 1.2, 1.9 points over four offseasons then flattened (seed 9301: 77.2→78.5; 9302: 78.6→79.8; 9303: 78.0→79.9). CPU franchises did not decay.
- Team overall correlates with regular-season wins at r = 0.53–0.83 per season-league.
- Year-to-year win correlation r = 0.31 (n = 384 team-seasons). Teams that finished in the bottom 8 averaged 6.95 wins the next year; the top 8 averaged 9.44 (league mean 8.5): regression to the mean is real but not complete — i.e. **no permanent dynasties or cellars** among CPUs.
- 15 seasons produced 12 different champions (MIN ×3, BUF ×2 repeat); win totals range 1–16.
Draft, free-agent, cap and trade *decision quality* were not directly measured. No exploitable CPU pattern is claimed.

## 7. Difficulty, fairness, randomness

- **Poor decisions have severe consequences.** With worst-first order at QB/OT/OG/C/EDGE/CB, KC won **0.27 games a season** (4 wins in 15 team-seasons, 14 of 15 seasons ≤2 wins) vs **10.0** with the CPU managing the same team (150 wins in 15; range 3–13, KC is the same franchise and league at the start). This tests **lineup importance**, not valuation accuracy: it shows the sim reads the depth chart and that six premium groups starting their worst players is catastrophic. It also shows consequences are close to binary for that mistake (TAFI-COMP-005).
- **Randomness.** The pre-game rating signal is large relative to noise (r ≈ 0.7 between team overall and wins), yet win totals still span 1–16 and the SD of league wins is 3.4. Skill matters; the game is not deterministic.
- **Permanent dominance / recoverability / skilled human vs CPU**: not tested (needs a human-policy run, §9).
- Derived (untested) ceiling: summing group effects at +10 across all units gives ≈ +25 margin points a game if effects were additive. Salary cap, market prices, and talent supply are the only brakes. How close a budget-constrained human can get was not simulated (TAFI-COMP-006).

## 8. Multiplayer fairness

**Not tested.** No analysis of draft order, FA turn order, trade collusion, or inactive GMs was run. `online/test/humans-only-circuit.test.ts`, `full-circuit.test.ts` and `docs/MULTIPLAYER_RELIABILITY*.md` exist for follow-up.

## 9. What remains and exactly how to close it

1. **Five real-UI seasons** (browser-enabled agent). Blocker here: the cloud session cannot run the app's UI against the real engine adapter. Procedure: `npm --prefix ui-source run build`; start `server/index.ts` adapter (`:8787`) and serve the build; in a real browser play four leagues from the same seed (aggressive, rebuilder, balanced, poor-control) for five seasons; record each decision, team record, cap and roster ovr each stage. Do **not** use `franchise:stress`/`e2e` fixtures (mock simulation).
2. **Headless human-policy runs.** Extend `harness/longitudinal.test.ts` with scripted action calls (`online/src/actions.ts`) for the four strategies; ≥10 seeds each; compare titles/wins/cap. This closes the strategy-comparison deliverable and TAFI-COMP-006.
3. **Sign-and-flip and price-arbitrage experiment** (TAFI-COMP-002) and **budget-matched QB vs balanced build** (TAFI-COMP-001).
4. **Draft/FA/trade CPU behaviour experiments** (TAFI-COMP-007) and multiplayer fairness (Agent 8 / Agent 6 coordination).
5. **Fill talent 1.5 arms** (WR+TE, RB, front, LB, secondary, K, P) and raise P/RB/K to ≥1,280 pairs.

## 10. Ranked improvements (recommendations only; none implemented)

1. Validate-then-tune the QB price/leverage relationship (TAFI-COMP-001): run budget-matched builds before touching any constants.
2. Test FA→trade flipping by position (TAFI-COMP-002); if confirmed, align chart multipliers with FA salary multipliers per position.
3. Add a depth-chart sanity guard/"auto-fix" prompt (TAFI-COMP-005) — cheap, protects humans from catastrophic accidents.
4. Quantify the ceiling of a budget-constrained human (TAFI-COMP-006) before deciding on difficulty changes.
5. Give the head-coach hire and a bad staff real stakes (TAFI-COMP-003) — an optional depth feature.
6. K/P: leave as is or add a late-game leverage (TAFI-COMP-004) — optional.
7. Run the missing experiments (TAFI-COMP-007).
