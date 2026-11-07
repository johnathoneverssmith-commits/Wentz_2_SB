# Competitiveness TAFI register (Agent 3)

Baseline for all entries: master `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b`, pool `ui-source/src/data/pool-2026.json`. Seeds/configs/raw data: [README.md](README.md), `data/`. "Confirmed/hypothetical" labels refer to the root cause. **Nothing here has been implemented; every fix is a recommendation needing approval.**

| ID | Title | Class | Severity | Confidence | Needs more validation |
|---|---|---|---|---|---|
| COMP-001 | QB leverage exceeds QB price (≈1.4–1.7× per price unit) | Balance concern | Medium | Medium | Yes |
| COMP-002 | FA salary vs trade-chart mismatch by position: sign-and-flip candidate | Exploitable strategy (candidate) | Medium–High if real | Low–Medium | **Yes (priority)** |
| COMP-005 | Worst-first depth chart gives ≈0 wins; consequences binary, no guard verified | Difficulty/fairness concern | Medium | High (effect), Low (UI guard — not checked) | Yes (UI) |
| COMP-006 | Talent 1.5 default + additive unit effects: ceiling for a skilled human untested | Difficulty/fairness concern | Unknown | Low | **Yes (priority)** |
| COMP-003 | Head coach and bad staffs have ~no measurable effect | Weak/ineffective decision mechanic | Low | Medium | Partly (win% underpowered) |
| COMP-004 | Kicker/punter ratings nearly irrelevant | Optional strategic-depth enhancement | Low | Medium (K), Low (P) | Partly |
| COMP-007 | Untested systems: draft, FA bidding, trades, CPU decisions, multiplayer, 5-season UI play | Needs more testing | – | – | Yes |

---

## TAFI-COMP-001 — QB leverage exceeds QB price
- **Severity / impact:** Medium. One player decides about as much as a whole defensive unit.
- **System:** Rating layer (`ratings.ts`/QB effect) vs `POSITION_VALUE` / `TRADE_POSITION_VALUE` (`MockSimulationService.ts`).
- **Baseline/config:** `3abcfff`; `harness/unit_swap.ts QB abs:72|abs:95 40|20 1|1.5`; seeds `5_100_000+rep*1009+teamIdx`; 1,280 pairs (talent 1) / 640 (talent 1.5).
- **Expected:** Price roughly proportional to measured value; the repo says `POSITION_VALUE` was re-measured from the engine (QB 2.92).
- **Observed:** QB 72→95 = −5.06 [−5.88,−4.24] / +5.39 [+4.60,+6.19] margin (talent 1); −7.49 / +7.46 (talent 1.5). That is ≈0.42–0.50 margin per rating point vs ≈0.10 for a typical non-QB starter (4–5×) against a price multiplier of 2.92 against ≈1.0 (≈2.9×): ≈1.4–1.7× underpriced. Pool scarcity is also steepest at QB (starter mean 82.2 vs first backup 68.4).
- **Repro:** run the harness lines above, then `python3 harness/analyze.py`.
- **Evidence:** `data/unit_swap.jsonl`, `data/analysis_unit_summary.md`.
- **Estimated competitive effect:** a top-QB-first build gains up to ≈5–7 margin points (≈15–18 win-% points) for ≈23% of the cap.
- **Root cause:** *hypothetical.* The 24% max-deal clamp stops the multiplier from rising as the engine value does; the QB value may also have risen since the last `38_unit_links` measurement (the 2026-10 pass changed units).
- **Proposed solution:** (A, preferred) first validate with a budget-matched experiment, then, if confirmed, re-fit QB in `POSITION_VALUE`/trade chart and let the 24% clamp apply only to contracts. (B) reduce QB engine leverage (`setQbEffect` knobs) toward the price. (C) accept: matches real NFL.
- **Expected effect:** balances QB-first vs balanced builds; the cap cost of an elite QB becomes a real trade-off.
- **Unintended consequences:** salary inflation at QB squeezes rosters, CPU rebuilds, AI evaluators (Master `unitValue.ts`) retune; trade-chart changes ripple through every AI trade.
- **Regression/balance test:** extend `analysis/46_qb_value.ts` with a cap-matched QB-heavy vs balanced roster over ≥20 seeds × 32 teams; assert the margin gap ≤ ±1 point.
- **Complexity/priority:** medium / P2.

