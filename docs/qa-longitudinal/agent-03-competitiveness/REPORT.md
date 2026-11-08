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

---

# Part 2 — follow-up investigations (this section supersedes Part 1 where they differ)

Raw data and scripts: `data/` and `harness/`; tables with CIs: [data/analysis_followup.md](data/analysis_followup.md) and [data/analysis_unit_summary.md](data/analysis_unit_summary.md) (regenerated, now includes all talent-1.5 arms).

## 11. Coverage now complete for the unit sweeps
All 36 planned unit-swap arms are done (talent 1.0 and 1.5 for every group; 640 pairs/arm unless 1,280 is listed in the table). Talent 1.5 scales group effects ≈1.4–1.6× (front +10: 5.1→8.0; secondary +10: 5.6→8.2; OL +10: 3.4→6.4; WR+TE +10: 3.7→5.5; RB +10: 1.0→2.6±1.2; LB 2.2→3.0). K ±10 at 1.5 is +0.45 [+0.17,+0.73] / −0.28 [−0.64,+0.08]; P is still not distinguishable from 0 (±0.9 margin). Still underpowered: RB at 1.5 and P at either level.

## 12. Individual starter vs whole unit (direct measurement, replaces the divided estimate)
One starter +10 (640 pairs each, talent 1.0, margin pts/game ±95% CI): QB **+3.91 ±1.15** (win +10.1 ±4.5 pp); S1 +1.91 ±1.11; CB1 +1.69 ±1.12; WR1 +1.64 ±1.20; EDGE1 +1.40, EDGE2 +1.29 (±1.1); ILB1 +1.04; TE +1.04; DT1 +0.98; WR3 +0.96; RB +0.91; C +0.80; CB3 +0.71; OG1 +0.59; OT1 +0.20 (±1.1 each). The single-starter intervals are wide (a single upgrade is a ≈±1-point effect on a game whose margin SD is ≈13), so **only the QB is individually distinguishable from zero and from the rest of the lineup**; the ordering among non-QB slots (S/CB/WR1/EDGE above OL/C/OT) is suggestive and consistent with the group results but is *not* established. The QB single-player effect (+3.9) is 2–4× the best other single starter.

## 13. Quarterback valuation at equal payroll (COMP-001, tested)
Method: `harness/qb_budget.ts`. The QB's rating moves by X; the dollars that move (game's FA price curve, `expectedSalary` formula, age ≤28, scale 1) are taken evenly from the other 22 starter/rotation slots, whose ratings move by the amount that costs/saves the same dollars (mean −1.6 points each for +10; +1.3 each for −10). Paired seeds, 640 pairs/arm.

| talent | QB change | others (mean) | margin [95% CI] | win% pts [95% CI] |
|---|---|---|---|---|
| 1.0 | +10 | −1.6 | **+1.15 [+0.01,+2.29]** | +4.4 [0.0,+8.8] |
| 1.0 | +5 | −0.9 | +0.65 [−0.45,+1.76] | +3.1 [−1.1,+7.3] |
| 1.0 | −5 | +0.7 | −0.82 [−1.99,+0.34] | 0.0 [−4.4,+4.5] |
| 1.0 | −10 | +1.3 | **−1.84 [−3.08,−0.60]** | −3.1 [−7.7,+1.5] |
| 1.5 | +10 | −1.6 | **+2.15 [+0.91,+3.38]** | +6.4 [+1.9,+10.9] |
| 1.5 | −10 | +1.3 | −1.17 [−2.46,+0.12] | −1.8 [−6.2,+2.6] |

Conclusion: reallocating payroll into the QB helps, but modestly: ≈ +0.1 to +0.2 margin per QB rating point at equal payroll (≈ +1 at talent 1.0, ≈ +2 at 1.5), against a 4–5× individual-starter advantage before payroll. So **the underpricing seen in Part 1 is real but small**; QB-heavy building is a mild edge, not a dominant strategy, in this model. Limits: even-split financing is one policy (a QB-heavy GM could concentrate cuts at cheap-to-lose positions such as K/P/RB, which would raise the edge); price curve ignores age and the 24% max-deal clamp; only one league-wide rating-to-dollar curve was used; no positional-minimum/depth effects.

