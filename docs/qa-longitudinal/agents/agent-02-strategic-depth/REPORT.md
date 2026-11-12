# Strategic Depth, Competitiveness & Fun — Report

Baseline `master` @ `d0727ff` (Group 08, PR #103) · branch `claude/ecstatic-faraday-1ircsl` · docs, harnesses and raw data only.
Reproduction, simulation-path table and experiment status: [README.md](README.md). New findings: [TAFI_REGISTER.md](TAFI_REGISTER.md).

**How to read confidence.** *Measured* = a controlled experiment on the real engine or real trade model with an interval. *Code-inspected* = read in source, not run. *Inferred* = reasoning from the above. A difference smaller than about twice its standard error is called "not distinguishable from zero", never "no effect".

---

## 0. Answer in brief

**To what extent do decisions determine success?** The evidence says: **substantially for roster *quality* (rating, position, lineup), weakly for roster *management* levers that have no price signal, and barely for tactical levers.**

| Lever | Verdict | Evidence |
|---|---|---|
| Roster talent (rating × unit × position) | **Decisive** | PR #95: QB ±23 pts ≈ ±5–7 margin; here X1: team rating ↔ wins r = 0.66, 0.95 wins per team-rating point |
| Draft decisions | **Protective, not enriching** | X2: perfect information ≈ +1 win/season, a position-blind draft ≈ −1; careful use of visible information ≈ CPU (not distinguishable); the headline grade overstates true rating by ≈ 15 (r ≈ 0.5 among picks) |
| Playing the **standalone** build | **Several times less consequential** | X5 (Mock): a team-rating point is worth 0.17–0.27 wins vs 0.67–1.04 in the real engine; sd of wins 1.8 vs 3.0–3.5 |
| Contract/cap discipline | **Soft** (consequences can be traded away) | X3-P5: a 32-year-old 70 paid $20M × 3 is accepted by the CPU for nothing |
| Trades vs CPU | **Fair, not farmable at scale** (except K/P, PR #95) | X3: need premium ≤ ≈2× chart and shrinks with package size; window arbitrage 1.02–1.04× < friction |
| Game plan | **Low agency** | X4: the standard plan is ≈ best on average; tailoring adds ≈ +0.5 pts/game at most, and only the run-heavy dial has a reliable matchup signal |
| Rebuilding | **Fast and forgiving** (CPU-run) | X1: bottom-quartile teams are at 8.1 wins after 3 years, 8.7 after 5 |
| Luck | **Large enough to keep the game alive** | X1: champion's pre-playoff rating rank median 5; top-rated team wins the title 12.5% |

---

## 1. Strategic agency report

### 1.1 What the earlier PRs already established (not repeated)
PR #95: unit leverage (QB 2–4× any other starter; equal-payroll QB edge +1.2 / +2.2 margin at talent 1.0 / 1.5), staff effects subtle, K/P trade overpay (COMP-002b), depth-chart inversion ≈ 0.3 wins/season over a worst-first chart, CPU skill split −0.55 ± 0.26 wins, standard game plan ≈ best. PR #102/Oct audit: realism backlog; all-CPU decay fixed; "late-season dump probe" left **unresolved**.

### 1.2 What this pass adds
1. **League-level dynamics of the real engine** over 8 seasons (parity, persistence, dynasties, rebuild time, payroll) — previously only 3 leagues × 5 seasons with no analysis of these.
2. **A matched-league draft experiment** with a deterministic `base` arm (X2).
3. **Trade-model probes for interactions PR #95 did not test**: need-stacking across positions, contract dumping, window arbitrage (X3).
4. **Opponent-specific game plans with split-half selection** (X4) — COMP-009 left "opponent adaptation untested".
5. A **fun/feedback review** of the decision surfaces, clearly separated from the measurements (§4).

### 1.3 Choices that matter, choices that look like they matter, and the disproportionate ones
- **Material:** QB and unit quality (PR #95); lineup integrity (a worst-first chart costs ≈ 0.3 wins/season only because the engine is forgiving — still the cheapest mistake to prevent); draft *information* (below).
- **Look important, measure small:** game-plan dials (X4: five of six alternatives are within ±0.3 pts/game of the standard plan, CI includes 0), head coach (PR #95), CPU-GM skill (PR #95), team payroll among CPUs (X1: r(payroll, wins) = 0.03 because every CPU spends to the cap — sd of payroll is 3%).
- **Disproportionately powerful:** the QB price/leverage gap (PR #95), K/P trade overpay (PR #95), and — new, model-level — **free contract dumps** (X3-P5), because they remove the consequence of the most common human mistake (overpaying a veteran).

---

## 2. Controlled experiments

### 2.1 X1 — CPU-run league dynamics (real engine; 8 leagues × 8 seasons; n = 2,048 team-seasons)
Seeds 9401–9408, all 32 teams CPU-managed, talent Amplified 1.5 (the new-league default), difficulty Standard, no human. Script `harness/x01_engine_path_and_parity.test.ts`, analysis `harness/analyze_x1.py`, output `data/x1_summary.txt`.

| Measure | Result | Reading |
|---|---|---|
| Year-to-year persistence | wins r = **0.39**; team rating r = **0.53** | wins persistence is in the range seen in the NFL (≈ 0.3–0.4, from memory, not re-verified here) |
| Rating → wins (same season) | r = **0.66**, slope **0.95 wins per rating point** (sd rating 2.4, sd wins 3.4) | talent is the main but not the only driver |
| Champion's pre-playoff rating rank | mean 6.1, median 5; top-3 38%; bottom half 2%; best-rated team wins 12.5% | strong teams favoured, upsets common |
| Title concentration | 64 titles, 23 different champions; max 3 titles for one team in 8 seasons | no runaway dynasty among CPUs |
| Sustained excellence | 25% of team-runs have ≥ 3 consecutive 11+ win seasons | dynasties exist but are not the norm |
| Mean reversion (bottom quartile by wins) | 6.9 wins next year, 7.7 after 2, **8.1 after 3**, 8.7 after 5 (league mean 8.5) | a rebuild is *quick* |
| Mean reversion (top quartile) | 10.2 → 9.4 → **9.0 after 3** → 8.6 after 5 | excellence decays to average in ≈ 5 years without continued action |
| Worst-4 → ≥ 10 wins next year | 20% (44/224) | plausible |
| Payroll | mean $247M → $409M over 7 years (cap growth); sd across teams $6–13M | CPUs sit at the cap; spending is not a differentiator |
| Extremes | 84 of 2,048 team-seasons (4.1%) have ≤ 2 wins, including 0–17 (DEN 2028, KC 2031) | see STRAT-006 (needs verification) |
| Burn-in | league mean of each team's top-24 players: 78.4 in year 1 → 81.2 in year 2 → 81.6 flat | short-horizon (≤ 3 seasons) results include the transition; see STRAT-007 |

**Interpretation.** Among CPU-run teams the long-run structure is healthy: persistence is moderate, luck is large, no team compounds. The same fact reads two ways for a *human*: it is good for replayability and rebuild morale, and it means that **sustained dominance must be earned by repeated action** (nothing coasts). Whether a *skilled human* escapes this mean reversion — the real "does skill compound?" question (COMP-006) — needs a scripted human policy over all turn-based events and was **not run** here beyond the draft (§2.2).

### 2.2 X2 — Does draft quality pay off? (real engine, matched leagues)
Four matched leagues (seeds 9401–9404; 9401–9403 for `board`), four seasons each, real engine. 11 of 32 teams (every third in code order) draft by a fixed policy; the other 21 teams and every other decision (free agency, coaching, trades, camp, depth) stay CPU-run. Draft 1 happens after season 1, so "+1/+2/+3" below means the season after 1, 2 and 3 treated drafts. Each treated team is compared with **itself** in the control run (same seed); n = 44 team pairs per cell (33 for `board`). Policies obey a positional cap (QB 1, RB 1, WR 2, TE 1, OT 2, OG 2, C 1, EDGE 2, DT 2, OLB 2, ILB 1, CB 2, S 2, K 0, P 0 per draft):

| Arm | Information used | Rookies' true rating (mean) | Team rating vs own control, +1 / +2 / +3 drafts (SE) | Wins/season vs own control, +1 / +2 / +3 (SE) |
|---|---|---|---|---|
| **oracle** (diagnostic) | hidden true rating × engine position value | **69.4** | +0.45 (.26) / +0.55 (.30) / **+1.02 (.25)** | +0.91 (.48) / +0.91 (.49) / **+1.16 (.55)** |
| **skilled-by-grade** | headline college grade × position value | 60.1 | −0.07 (.20) / −0.70 (.35) / −0.07 (.30) | +0.55 (.50) / −0.82 (.66) / −0.61 (.60) |
| **board** | the public board's projection (`expectedRatings`, what the CPU reads) × position value | 60.8 | −0.06 (.22) / −0.73 (.43) / −0.03 (.36) | −0.15 (.53) / −0.70 (.75) / −1.03 (.69) |
| **poor** | best college grade among low-value positions only (K/P excluded; RB, TE, OLB, S, ILB) | 59.5 | −0.50 (.22) / **−1.00 (.31)** / −0.18 (.26) | −0.45 (.46) / **−1.50 (.54)** / −0.91 (.46) |

(`base` reproduces the X1 run exactly — wins and ratings identical for 4 seasons — so a "control" is the same league without intervention; untreated-team drift, shown in `data/x02_summary.txt`, is ≤ ±0.8 and is subtracted in the DiD columns there. Difference-in-differences is *larger* than own-team change for oracle and poor because treated gains partly come out of untreated teams; the own-team figures are the conservative ones used here.)

**Reading.**
1. **Information, not judgement, is what separates drafts.** Perfect information on seven picks a year is worth ≈ **+1 team-rating point and ≈ +1 win/season** after three drafts (3 of 3 horizons positive; 4σ on rating). It is not available to a human.
2. **A human using what the screen shows does not beat the CPU.** Both "skilled" policies (grade-based and board-based) land within noise of the CPU's own drafts (−0.1 ± 0.3 to −0.7 ± 0.4 rating; wins −0.6 ± 0.6 to −1.0 ± 0.7 — negative on average, never significantly different from zero). That is not "drafting doesn't matter"; it is "no policy that uses only visible information was distinguishable from the CPU baseline in this sample".
3. **A bad draft is punished, moderately.** The position-blind policy loses ≈ **1 win/season** (−0.45, −1.50, −0.91; the +2 cell is 2.8σ) and ≈ −0.5 to −1.0 rating. Rookies in this engine contribute fast (the oracle effect is already visible at +1), so the penalty lands within a season.
4. **The visible grade is a poor guide.** Across 4,934 treated-team picks: headline college grade vs true rating r = 0.51–0.53 *among the players actually picked* (a restricted range, so the whole-class correlation is higher), and the prospects an optimiser picks by grade are on average **14.6 points** lower in truth than their grade says (74.7 vs 60.1). The Draft Room lists and sorts the rookie board by `collegeOverall` and displays it as `ovr` (`ui-source/src/screens/DraftRoom.tsx:160-166`, code-inspected), with the projected range as small print.
5. **What this implies for agency.** The reachable draft upside for a careful human is "don't blunder" (+1 win/season relative to a blunder), not "outdraft the CPU". With no scouting mechanic (§3.1: no scouting budget/staff/accuracy decision exists in the UI code I read) there is nothing a player can invest in to turn skill into information.

**Limits.** 3–4 leagues (the SE columns are team-level and treat the 44 pairs as independent; teams within a league share a draft class and an RNG stream, so true uncertainty is wider); one definition of each policy; no trade-ups, no need-aware drafting beyond the caps; `board` has 3 leagues only (the fourth was stopped to freeze the data) and is underpowered; the CPU control is itself strong (public board + need + strategy), so "no better than the CPU" is a high bar; the fictional-DNA league, talent 1.5.

### 2.5 X5 — How much do rating differences matter in the standalone Mock? (labelled **Mock fallback**; formula run, no engine)
Same eight leagues (seeds 9401–9408), `MockSimulationService.simulateWeek` over a generated 18-week schedule, `recomputeTeamRatings` first (the unit-based projection `team.ratings.overall`). Compare with the real engine on the same seeds (X1).

| | slope (wins per team-rating point) | r(rating, wins) | sd of wins | n |
|---|---|---|---|---|
| **Mock, Realistic (1.0)** | **0.17** | 0.23 | 1.79 | 256 team-seasons |
| **Mock, Amplified (1.5, new-league default)** | **0.27** | 0.36 | 1.80 | 256 |
| Real engine, year 1 (X1, Amplified) | 0.67 | 0.54 | 2.96 | 256 |
| Real engine, years 2–8 (X1, Amplified) | 1.04 | 0.69 | 3.47 | 1,792 |

In the fallback, a point of team rating is worth **roughly 2.5× (vs the real engine's first season) to 6× (later seasons) fewer wins**, and the league's records are visibly flatter (sd 1.8 vs 3.0–3.5; real NFL ≈ 3.1, from memory). The formula (`MockSimulationService.simGame`: margin ≈ 0.5 × scaled rating gap + 2.2 home-field, scores ~ N(·, 10)) also hands the home team +2.2 points where the engine has none (OQ-10). **The same roster decision is therefore worth several times less in the deployed standalone game than in the engine-backed game**; and game plan, staff, depth-chart detail and per-unit synergy do not enter at all. This is the quantitative strategic cost of issue #74 and is registered as STRAT-001 (it extends, does not replace, GAP-001/004).


### 2.3 X3 — CPU trade-model probes (no game simulated; the real `judgeTrade`)
Two seeded fictional-DNA leagues (9501, 9502) at league creation, all 32 teams with cap room. Harness `harness/x03_trade_exploit_probes.test.ts`; raw `data/x03_trade_probes.json`, `data/x03_p5.json`.

**P1 — need-stacking.** The OQ-9 need term adds `max(1, 78 − bestAtPosition)/90` of acceptance likelihood for *each* incoming "useful" player, without diminishing returns, while the chart's package discount (1, 0.7, 0.49 …) applies to value only. I offered 1–3 clone 58-rated, age-24 players at each position and searched all 31 CPU teams for the most valuable single asset (player or pick) any of them would give for it (accept ≥ 0.5).
- Positions where several teams are thin (C, DT, ILB, CB, S: 3–13 teams with best starter < 70): the CPU gives **1.4–2.1× the chart value** for one junk player (e.g. one 58 CB → a 57 QB; one 58 C → a 57 OT), **1.0–1.6× for three**.
- Positions where nobody is thin (QB, WR, OT, RB, TE): **≈ 1.0×**.
- Verdict: the premium is real, bounded and shrinks with package size; it converts replacement-level players into assets at ≤ 2× chart. It is **not** a runaway exploit by itself (it needs roster spots and a thin counterparty). K/P were not re-tested (PR #95 did); a junk K or P (negative chart) gets almost nothing here.

**P5 — contract dump.** Synthetic veterans (age 32, rating 70; WR, OT, EDGE, CB), cap hit and years varied, put on the human team; a CPU team with cap room is asked to take him alone, then with ever larger pick sweeteners:

| Contract | Chart value | Human's release penalty ($M) | CPU takes him for | 
|---|---|---|---|
| $12M × 2 | +12.6 (WR/OT/CB), +14.8 (EDGE) | 5.3 | **nothing** (32 of 32 teams willing) |
| $20M × 3 | +6.3 / +8.5 | 13.2 | **nothing** (32 of 32) |
| $30M × 4 | −1.2 (WR/OT/CB), +1.0 (EDGE) | 22.5 | **nothing** for EDGE (23 of 32 teams, seed 9501); WR/OT taken free in seed 9502 only; CB never |

The CPU also sees a *positive* value in a declining 32-year-old paid $20M a year because the performance term (≈ 17) outweighs the contract term at the chart's exchange rate (≈ 1 chart point per $1.25M of surplus). This agrees with, and explains, the October audit's unresolved note that "deals it values at or above zero are taken free". **Caveats:** league-creation cap (every team has room — in later years X1 shows payrolls near the cap, so fewer takers); no UI trade was actually proposed; the human's cap/roster legality at the deadline is deliberately relaxed in the product.

**P6 — window arbitrage.** Across 400 assets rated ≥ 70, the largest ratio between the highest and lowest team-specific multiplier is **1.035** (median 1.024), below `TRADE_FRICTION` (5% per leg + 1 pt). Buying from a contender and selling to a rebuilder cannot be made to pay. **Good design; keep.**

### 2.4 X4 — Opponent-specific game plans (real engine; 32 matchups × 7 plans × 100 paired games; talent 1.5)
Plans: standard, pass +15, run-heavy (pass −15), blitz 70, no-blitz −70, 12-personnel heavy, aggressive fourth downs. Same seeds across plans; selection on games 0–49, scoring on 50–99 and reversed. `data/x04_summary.txt`.

| Plan vs standard (pts/game, 95% CI, n = 3,200 paired games) | Effect |
|---|---|
| pass +15 | **−1.73** [−2.29, −1.17] — a uniform trap |
| run-heavy | −0.15 [−0.71, +0.42] |
| 12-personnel | −0.24 [−0.76, +0.28] |
| blitz 70 | +0.09 [−0.27, +0.46] |
| no-blitz | +0.29 [−0.07, +0.65] |
| aggressive 4th | +0.22 [−0.05, +0.50] |

- **Matchups matter for some dials.** The run-heavy effect differs by opponent (between-matchup sd ≈ 2.1 pts) and is *reproducible* (split-half r = 0.56). 12-personnel, blitz and no-blitz show weaker, partly noisy heterogeneity (r = 0.25 / 0.20 / 0.34). Pass +15 shows none (r = −0.06): it is simply bad.
- **Tailoring beats the best generic plan, modestly.** Choosing the best of seven per matchup from 50 games and scoring on the other 50 gave **+0.51 and +1.06 pts/game over standard**, i.e. **+0.4 ± 0.5 and +0.7 ± 0.3 over the best single generic plan**. Pooled: ≈ **+0.55 pts/game**, roughly 1.5 win-percentage points or 0.25 wins/season. Split-half agreement on *which* plan is best was only 10/32 (chance 4.6/32), so an individual weekly choice is mostly noise.
- **Reading:** opponent-specific adaptation *exists* but is small relative to talent (a +10 QB ≈ +3.9 margin, PR #95). Its main strategic value is that it offers no dominant plan; its cost is that a player cannot feel it. The existing plan preview (160 paired sims) can in principle detect a ≈ 2 pt matchup effect (sampling SE ≈ 0.8), so the *tool* is adequate; the effect is the limit.
- **Limits:** no staffs, no weather, real 2026 rosters (not an evolved league), opponents on the standard plan only, 7 hand-picked plans (not a search), per-matchup n = 50 per half.

---

## 3. Competitive AI assessment

Evidence labels: **M** measured here, **P95** measured in PR #95, **C** code-inspected, **I** inferred.

| Area | Assessment | Evidence | Confidence |
|---|---|---|---|
| **Drafting** | Strong baseline. Uses the public board's projection (not the misleading headline grade), positional need and strategy; a human using only visible information is not distinguishable from it (X2). It is the bar a player must clear, and a player cannot clear it without hidden information. | M (X2), C (`rules.ts planAutopicks`, `draftBoard.expectedRatings`) | Medium |
| **Free-agency competition** | Spends to the cap: payroll mean $247M at a $255M cap in year 1, sd 3% (X1). Nothing in X1 isolates its bid quality. | M (X1) | Low–medium |
| **Contract decisions** | CPUs run capped out, so cap room is a human-only advantage; but CPUs will absorb a declining veteran's bad contract for free (X3-P5), so the CPU is a **cap sink**. | M (X3, model-level) | Medium; caveat tight-cap years |
| **Trade valuation** | Disciplined on the axes tested: window arbitrage 1.02–1.04× < friction (X3-P6); package discounting stops quantity-for-quality; need premium bounded ≤ ≈ 2× chart and shrinking with package size (X3-P1). Known gap: K/P overpay (P95 COMP-002b). Overvalues positive-value veterans on bad deals (X3-P5). | M | Medium |
| **Roster balancing** | 53-man rosters, no holes at the checkpoints; but 4.1% of team-seasons end with ≤ 2 wins, including 0–17 (X1) — cause not isolated (STRAT-006). | M (X1) | Low |
| **Coaching decisions** | Hires "best value"; staff effects are small by design (P95 COMP-003), so a CPU can't be badly hurt or helped. | P95, C | Medium |
| **Long-term development** | Healthy: persistence r = 0.39, bottom quartile averages 8.1 wins by year 3, no dynasty compounding, 23 champions in 64 seasons (X1). | M (X1) | Medium |
| **Difficulty as a challenge dial** | Higher levels change *search quality*, not opposing *strength*: CPU skill split −0.55 ± 0.26 wins/season (P95), Master ≈ Expert 49–51% (CLAUDE.md). The "Competitive/Expert/Master" ladder is therefore not a ladder of challenge. | P95, repo docs | Medium |
| **Adapting to the player** | None found. A trade answer is a pure function of (team, season, assets); no state records what the player has done; the CPU does not re-weight against a player who always sells declining veterans or always buys low-value positions. | C (`tradeModel.judgeWith`, `deterministicNoiseUnit`) | Medium (reading, not run) |

**Exploits to a human (ranked by disproportion):**
1. **Free contract dumps** (X3-P5): a 32-year-old 70 on $20M × 3 (penalty to release: $13.2M) is taken for nothing by every CPU with cap room; a $30M × 4 EDGE by 23 of 32. Because trades happen at the deadline, where cap and roster limits are deliberately allowed to break and are "enforced afterwards", this is exactly the moment a human can shed a mistake. *Throughput is bounded* (one window, three rounds of one turn each) and *the sample is league creation with every team under the cap* — so this is a strong signal, not yet a demonstrated farm.
2. **K/P overpay** (P95): already registered.
3. **QB price/leverage** (P95): already registered; mild at equal payroll.
4. **Need-stacking** (X3-P1): bounded, not an exploit on its own.

No single dominant strategy was demonstrated. The honest reading: **the tested levers are each either bounded (trades, tailoring) or mild (QB at equal payroll)**, and the one that *removes the cost of mistakes* (dumps) was only probed at model level. COMP-006 (a scripted skilled human over all turn-based events) remains the missing experiment.

### 3.1 What a player cannot invest in
Reading the draft, coaching, free-agency and camp code, I found no decision that buys information (scouting staff, scouting budget, prospect interviews) and no decision that buys CPU relationships. Information appears only as a difficulty setting (`expectedRatings(prospects, accuracy)`, per CPU level), so a human's draft skill has no growth path. Reported as STRAT-003 with the caveat that this is an absence in code I read, not a verified absence from the product.

---

## 4. Fun and playability analysis

**Scope and honesty.** This section is a **code and design-surface review plus the quantitative results above**. I did **not** hand-play a multi-season franchise through the browser in this session (see §5.1), so "fun" is argued from structure and measured consequences, and I separate **observed friction / measured fact** from **design preference** explicitly.

### 4.1 Observed (measured or visible in code)
| Observation | Basis | Effect on play |
|---|---|---|
| **In the standalone build, outcomes respond 2.5–6× less to roster quality; no game plan, staff or unit effects** | X5 (measured, Mock), `MockSimulationService.simGame` | Decisions feel inconsequential; seasons look alike (sd of wins 1.8); the tactical controls are labelled as inactive (PR #69) |
| Draft Room headline rating is the college grade, which overstates by ≈ 15 and predicts at r ≈ 0.5 | X2, `DraftRoom.tsx:160-166` | A new player is taught, by the screen, to optimise the wrong number, then learns at Rookie Signings; the lesson arrives a season late and has no remedy |
| The Draft Room, free agency, trade and deadline screens all offer **Unit Grades** (a dock) with weak-link and priority text | `UnitGradesDock.tsx`, `UnitGrades.tsx` | **Good**: the decision surface explains *what the engine rewards* (weak links, synergy) at the moment of choice |
| A draft letter grade and "best value picks" exist; the first-year value of a pick is revealed at signings | `draftSummaryView.ts`, `RookieDraftSummary.tsx` | Good feedback for *which pick was good*; nothing explains whether the *strategy* was |
| Depth chart: reorder buttons only; a weaker player ahead of a stronger one raises no warning | `RosterCapManagement.tsx:269-280` (COMP-005) | Cheap, silent self-harm (≈ 0.3 wins/season) |
| Trades can only be proposed in the deadline window, three rounds, one turn at a time | `howItWorks.ts` "The trade deadline"; `transactionWindows.ts` | Safe from trade-spam; one decision moment per year for the whole trade game |
| Roughly 25 gates per season, ≈ 10 of which are summary/announcement/acknowledge stages | `Stage` union in `domain/league.ts` (`endOfSeasonAnnounce`, `endOfSeasonWin/Consolation`, each `*Summary`, `trainingCampResults`, `leagueDevelopments`) | Repetition risk in seasons 4+ — unmeasured with real players; compare UI-TAFI-011 (awards page) |
| Failure has a structure: hot-seat score (fire < 20, never before year 3), Hooded Figure after two losing seasons, a fired GM picks from the worst teams | `hotSeat.ts` | Losing is a story with exits, not a dead end |
| CPU-run leagues give 23 champions in 64 seasons, worst-to-first at 20%, and a 0–17 season exists | X1 | Distinct stories are plausible |

### 4.2 Design preferences (argued, not measured; do not treat as defects)
- **Rebuilding is short.** A CPU bottom-quartile team is average by year 3, so a *human's* rebuild has a ≈ 3-year arc. That is good for pacing and weak for "long, patient project" fantasies. A longer arc needs less mean reversion, not a different UI.
- **Trade play is a once-a-year event.** This protects balance and bounds the dump exploit; it also means a rebuilding GM's active levers are draft, free agency and one deadline.
- **Successful strategies stay satisfying only if they stay costly.** Because CPU teams regress to average in ~5 years, a dominant human run needs continuing action; whether that remains interesting after season 5 was not observed.

### 4.3 Did the questions get answered?
| Question | Answer |
|---|---|
| Are decisions understandable and consequential? | *Understandable*: yes on the roster axis (unit grades, How It Works). *Consequential*: in the engine path yes (talent), in the standalone path markedly less (X5). |
| Does feedback help users learn? | For picks and units, yes. For *why a season went the way it did*, no season-level attribution found (STRAT-004). |
| Does progress feel rewarding? | Not measured. |
| Do seasons produce distinct stories? | CPU data: plausible (X1). |
| Is rebuilding engaging? | Structurally short (X1); engagement not measured. |
| Does losing give interesting decisions? | Hot-seat + Hooded Figure + draft position exist; not played. |
| Does routine become tedious? | ≈ 25 gates/season, ≈ 10 acknowledgements (code only). |

---

## 5. Real-engine validity

### 5.1 What was and was not done
| Check | Result |
|---|---|
| Headless harness runs the real engine | **Yes, verified** (X0): 333 `simulateGame` calls in one league-season; the Mock never simulated a game. |
| Deterministic across arms | **Yes, verified**: `base` arm reproduces the X1 run's wins and ratings exactly for 4 seasons. |
| Engine-only experiments labelled | X1, X2, X4 real engine; X3 real trade model, no games; X5 **Mock (labelled)**. No Mock result is used for an engine conclusion. |
| **UI playthrough** | **Not done in this session.** The full 5-season UI loop was not repeated: PR #95 completed only one season and recorded the blockers (`agent-03-competitiveness/REPORT.md` §18), nothing in the harness is seed-pinned, and the audit harness builds fixtures with the engine adapter unreachable (Mock fallback), so its screenshots would show layout, not balance. I spent the budget on matched, paired experiments instead. Every statement in §4 about screens is therefore **code-inspected**, not played. |
| Standalone build (issue #74) | **Assessed by formula and by X5**, not played. Strategic conclusions in this report apply to engine-backed play (adapter or online). |

### 5.2 Confidence and limits
- **High confidence:** the harness is on the real engine and is deterministic (X0, `base` arm); the X1 league-structure statistics (64 league-seasons); the Mock's low rating sensitivity (X5, large effect, 8 leagues × 2 settings, formula agrees).
- **Medium:** the X4 tailoring estimate (+0.55 pts/game, SE ≈ 0.3, 32 matchups, hand-picked plans, real 2026 rosters); the X2 ordering oracle > CPU-like ≈ skilled > poor (consistent in sign, SE ≈ 0.3–0.6 on 44 team pairs).
- **Low–medium:** X3-P5 (model-level, league-creation cap, synthetic players; no UI trade placed); CPU assessments marked "C".
- **Not measured:** a scripted skilled human over *all* turn-based events (COMP-006); multiplayer fairness; free-agency bid quality; five-season UI play; any phone/real-user fun measure; online-league behaviour.
- **Reminder:** numbers are from a fictional-DNA league with talent 1.5 unless stated; the 2026 real rosters were used for X4.

---

## 6. Prioritized strategic improvement roadmap

Nothing here is implemented. Each item changes production code or balance and, per `CLAUDE.md`, needs separate explicit approval. Ranked by expected effect on how much a player's decisions matter. R1–R2 address "decisions have little effect" and "CPU easily exploited"; R3–R4 "important mechanics lack understandable feedback"; R5 tactical agency / dominance; R6 progression.

### R1. Make the real engine the default for standalone play (issue #74) — *highest impact, already scoped*
- **Current behaviour.** With no adapter, `HybridSimulationService` falls back to the Mock, which decides a game from one scalar and ignores plans, staff and units (X5).
- **Harm.** A team-rating point is worth 0.17–0.27 wins (vs 0.67–1.04); league records are flat (sd 1.8 vs 3.0–3.5); home field is +2.2 where the engine has none. Every roster, draft and contract decision is 2.5–6× less consequential in the build most players will open.
- **Proposed.** The approved Phase-1 plan in `ISSUE-74-PLAN.md` (browser worker, explicit versioned pool). Until it lands: surface the engine/Mock state on the hub (GAP-004) and, if the Mock stays, calibrate its rating→margin slope toward the engine's (inferred ≈ 2 points of margin per team-rating point: 0.95–1.04 wins/season ÷ ≈ 0.5 wins per margin point per season) and drop its home-field term.
- **Expected effect on decisions.** Roster quality becomes the main driver in solo play too; game plans and staff start to matter; records spread like the engine's.
- **Unintended consequences.** Solo difficulty and variance rise; saves and tests that encode Mock behaviour change; bundle size and cold-start time (per the issue).
- **Validate.** The parity and pool-coupling tests already listed in #74; plus rerun `harness/x05_mock_sensitivity.test.ts` against the shipped standalone path and require slope ≥ 0.6 and sd(wins) ≥ 2.8.

### R2. Put a price on shedding a contract
- **Current behaviour.** Declining veterans on bad deals are valued ≥ 0 by the CPU; a 32-year-old 70 at $20M × 3 is taken for free by every team with cap room (X3-P5).
- **Harm.** Cap discipline is soft: the usual human mistake (overpaying a veteran) can be undone at the deadline for no asset cost; together with the deadline's deliberate illegality it removes the main consequence of signing mistakes.
- **Proposed.** Make the CPU's contract term bite for players near or past the decline age: discount the performance term by *expected years of play left* (not by age alone) so it cannot outweigh a multi-year overpay, and require a sweetener proportional to `releasePenalty` whenever net value is below a threshold. Optionally limit the free "absorbed" contract dollars per CPU team per year.
- **Expected effect.** A four-year deal for a 31-year-old becomes a real decision; FA bidding discipline matters; dead money and the cap screen become load-bearing feedback.
- **Unintended consequences.** CPU rebuilding teams lose their natural role of absorbing veterans; league-wide veteran prices fall; the AI's own deadline sellers (`cpuDeadlineSellers`) may hold more bad deals.
- **Validate.** Re-run `x03_trade_exploit_probes.test.ts` with `A2S_ONLY=p5` (2 s) on year-3, tight-cap states: free takes should fall to ≤ 20% of teams for deals with a release penalty ≥ $10M; extend `trade-metrics.test.ts` with the average sweetener paid per dumped dollar; rerun the October liability-dump probe.

### R3. Give draft skill something to act on
- **Current behaviour.** The Draft Room's headline number is the college grade (overstates by ≈ 15, r ≈ 0.5 among picks); the board's projection is small print; no mechanic buys information; the CPU already reads the better signal (X2).
- **Harm.** The best a human can do with visible information is match the CPU; the screen invites the worse choice; the lesson arrives at signings, a season later.
- **Proposed.** (a) Relabel and demote the college grade ("college production, not a pro rating") and lead with the projection / expected rookie rating; (b) add an investable information channel — a scouting-staff or scouting-budget decision that narrows the error on unseen ratings for a few prospects per round, paid in cap or staff slots — so skill can beat the CPU baseline legitimately; (c) after the draft, show "projected vs revealed" for each pick.
- **Expected effect.** Draft quality becomes a way to outperform, bounded by the oracle gap (≈ +1 win/season after three drafts at perfect information): noticeable over a dynasty, not a cheat.
- **Unintended consequences.** More offseason decisions; a CPU analogue is needed or humans keep a built-in edge; risk of over-powering a rebuild.
- **Validate.** Re-run `x02_draft_policy.test.ts` with an "informed" arm (true rating + noise σ): the gain over `board` should scale with 1/σ and stay ≤ +1.2 wins/season; the `base` arm must still reproduce X1.

### R4. Season and decision attribution (plus the depth-chart warning)
- **Current behaviour.** Pick-level and unit-level feedback exist; no "what drove this record" (talent vs injuries vs luck vs plan) and no warning when a weaker player starts ahead of a stronger one (COMP-005).
- **Harm.** A 5–12 season and an 8–9 season both read as "something happened"; players can't separate skill from luck, which is the learning signal the game depends on.
- **Proposed.** In the existing end-of-season summary: expected wins from unit ratings (the projection exists) vs actual, games lost to injury, close-game record, and one attribution sentence; on the depth-chart screen an inversion banner with the one-click fix.
- **Expected effect.** Players see good decisions raise *expected* wins even when results disappoint; the cheap mistake disappears.
- **Unintended consequences.** More text on a screen already flagged as buried (UI-TAFI-010/011); a rough model that mis-attributes luck would erode trust.
- **Validate.** Check the attribution model against the engine over ≥ 1,000 simulated seasons (expected wins within ±0.5 of the mean); UI test that it renders once per season without a new gate.

### R5. Make opponent-specific tactics discoverable and the trap dials safe
- **Current behaviour.** The standard plan is ≈ best on average (X4, P95); pass +15 costs 1.7 pts/game for everyone; the only dial with a reliable per-opponent signal is run-heavy (split-half r = 0.56); tailoring is worth ≈ +0.5 pts/game.
- **Harm.** The plan screen offers many levers that do nothing or hurt, and the one real lever isn't pointed out.
- **Proposed.** Use the existing plan preview to name the opponent's weakest unit and the dial with a measurable edge; annotate dials whose global effect is negative with their cost.
- **Expected effect.** Opponent preparation becomes a visible skill worth a fraction of a win; no dominant plan emerges.
- **Unintended consequences.** Preview noise (SE ≈ 0.8 at 160 sims) can mislead; the recommended dial can become a meta.
- **Validate.** `x04_opponent_tailoring.ts` on held-out matchups: the recommended dial should beat standard out of sample by ≥ 0.3 pts/game without becoming the global best.

### R6. A slower rebuild arc and a CPU that remembers (lower priority)
- **Current behaviour.** CPU-run bottom-quartile teams reach average in ≈ 3 years and top teams decay in ≈ 5 (X1); the CPU never adapts to a player's habits (§3).
- **Harm.** A human dynasty needs constant tending but a rebuild is short; no rival learns.
- **Proposed.** A small visible market memory (a team that has taken three of your declining veterans prices the fourth with a surcharge); a longer window on high-pick rookie contracts.
- **Expected effect.** Longer arcs and counter-play to repeated tricks.
- **Unintended consequences.** More state to serialise; new exploit surfaces.
- **Validate.** Re-run X1 (persistence r should stay 0.3–0.5; bottom-quartile 3-year mean ≤ 8.0) and a repeated-dump probe.

**Already registered elsewhere (not re-argued):** QB price/leverage (COMP-001), K/P trade overpay (COMP-002b), sign-and-flip (COMP-002a), depth-chart inversion (COMP-005), CPU skill (COMP-008), game plans (COMP-009).

---

## 7. Completion summary

| Item | Value |
|---|---|
| Baseline commit | `d0727ff` (master, PR #103) |
| Draft QA PR | opened as a draft; number in the PR conversation |
| **Strongest evidence that decisions matter** | Real engine, 2,048 team-seasons: rating predicts wins at r = 0.66, ≈ 1 win per rating point; in matched leagues, perfect-information drafting is worth +1.0 rating / +1.2 wins per season after three drafts and a position-blind draft costs ≈ 1 win; PR #95: a +10 QB ≈ +3.9 margin. |
| **Strongest evidence that decisions do not matter enough** | (1) Standalone/Mock: a rating point is worth 0.17–0.27 wins vs 0.67–1.04 in the engine (X5). (2) With the information on screen, a human drafts no better than the CPU (X2). (3) Contract mistakes can be traded away for free (X3, model-level). (4) Only run-heavy has a matchup signal; best tailoring ≈ +0.5 pts/game (X4). |
| **Biggest competitive exploit** | Free contract dumps on CPU teams (STRAT-002): a 32-year-old 70 at $20M × 3 accepted for nothing by 32 of 32 CPU teams with cap room; model-level, not yet end-to-end in the UI. K/P overpay (PR #95) remains the biggest *confirmed* exploit. |
| **Top five improvements** | R1 real engine by default (#74) · R2 price contract shedding · R3 make draft skill actionable · R4 season/decision attribution + depth-chart warning · R5 discoverable opponent tactics |
| **Confidence** | High: harness is on the real engine and deterministic; Mock sensitivity gap. Medium: engine rewards roster decisions strongly; CPU is fair but non-adapting; X2/X4 effect sizes. Low–medium: exploits (model-level) and fun (code review only). |
| **Biggest limitation** | No scripted skilled human over all turn-based events and no multi-season browser playthrough (COMP-006 and UI play remain open). |
