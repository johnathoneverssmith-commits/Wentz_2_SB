# Competitiveness TAFI register (Agent 3)

Baseline for all entries: master `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b`, pool `ui-source/src/data/pool-2026.json`. Seeds/configs/raw data: [README.md](README.md), `data/`. "Confirmed/hypothetical" labels refer to the root cause. **Nothing here has been implemented; every fix is a recommendation needing approval.**

| ID | Title | Class | Severity | Confidence | Status after Part 2 |
|---|---|---|---|---|---|
| COMP-002b | K/P "need" bonus makes CPU teams pay more than chart value in picks for kickers/punters | **Exploitable strategy (confirmed in the trade model)** | Medium | High (mechanism and measurement); Medium (repeatability) | Tested; fix proposed |
| COMP-002a | Sign-and-flip of mid-priced starters (≈0.8–0.9× chart in picks) | Exploitable strategy candidate | Low–Medium | Medium | Tested with limits; bounded by cap/roster/deadline rules |
| COMP-005 | No warning when a weaker player starts ahead of a stronger one; inverted chart ≈ 0 wins | Confirmed UX gap + difficulty concern | Medium | High (effect and missing warning in code) | Verified in code; UI render not screenshot-verified |
| COMP-001 | QB underpriced (≈1.5×) but equal-payroll edge is only +1 to +2 margin | Balance concern (downgraded) | Low–Medium | Medium | Tested |
| COMP-008 | Higher CPU-GM skill gives no wins (−0.55 ±0.26 wins/season) | Weak/ineffective mechanic (tentative) | Medium if real | Low–Medium | Tested, needs ≥20 leagues |
| COMP-009 | Standard game plan is ≈best; alternatives mostly lose | Weak decision mechanic / design concern | Low–Medium | Medium | Tested without per-cell SEs; opponent adaptation untested |
| COMP-006 | Human-vs-CPU dominance and strategy comparison | Needs more testing | Unknown | – | **Not done** (scripted human over turn-based events needed) |
| COMP-003 | Head coach and bad staffs barely matter | Weak mechanic | Low | Medium | Unchanged |
| COMP-004 | Kicker/punter nearly irrelevant on the field | Optional depth enhancement | Low | Medium/Low | Unchanged; ties to COMP-002b |
| COMP-007 | Untested systems (draft, FA bidding, multiplayer, CPU draft/FA decision quality, 5-season controlled UI strategies) | Needs more testing | – | – | Partly closed; remainder listed below |

Status vocabulary: **Confirmed** (interval excludes zero, or confirmed in code), **Tentative** (wide interval/few leagues), **Incomplete** (not run). Entries below are the Part 1 text; **Part 2 updates follow at the end of this file and supersede them where they differ.**

---|---|---|---|---|---|
| COMP-001 | QB leverage exceeds QB price (≈1.4–1.7× per price unit) | Balance concern | Medium | Medium | Yes |
| COMP-002 | FA salary vs trade-chart mismatch by position: sign-and-flip candidate | Exploitable strategy (candidate) | Medium–High if real | Low–Medium | **Yes (priority)** |
| COMP-005 | Worst-first depth chart gives ≈0 wins; consequences binary, no guard verified | Difficulty/fairness concern | Medium | High (effect), Low (UI guard — not checked) | Yes (UI) |
| COMP-006 | Talent 1.5 default + additive unit effects: ceiling for a skilled human untested | Difficulty/fairness concern | Unknown | Low | **Yes (priority)** |
| COMP-003 | Head coach and bad staffs have ~no measurable effect | Weak/ineffective decision mechanic | Low | Medium | Partly (win% underpowered) |
| COMP-004 | Kicker/punter ratings nearly irrelevant | Optional strategic-depth enhancement | Low | Medium (K), Low (P) | Partly |
| COMP-007 | Untested systems: draft, FA bidding, trades, CPU decisions, multiplayer, 5-season UI play | Needs more testing | – | – | Yes |

---

## TAFI-COMP-001 — QB leverage exceeds QB price  *(Part 1 text — superseded by the Part 2 update at the end of this file where they differ)*
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

## TAFI-COMP-002 — FA salary vs trade-chart mismatch: sign-and-flip candidate  *(Part 1 text — superseded by the Part 2 update at the end of this file where they differ)*
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