## 14. Sign-and-flip (COMP-002, tested through the real trade model)
Method: `harness/flip.test.ts`; real `judgeWith` (acceptance ≥ 0.5) and real `checkTrade` (cap and 53-man legality). A human team signs a player at his `expectedSalary` and offers him to every CPU team for as many of that team's non-comp picks as it will pay (greedy, highest-chart first). The league's top players at each position are treated as the market (a fresh league's actual free-agent pool is leftovers, best QB 71): a **modelling limitation**, since a real human must also win the player in the bidding rounds. 4 seeds × ranks {0,4} × contract years {1,4} = 16 cases per position per setting. Results in `data/analysis_followup.md`.

What the rules do: (a) roster limit and cap are the binding constraints — with every CPU roster full at 53 only 94/224 cases found any buyer (and nearly all through the one or two teams with a spare slot); with one free slot per CPU team, mid-priced starters sell widely; (b) players over ≈$20M mostly cannot be absorbed (QB, EDGE: 0/16; CB 2/16; RB 4/16); (c) **mid-priced vets sell for ≈0.8–0.9× their chart value in picks** (C 14/16 sold, TE 16/16, DT 10/16, ILB 12/16); (d) **kickers and punters sell for MORE than the chart says**: K 1.14×, P 1.80×, accepted by all 31 CPU teams in 16/16 cases. A $3.5M punter returned ≈23 chart points of picks (about a second-round pick's chart value, R2 = 29.7), a $9M kicker ≈31, though punter rating is not detectably worth anything on the field (§2, §11).
Root cause (confirmed by reading `tradeModel.ts`): the CPU "need" bonus is `needAt = max(1, 78 − bestAtPosition)` for every position equally, so a hole at K/P is treated like a hole at QB although K/P are priced low and matter little; with `needScale` and the /90 divisor it can outweigh the chart gap.
Whether this is **repeatable** depends on rules outside this harness: in online play ad-hoc trading is closed and trades happen only at the deadline event (one trade per team per round, 3 rounds — `decide.ts`), and free agents are won in turn-based rounds. So the loop is bounded to ≈ the number of K/P-like assets and deadline rounds a GM can use, not unlimited. Magnitude was not simulated over a season; no evidence of a game-breaking pick stockpile, but the K/P channel is a real unintended pick source.

## 15. CPU management skill (COMP-008) — does smarter AI management win?
Method: `harness/skill_split.test.ts`, real engine, no human GM; every CPU GM's `skill` set to +2.5 (high) on half the teams and −2.5 (low) on the rest (alternating by sorted code, flipped by seed; re-applied each season), 6 leagues (seeds 9401–9406) × 5 seasons, league difficulty "standard". Starting team strength was identical between groups (difference 0.00).
Result: **no benefit from higher skill.** Mean wins/team/season (high − low) by league: −1.14, −0.54, −0.34, −0.47, +0.50, −1.32 → overall **−0.55 (SE 0.26 across leagues)**; titles high/low 9 vs 21 in 30 seasons; mean team overall gain over the five seasons equal (+11.3 vs +11.4, mostly the engine's rating recompute artifact noted in `docs/AUDIT_multiseason_2026-10.md`). Five of six leagues favour the *low*-skill GMs. Treated as **tentative**: 6 leagues, SE ≈ half the effect, and the knob sets search depth/noise/need-awareness, not goals. It does mean the CPU "intelligence" setting is not translating into wins in this harness, so a human cannot read "AI Difficulty" as a roster-strength lever, and a rational human strategy cannot be benchmarked against it. This tests the CPU skill knob, **not** human skill.

## 16. Game plans and the "universal plan" question (COMP-009)
Existing harnesses re-run at talent 1.5, 12 games per roster (32 rosters, 384 games per cell; the harnesses do not print SEs, so per-cell uncertainty is ≈ ±0.7 margin, a limit): raw output in `data/gameplan_42_strategy_tournament.txt` and `data/gameplan_43_lever_audit.txt`.
- All seven AI strategy plans score **below** the standard plan on an average roster: −0.08 (defense_heavy) to −1.97 (trenches_first) points a game. They gain only on the eight best-fit rosters (defense_heavy +1.19, pass_heavy +1.03, offense_heavy +0.50) and lose −2.1 to −5.9 on the eight worst-fit.
- Every lever at its extreme (qb-run, 2-pt, 4th down, kickoff, returns, rookie usage) is ≈0 or negative on average (kickoff −0.6 to −1.2, qb-run +100: −0.68). The only positive averages are tiny (qb-run −100 +0.23, fourthLong −100 +0.20).
So the **default plan is (near-)optimal on average and plan choices mostly carry downside**: consistent with "a universally good plan exists", and with plan-fit gains being small (≈+1 on the best-fitting third). Not tested: opponent-specific adaptation (all runs are against the standard opponent slate).

## 17. Depth-chart safeguard (verified in the code, not in the rendered UI)
`ui-source/src/screens/RosterCapManagement.tsx`: the roster screen offers "Auto-reorder by overall" and a needs panel that flags only (a) no player at a position, (b) fewer than the positional minimum, (c) top player of a group under 72 OVR, (d) a single player with no depth. **Nothing warns when a lower-rated player is ahead of a higher-rated healthy one at the same position**, and the chart is locked while a block of games runs (`depthLocked`). So an accidentally inverted starter (Part 1 sabotage test: 0.27 vs 10.0 wins a season) goes unflagged. Proposed safeguard is in TAFI-COMP-005.

## 18. Human-vs-CPU strategies and the real UI (COMP-006 / priority 9)
- **Headless strategy comparison: not done.** The human transaction surface online is turn-based events only (`decide.ts`: instant signing and ad-hoc trades are refused), so a scripted "aggressive/rebuilder/balanced" human has to drive the free-agency rounds, draft turns, and deadline turns. That is the `online/src/actions.ts` flow; it was not scripted here. Only the poor-decision control (worst-first depth chart, Part 1) and the CPU-skill split (§15) were run.
- **Real-UI playthrough: attempted and partially working.** Environment: root + `ui-source` dependencies installed; real-engine adapter `npx tsx server/index.ts` (:8787) and `npx vite --port 5199` in `ui-source`; the pre-installed Chromium at `/opt/pw-browsers/chromium` launched through the repo's Playwright with `executablePath` (the repo's pinned Playwright expects another browser build). A Playwright script (`harness/ui_loop.js`) picks a team in "New solo dynasty" and presses the visible advance/confirm/delegate buttons. It got through team select, the 53-round fantasy draft, the coaching draft (delegated), training camp, preseason and regular-season weeks, and the **adapter received `/simulate-week` calls (real engine games)**. 
  **What actually completed (one real-UI trajectory, Baltimore Ravens, default "delegate to staff" policy, `data/ui_run/ui_loop_part*.log`):** season 1 (2027) played end to end — fantasy draft (53 picks), coaching draft (delegated), training camp, preseason, 18 regular-season weeks (finished **8–8, 2nd in the AFC North**), trade deadline, mid-season free agency, playoffs (4 playoff rounds simulated by the adapter), rookie draft, rookie signings and the offseason free-agency round. Season 2 (2028) reached week 16 (**9–6 after a 31–33 loss at Cleveland**; 9–5, 1st in the division the week before). `/simulate-week`, `/playoffs/seed` and `/playoffs/round` reached the real-engine adapter throughout. **Five seasons were NOT completed**; this requirement is not met.
- **Blockers hit:** (1) the script needed about ten stage-specific handlers (confirmation dialogs after "Let my staff…", "Sign all remaining" for rookies, "Fix the roster", mid-season free-agency "Pass this round", mid-season depth chart) — all are now in `harness/ui_loop.js`; (2) the adapter and the Vite dev server were killed at least twice during the run (the sandbox processes did not survive; the machine appears to have been recycled), and each time the scripted run stalled; (3) a season takes ≈30–45 min of wall-clock through the UI at this speed. Not an engine or UI defect.
- **Handoff procedure to finish (browser-enabled agent):** `npm ci && npm --prefix ui-source ci`; start the adapter `NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json setsid nohup npx tsx server/index.ts &` (:8787) and `cd ui-source && setsid nohup npx vite --port 5199 --host 127.0.0.1 &`; run `node docs/qa-longitudinal/agent-03-competitiveness/harness/ui_loop.js` (edit the `S` scratch path at the top; uses `/opt/pw-browsers/chromium` via `executablePath`). The script writes `ui_snapshot.json` (the game's localStorage) at every stage change; `RESUME=1` reloads it so a killed run continues. Watch for `STUCK`/`NO ACTION` lines, add the missing button regex to `PREF`, resume. To compare strategies, replace the "Let my staff…" delegations with explicit choices at the free-agency board, trade deadline and rookie draft and re-run on separate saves. Record per-season record from the hub text (`W-L · place`), titles from `#/bracket`, and cap/roster from `#/roster`.
- The UI games are **not seed-pinned** (a solo dynasty uses its own seed), so runs are not reproducible league-to-league as the headless runs are; the results are an end-to-end real-engine/UI check and a single trajectory, not a controlled comparison.

## 19. Updated answer
Intelligent management matters through **lineup and roster quality** (large, well-measured effects: QB, then the front seven and secondary; OL/WR+TE group effects) and not through the other levers tested: coaching (small), plans (standard is already ≈best), CPU-AI skill (no measurable gain), kicker/punter (≈0 on the field). The game has two *unintended* pricing/AI quirks that favour the human: the K/P need bonus (confirmed, pays picks above the chart) and a QB that is ≈1.5× underpriced (real but mild at equal payroll). Not established: how far a cap-constrained skilled human can dominate over a decade, and whether human strategies (aggressive/rebuild) differ. See the updated register.

## 20. Ranked recommendations (updated; none implemented)
1. **Neutralise the K/P need bonus** (COMP-002b): weight `needAt` by the position's trade/engine value or cap K/P need; regression test: signing and flipping a K/P returns ≤ chart value in picks. Highest confidence, smallest change.
2. Depth-chart "starter out-rated by a healthy backup" warning + auto-fix prompt (COMP-005).
3. Re-measure COMP-001/QB underpricing with a "concentrated-cuts" financing policy and decide on a modest QB price rise only if the edge exceeds ≈+2 margin at talent 1.0.
4. Build the scripted-human strategy runner over the turn-based events (COMP-006), then re-assess dominance and the AI-skill result (COMP-008) with ≥20 leagues.
5. Give the head coach and poor staffs real stakes (COMP-003); give AI skill a measurable effect or relabel it (COMP-008).
6. Review the sign-and-flip window for mid-priced starters if later tests show it generates large pick totals (COMP-002a).
7. Optional depth: K/P late-game leverage (COMP-004); plan–opponent matchups so non-default plans can win (COMP-009).