## TAFI-COMP-002 — FA salary vs trade-chart mismatch: sign-and-flip candidate
- **Severity:** Medium–High if confirmed; the strategy would be repeatable and cap-efficient.
- **System:** `expectedSalary` (`freeAgencyValues.ts`) vs `playerPerformanceValue`/`TRADE_POSITION_VALUE` (`MockSimulationService.ts`), `tradeModel.ts` acceptance.
- **Config:** `harness/price_arbitrage.test.ts`; one league, seed 9301, synthetic age-27 players at ovr 75/85/92.
- **Expected:** a player bought at market price should not be worth much more to a CPU trade evaluator than he cost the buyer.
- **Observed (ovr 85):** trade-chart points per $M of asking salary: QB 15.4, DT 6.6, WR 6.4, OT 5.6, TE 5.2, OG 4.9, C 4.7, EDGE 4.6, ILB 4.2, CB 3.9, S 3.9, K 2.9, RB 2.8 (`data/price_arbitrage.csv`). Trade and FA tables differ by design (trade follows the NFL market, FA follows the engine) so DT (1.08 vs 0.79), WR (1.15 vs 0.87), OT, TE are cheap to sign and dear to sell.
- **Repro:** `harness/price_arbitrage.test.ts` (see README).
- **Competitive effect:** *unknown* — no sign-and-flip was simulated. The chart's contract-surplus term may cancel it.
- **Root cause:** *hypothetical.* Two price tables with different design intents.
- **Proposed solution:** (A) run the experiment: in a seeded league, sign the top FA at each position at his ask, offer him to every CPU team for picks via `judgeTrade`, record picks-value gained per cap dollar and per position. (B) if confirmed, align `TRADE_POSITION_VALUE` with `POSITION_VALUE` ratios (or add a "recently-signed player" trade-value haircut / signing-to-trade lock). (C) If not confirmed, document the reason.
- **Expected effect:** removes a possible "free pick generator".
- **Unintended consequences:** changes AI rebuild/contender behavior; an anti-flip lock affects legitimate trades.
- **Regression test:** an `online/test/` metric like `trade-metrics.test.ts` asserting average pick value gained per FA signing ≤ ε at every position.
- **Complexity/priority:** low (experiment) / medium (fix) / **P1**.

## TAFI-COMP-005 — Worst-first depth chart ⇒ 0 wins
- **Severity:** Medium. **Class:** Difficulty/fairness concern.
- **System:** depth chart → `Roster` depth order; lineup UI.
- **Config:** `harness/longitudinal.test.ts`, seeds 9301–9303, 2026–2030, focal team KC; variants `cpu` and `sabotage`.
- **Expected:** a very poor lineup loses but not near-uniformly.
- **Observed:** 4 wins across 15 team-seasons (0.27/season; 14 of 15 seasons ≤2) vs 150 wins (10.0/season, range 3–13) with CPU management.
- **Interpretation:** tests lineup importance only; not evidence of valuation accuracy. Six position groups were set worst-first at once, including every premium protection/coverage slot — the extreme case.
- **Root cause:** *confirmed* that the sim reads the depth chart (the worst starters play). Whether the UI warns about an inverted chart: *not verified here.*
- **Proposed solution:** (A) warn when a starter is out-rated by a healthy backup at the same position by ≥N points; (B) one-click "Auto-sort by rating"; (C) log it in the post-season staff report.
- **Expected effect:** catches mis-sorted charts after trades/injuries/draft; no change to engine balance.
- **Unintended consequences:** nagging; real reasons to start a lower-rated player (scheme fit) must remain allowed.
- **Regression test:** UI test that an inverted starter at each premium slot raises the warning; a lineup test that rating-sorted equals default.
- **Complexity/priority:** low / P2.