## TAFI-COMP-005 — Worst-first depth chart ⇒ 0 wins  *(Part 1 text — superseded by the Part 2 update at the end of this file where they differ)*
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

## TAFI-COMP-006 — Dominance ceiling for a skilled human is unknown  *(Part 1 text — superseded by the Part 2 update at the end of this file where they differ)*
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

## TAFI-COMP-007 — Untested systems  *(Part 1 text — superseded by the Part 2 update at the end of this file where they differ)*
- **Class:** Needs more testing.
- **Not run:** real-UI five-season play; four human strategies; draft strategy and draft order; FA bidding and cap management; CPU trade acceptance and deadline behaviour; CPU roster-need responses to injuries; multiplayer turn order and collusion; inactive GMs; game-plan adaptation vs one universal plan.
- **Proposed solution/procedure:** README "Experiment status" and REPORT §9.
- **Regression/balance tests to add:** scripted-human policy runs (TAFI-COMP-006); `trade-metrics` extension (TAFI-COMP-002); `analysis/42/43` re-run at talent 1.5.
- **Priority:** P1 for human-policy + arbitrage, P2 for the rest.


---

# Part 2 updates (baseline `3abcfff`; data in `data/`; method in REPORT §11–§18)

## TAFI-COMP-002b — K/P need bonus: sign-and-flip returns more than chart value (supersedes COMP-002 for K/P)
- **Class/severity:** Exploitable strategy; Medium. **Confidence:** High for the mechanism and the measurement; Medium for the repeatability.
- **System:** CPU trade acceptance (`ui-source/src/state/tradeModel.ts`, `needAt`).
- **Baseline/config:** `harness/flip.test.ts`, seeds 12–15 (`data/flip_sign_and_trade.json`), age ≤31 top players treated as market FAs, contract years {1,4}, ranks {0,4}; real `judgeWith` and `checkTrade`; each CPU team had one free roster slot (`room=true`).
- **Expected:** a $3.5M punter or $9M kicker returns at most what the chart says he is worth (K 32, P 16 chart points at 94/88 ovr).
- **Observed:** K returned 1.14× and P 1.80× chart value in picks (16/16 cases sold; all 31 CPU teams would pay); a punter signed for $3.5M returned ≈23 chart points of picks, near a second-round pick (R2 = 29.7). Kicker/punter rating is not detectably worth anything on the field (P ±10: −0.2/−0.4 ±1.0 margin; K ±10: ±0.3).
- **Repro:** copy `harness/flip.test.ts` to `ui-source/src/state/_a3_flip.test.ts`; `A3=1 A3_SEEDS=12,13,14,15 A3_OUT=out.json npx vitest run src/state/_a3_flip.test.ts`; then `python3 harness/analyze_followup.py`.
- **Estimated competitive effect:** each K/P an extra pick of ≈20–30 chart points; bounded by the offseason-FA → deadline window (3 rounds, one trade per team per round), so likely a few picks per season, not unlimited. Season-level effect not simulated.
- **Root cause (confirmed by reading):** `needAt = max(1, 78 − bestAt(team, position))` is the same for every position, then added into the likelihood (`needScale × (needGained − needLost)/90`), so a K/P hole is treated like a QB hole.
- **Proposed solution:** (A, preferred) multiply `needAt` by the position's trade multiplier (K 0.3, P 0.2) or by `POSITION_VALUE`; (B) cap total need contribution for K/P to a few chart points; (C) exclude K/P from the need term and let the chart decide.
- **Expected effect:** K/P flips return ≤ chart value; mid-position behaviour unchanged.
- **Unintended consequences:** CPU teams fill K/P holes less urgently; deadline trade volume for K/P falls; strategy-weighted AI trade tests (`aiTradeFairness`, `aiTradesStarter`) may need updated expectations.
- **Regression test:** `ui-source/src/state` test: for every position, a signed FA offered to every CPU team for picks must return ≤ 1.0× chart value on average (tolerance 5%).
- **Complexity/priority:** low / **P1**.

## TAFI-COMP-002a — Sign-and-flip of mid-priced starters
- **Class:** Exploitable strategy candidate; Low–Medium. **Confidence:** Medium.
- **Observed (same data):** with a free roster slot, mid-salary starters sell for ≈0.8–0.9× chart: C 14/16 sold, TE 16/16, DT 10/16, ILB 12/16, S 10/16, WR/OT/OG 6/16; over ≈$20M mostly unsellable for cap reasons (QB 0/16, EDGE 0/16, CB 2/16, RB 4/16). With full 53-man rosters only 94/224 cases found any buyer.
- **Root cause:** *hypothetical/by design.* There is no trade lock on newly signed players (no such rule found by grep); the real brakes are cap, roster limit, one-trade-per-round, and the cost of winning the player in free agency.
- **Proposed solution:** measure net draft-capital gain per season in a full headless league first. If large: (A) a "recently signed" trade-value haircut (e.g. 20% for 1 season) or lock until after the first game; (B) otherwise leave.
- **Expected effect:** removes any pick pump without touching normal trades. **Unintended:** hurts legitimate sign-and-trade.
- **Regression test:** same as COMP-002b but per-season pick gain ≤ ε.
- **Complexity/priority:** low (measure) / low–medium (fix) / P3.
- **Limitation:** top players were modelled as the FA market; competition for them in the bidding rounds was not.

## TAFI-COMP-001 (update) — QB underpricing: real but small at equal payroll
- **Class:** Balance concern (downgraded to Low–Medium). **Confidence:** Medium.
- **Evidence:** single QB +10 = +3.91 ±1.15 margin vs best other single starter ≈+1.9 ±1.1 (`unit_single.jsonl`); but at equal payroll (`data/qb_budget.jsonl`, 640 pairs/arm) QB +10 gives +1.15 [+0.01,+2.29] at talent 1.0 and +2.15 [+0.91,+3.38] at 1.5; QB −10 gives −1.84 [−3.08,−0.60] at 1.0. +5/−5 are not significant.
- **Conclusion:** the pricing imbalance exists (per-price-unit ≈1.4–1.7×) but moving payroll into the QB is worth ≈+0.1–0.2 margin per rating point — not a dominant strategy.
- **Proposed solution (revised):** no price change now. Re-test with concentrated financing (cut K/P/RB/OG first) and ≥1,280 pairs; raise QB `POSITION_VALUE` only if the edge at talent 1.0 exceeds +2 margin. Alternative: lower QB engine leverage (`setQbEffect`).
- **Unintended:** QB inflation would starve rosters. **Regression:** the same harness, assert the equal-payroll QB-heavy edge ≤ +1.5 margin.
- **Complexity/priority:** medium / P3.

## TAFI-COMP-005 (update) — Missing depth-chart safeguard (verified in code)
- **Verified:** `RosterCapManagement.tsx` provides "Auto-reorder by overall" and a needs panel, but no check for a lower-rated starter ahead of a higher-rated healthy backup; chart locked during game blocks. Not verified in a screenshot of the rendered screen.
- **Proposed solution:** (A) a banner on the Roster & Depth Chart screen and in the Ready gate (`ReadinessGate.tsx`, `BLOCK_GATES`): "At QB, Player X (OVR 71) starts over Player Y (OVR 84, healthy)", one-click "Fix"; (B) warn only when the gap ≥ 5 or at premium positions (QB, OT, EDGE, CB); (C) allow an explicit "keep my order" dismissal for scheme-fit reasons.
- **Expected effect:** prevents the ≈0-win outcome from an accidental inverted chart. **Unintended:** nagging; must not block intentional choices.
- **Regression test:** UI test: inverted starter at each premium slot raises the banner; sorted chart does not; dismissal persists within a block.
- **Complexity/priority:** low / P2.

## TAFI-COMP-008 — CPU management skill has no measurable payoff (tentative)
- **Class:** Weak/ineffective mechanic (tentative). **Severity:** Medium if real.
- **Config:** `harness/skill_split.test.ts`, seeds 9401–9406 × 5 seasons, skill ±2.5, `data/skill_split_real_engine.json`.
- **Observed:** high − low skill = −0.55 wins/team/season (SE 0.26 across 6 leagues; 5 of 6 leagues negative); titles 9 vs 21 of 30 seasons; start strength identical.
- **Expected:** higher skill GMs build better rosters and win more (the docs describe the levels as search depth, need-awareness and noise differences).
- **Root cause:** *hypothetical* — skill changes search depth/noise but not objectives; the evaluators (`unitValue.ts` for Master, `aiStrategy` bonuses) may add little over the base; `docs/decisions.md`/`ai-master.test.ts` already note Master ≈ Expert.
- **Proposed solution:** (A) rerun with ≥20 leagues, matched strategies and more seasons before any change; (B) if confirmed, make skill act on something measurable (better positional-value weights, cap planning) or relabel the setting; (C) at minimum stop describing skill as strength.
- **Expected effect:** AI difficulty becomes a real lever. **Unintended:** stronger CPUs reduce human win rates.
- **Regression test:** extend `online/test/ai-master.test.ts` style: skill +2 vs −2 over 20 leagues must differ by ≥ +0.5 wins/season.
- **Complexity/priority:** medium / P2.