## TAFI-COMP-006 — Dominance ceiling for a skilled human is unknown
- **Class:** Difficulty/fairness concern; needs testing. **Severity:** unknown.
- **Config:** talent 1.0 vs 1.5 unit sweeps (`data/unit_swap.jsonl`).
- **Observed:** group effects are large (+10 on every unit sums to ≈25 margin/game if additive, derived not measured); the default talent 1.5 scales QB/OL effects by 1.4–1.6×. CPU-only leagues show healthy parity (§6 of the report), but a human has no cap-constrained opponent behaviour tested.
- **Root cause:** *hypothetical.* Cap/market are the only brakes.
- **Proposed solution:** run a cap-constrained "best-response" human policy (scripted actions) against CPUs for ≥10 seeds × 10 seasons; measure title rate and consecutive-title streaks; compare talent 1.0 and 1.5.
- **Expected effect:** gives data to choose between recommending talent 1.0 default, a cap-pressure tweak, or no change.
- **Unintended consequences:** none (investigation).
- **Regression test:** keep the policy run as an opt-in metric; fail if a scripted human wins >50% of titles over 100 team-seasons.
- **Complexity/priority:** high / **P1**.

## TAFI-COMP-003 — Head coach and bad staffs barely matter
- **Class:** Weak/ineffective decision mechanic. **Severity:** Low.
- **Config:** `harness/staff_swap.ts`, 640 pairs per arm, talent 1.5, seeds `7_100_000+…`.
- **Observed:** HC 95 = +0.64 [+0.02,+1.26]; HC 20 = +0.17 [−0.32,+0.66] (no harm). Full staff 95 = +2.90 [+1.68,+4.13]; all-20 = −1.00 [−2.11,+0.11]. Single-role win% CIs include zero.
- **Expected:** the coaching layer is documented as "subtle", so some smallness is by design; the asymmetry (little downside) may not be.
- **Root cause:** *hypothetical* — HC levers act only on situational/discipline channels.
- **Proposed solution:** (A) widen HC discipline/game-management impact; (B) tie scheme fit to roster so a mismatched staff costs something; (C) leave as flavour and say so in "How It Works".
- **Expected effect:** coaching hires become meaningful for humans and CPUs.
- **Unintended consequences:** coaching-draft AI evaluators and difficulty retuning.
- **Regression test:** staff sweep at ≥1,280 pairs/arm with the assertion HC 95 vs 20 ≥ +1 margin.
- **Complexity/priority:** medium / P3.

## TAFI-COMP-004 — Kicker/punter nearly irrelevant
- **Class:** Optional depth enhancement. **Severity:** Low.
- **Observed:** K ±10 = −0.36 [−0.69,−0.04] / +0.29 [−0.04,+0.61]; P ±10 = −0.22 / −0.42 (CIs ±1, not distinguishable from 0; n = 640). Prices are low (K 0.5/0.3, P 0.25/0.2) so this is consistent, not a defect.
- **Root cause:** *hypothetical* — averaged margin hides close-game leverage; no leverage test run.
- **Proposed solution:** measure close-game (≤3 pts) win share; if low, add leverage (e.g. longer-range FG attempts rely on K). Alternatively no change.
- **Expected effect/consequences:** more kicker drama; risk of overpricing specialists.
- **Regression test:** a 1,280-pair K/P sweep in close games only.
- **Complexity/priority:** medium / P4.

## TAFI-COMP-007 — Untested systems
- **Class:** Needs more testing.
- **Not run:** real-UI five-season play; four human strategies; draft strategy and draft order; FA bidding and cap management; CPU trade acceptance and deadline behaviour; CPU roster-need responses to injuries; multiplayer turn order and collusion; inactive GMs; game-plan adaptation vs one universal plan.
- **Proposed solution/procedure:** README "Experiment status" and REPORT §9.
- **Regression/balance tests to add:** scripted-human policy runs (TAFI-COMP-006); `trade-metrics` extension (TAFI-COMP-002); `analysis/42/43` re-run at talent 1.5.
- **Priority:** P1 for human-policy + arbitrage, P2 for the rest.