## TAFI-COMP-009 — Standard game plan is ≈best
- **Class:** Weak decision mechanic / design concern. **Severity:** Low–Medium. **Confidence:** Medium.
- **Config:** `analysis/42_strategy_tournament.ts --games 12 --talent 1.5` and `43_lever_audit.ts --games 12 --talent 1.5` (`data/gameplan_*.txt`), 32 rosters × 12 games each.
- **Observed:** all seven AI strategy plans average −0.08 to −1.97 margin vs the standard plan; best-fit eighth gains ≤ +1.2; worst-fit loses −2.1 to −5.9; every lever's extremes are ≈0 or negative on average.
- **Expected:** non-default plans should win somewhere (the roster-fit eighth should gain more than the average loses).
- **Root cause:** *hypothetical.* Standard plan is calibrated to league base rates, so any deviation moves off the engine's calibrated optimum.
- **Proposed solution:** (A) add opponent-weakness interactions so plans can beat specific opponents; (B) tune plan fit effects upward; (C) tell players the default is a sound baseline in "How It Works".
- **Unintended:** over-strong plans become dominant. **Regression test:** assert for each plan that the best-fit quartile gains ≥ +1.5 and the all-roster mean is ≥ −0.5.
- **Complexity/priority:** medium–high / P3.
- **Limits:** no per-cell SEs printed (≈±0.7 expected), opponent-specific adaptation untested, 12 games per roster.

## TAFI-COMP-006 (update) — Human-vs-CPU: not done
- **Done:** poor-decision control (Part 1), CPU-skill split (COMP-008). **Not done:** aggressive/balanced/rebuilder human policies; skilled-human dominance.
- **Blocker:** a scripted human must act through the turn-based events (free-agency rounds, draft turns, deadline turns; instant signing and ad-hoc trades are refused in `online/src/decide.ts`). That requires scripting `online/src/actions.ts`.
- **Procedure to close:** extend `harness/longitudinal.test.ts` with four policies calling `decideFreeAgencyTurn`/`decideDeadlineTurn`/`decideDraftPick`-level functions on the focal team; ≥10 seeds × 10 seasons; record wins, titles, cap, roster ovr; compare with the CPU-managed baseline.
- **Priority:** P1.

## TAFI-COMP-007 (update) — Remaining untested
Not run: CPU draft/FA decision-quality experiments (only the skill split touches these); positional need responses to injuries; multiplayer fairness (draft/FA order, collusion, inactive GMs); controlled-seed multi-strategy UI playthroughs; opponent-specific plan adaptation; talent-1.5 RB/P at ≥1,280 pairs.

## TAFI-COMP-010 — Real-UI playthrough automation: status and blockers (testing infrastructure, not a game defect)
- **Done:** a Playwright/Chromium script drives the real UI against the real-engine adapter through team select, 53-round fantasy draft, coaching draft, camp, preseason, regular season, trade deadline, free agency, playoffs, rookie draft and rookie signings; one full season (8–8, 2nd AFC North) and 16 games of season 2. `data/ui_run/`.
- **Not done:** five seasons; four strategies; seed-pinned leagues (a solo dynasty's seed is not controllable from the UI, so UI runs are not reproducible).
- **Blockers:** stage-specific dialogs needed ~10 handlers; adapter and dev-server processes were killed during the run; ≈30–45 min wall-clock per season.
- **Proposed solution:** (A) run `ui_loop.js` under a supervisor that restarts the adapter/Vite and resumes from `ui_snapshot.json`; (B) add a test-only URL/query option to start a solo dynasty with a given seed and an "auto-play" delegate-all mode (production-code change: **needs approval**); (C) record results by reading the saved league JSON instead of scraping text.
- **Regression test:** nightly job that plays one UI season against the real adapter and asserts `/simulate-week` is called and the stage reaches the rookie draft.
- **Complexity/priority:** medium (A, C) / low–medium (B) / P2.
