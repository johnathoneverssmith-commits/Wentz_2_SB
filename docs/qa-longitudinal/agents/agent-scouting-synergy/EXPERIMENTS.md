# EXPERIMENTS — methodology and results

Baseline `master` @ `d0727ff`. Reproduction and seed formulas: [README.md](README.md). Design under test: [DESIGN.md](DESIGN.md). All data: `data/`; all scripts: `harness/`.

**Labels used throughout.** **[ENGINE]** = the unmodified real engine at the baseline commit. **[PROTOTYPE]** = the real engine plus `harness/synergy-proto.patch` (≈ 130 lines added to `src/engine/synergy.ts`, applied in a scratch git worktree; a *prediction* about the proposed system, not an engine fact). **[HARNESS]** = real game/draft machinery with a scouting model that exists only in the experiment script. **[MODEL]** = closed-form Monte Carlo, no engine. No result uses the standalone Mock fallback (issue #74) as evidence.

**Conventions.** Margin = focal-team points per game. Each comparison is paired (same seed, opponent, venue; rosters differ only by the treatment). SE is the paired standard error; "not distinguishable from zero" means |effect| < ≈ 2 SE. Talent impact 1.5 ("Amplified", the new-league default) unless stated; Experiment B was repeated at 1.0.

---

## 0. Headline results

| # | Question | Result | Confidence |
|---|---|---|---|
| 1 | Does the **existing** scheme mechanic penalise a distinct scheme? | **Mechanically yes, but only for rosters without `scheme_tags`, and offence far more than defence.** Noise-free: a non-neutral offensive scheme on an untagged roster costs 0.12–0.26 yd/carry and 0.025–0.051 completion logits; a non-neutral defensive scheme on untagged players concedes 0.08–0.13 yd/carry and 0.015–0.025 logits. With tagged rosters the league-mean fit effect is exactly 0 (centred by construction). **Simulated** margins (n = 512 pairs per cell) are noisy: untagged offence −0.9 to −2.0 (5 of 5 negative, 2 of 5 nominally significant, 1 of 5 after Holm adjustment across 20 cells); tagged offence −0.0 to −1.1 (2 of 5 nominal, 0 after Holm, and not explained by the fit term, so most likely noise); defence: no cell significant either way. [ENGINE, D1, `REFINEMENT.md` §C] | High for the mechanism and for untagged offence as a group; **low for any individual scheme cell**; the earlier statement "every non-neutral scheme is worse" is withdrawn |
| 2 | Does the existing engine reward RB × OL, or style alignment? | **No.** RB × line is additive (interaction −0.9 ± 0.8 margin, −0.03 ± 0.11 yd/carry); aligned and anti-aligned styles give *identical* results (a clean negative control). [ENGINE, A] | High |
| 3 | Does skill-style alignment create measurable value? | **Yes, mostly by avoiding misalignment.** Aligned vs anti-aligned extreme styles: +2.8 ± 0.4 margin (elite units: +2.6 ± 0.4); a split RB/OL pair costs −1.2 ± 0.2; passing: aligned vs anti +1.0 ± 0.5. Realistic rosters (styles ≈ ±0.7 σ) earn ≈ +0.3 and risk ≈ −1.4 by choosing the opposite concept. [PROTOTYPE, A, D2] | Medium |
| 4 | Is quality × alignment **superadditive**? | **Not demonstrated.** Excess +0.40 ± 0.62 margin (+0.11 ± 0.08 yd/carry); the alignment gap does not grow measurably with unit quality (2.6 vs 2.8 ± 0.4) although the pre-sim calculation predicts ×1.5. [PROTOTYPE, A4] | Medium |
| 5 | Does fit-based construction beat highest-overall under equal spend? | **Small.** Real engine: +0.03 ± 0.12 (nothing to exploit). Prototype: +0.19 ± 0.18 (n.s.) at base weights, **+0.44 to +0.51 ± 0.22** when the buyer weights fit more strongly; vs a team that ignores identity: +1.0 ± 0.3. [ENGINE / PROTOTYPE, B] | Medium |
| 6 | Does scouting help, and where? | **Only where a rookie can displace an incumbent.** 24 basic reports targeted at positions of need capture ≈ 50% of the immediate rating gain of *perfect* information on all 260 prospects (+0.10 ± 0.03 vs +0.20 ± 0.03 rating). Scouting the top of the board: 0.00 ± 0.03. [HARNESS, C] | Medium (immediate rating only) |
| 7 | Do identity-matched game plans beat weekly counters? | **Yes.** The roster's natural concept: +0.3 ± 0.4; an opposite concept: −1.4 ± 0.4; switching to the "counter" every week: −0.35 ± 0.42. No fixed league-wide concept beats balanced (−0.5, −1.1). [PROTOTYPE, D2] | Medium |
| 8 | Does a sustained intelligent edge create unstoppable dynasties? | **No, up to about +2 rating.** +1 rating ≈ +0.8 wins and 0.51 titles/decade (fair share 0.31); +2 ≈ 1.7 wins, 0.87 titles, P(≥ 3 titles in 10 y) 6.7%; +3 ≈ 2.5 wins, 1.3 titles, 16%. [MODEL, E] | Medium (a model) |

**Overall reading.** The evidence supports *a package*, not a single mechanic. The largest effect measured is not new content at all: it is **removing the penalty on having an identity** (finding 1, ≈ 1–2 margin points). Scouting adds a real but modest edge (≈ 0.1 rating per draft at 24 points), and fit-based building adds ≈ 0.2–0.5 margin. Added together (an arithmetic sum of separately measured components, **not** a joint measurement) they put "intelligent management" at roughly 1 to 2 margin points (≈ 0.5–1 win per season) over highest-overall shopping — the same order as PR #105's perfect-information draft — while the elite-talent effect (a +10 QB ≈ 3.9 margin) remains larger than any single fit term.

---

## 1. Design of the experiments

* **Engine path.** Every game is `simulateGame` from `src/engine/sim.ts` on the 32 committed 2026 rosters (`NFL_POOL_PATH`), `overtime: "nfl"`, injuries on, no weather, no staff (except D1), talent 1.5. Experiment C uses the real class generator and the real draft/rating code of the UI state, with no games.
* **Prototype.** Style axes (six, from existing attributes) standardised within position group; quality factor `F(q) = clamp(1 + 0.8(q − q_ref), 0.3, 2)`; alignment with the coherence penalty centred on the 32 reference rosters; counters (stout/quick front, man/zone coverage) at a quarter of fit weight; weights `harness/proto-weights.json` (`runFit 0.14, counterRun 0.06, passFit 0.03, counterPass 0.015, covFit −0.03`), calibrated so that an extreme aligned offence vs an anti-aligned one is worth ≈ 2.5 margin points (a +10 QB is worth ≈ 3.9). Concepts are passed by `scheme_tags` on the QB (`zone|power`, `vertical|timing`) purely so the harness needs no change to `sim.ts`.
* **Two prototype defects found by diagnostics and fixed before the reported runs** (`harness/diag_fit.ts`): (i) style axes standardised against the whole player pool put every offensive line at −1.7 z ("drive") and saturated the term; now standardised within the position group; (ii) the alignment term had a negative mean that quality then multiplied, penalising good units; now centred (`A − A_ref`). Both are requirements recorded in DESIGN.md.
* **Edits in z-units.** Attribute edits (`harness/edits.ts`) are in z-units of the rating layer, so different attributes move comparably. Style edits are ±0.5 z on the plus/minus attribute groups; quality bumps are +0.8 z; "style-neutral" quality bumps raise both style groups equally so the style axis does not move.

---

## 2. Experiment A — synergy beyond additive talent

32 rosters × 24 matched reps (A) and × 40 (A4). Seeds `8_100_000 + team·10007 + rep·31`.

### A.1 Quality factorial (RB, run blockers, both)
| | [ENGINE] margin | yd/carry |
|---|---|---|
| RB +0.8 z | +1.32 ± 0.50 | +0.215 ± 0.068 |
| 5 run blockers +0.8 z | +1.42 ± 0.51 | +0.257 ± 0.068 |
| both | +1.88 ± 0.55 | +0.445 ± 0.071 |
| **interaction** (both − RB − OL) | **−0.86 ± 0.79** | **−0.03 ± 0.11** |

The current engine is additive-to-sub-additive for the brief's own example; there is no RB × line synergy to speak of (`runnerLine` weight 0.015).

### A.2 Style alignment, quality held constant (negative control and prototype)
| | [ENGINE] margin | [PROTOTYPE] margin | [PROTOTYPE] yd/carry |
|---|---|---|---|
| run: aligned (RB + line + concept agree) | +0.21 ± 0.19 | +0.28 ± 0.37 | +0.37 |
| run: anti-aligned (RB + line agree, concept opposite) | **+0.21 ± 0.19 (identical)** | **−1.24 ± 0.36** | −0.45 |
| run: RB and line disagree (any concept) | +0.42 ± 0.20 | **−1.18 ± 0.24** | −0.34 |
| pass: aligned | +0.59 ± 0.32 | +0.25 ± 0.33 | – |
| pass: anti-aligned | +0.59 ± 0.32 (identical) | −0.74 ± 0.33 | – |
| pass: QB and receivers disagree | +0.65 ± 0.22 | −0.58 ± 0.23 | – |

The identical engine rows prove the existing engine cannot see style or concept. The prototype separates them: the premium for aligned play is small and the penalty for misalignment is larger (the reference roster is mildly misaligned on average, so "typical" sits below "aligned").

### A.3 Elite quality and aligned style together (A4, style-neutral edits; 40 reps = 1,280 pairs)
| cell | [ENGINE] margin | [PROTOTYPE] margin |
|---|---|---|
| quality alone (RB + line +0.8 z, style unchanged) | +1.52 ± 0.43 | +1.46 ± 0.43 |
| style alone, aligned (base quality) | −0.21 ± 0.21 | +0.86 ± 0.41 |
| quality + aligned style | +1.85 ± 0.43 | **+2.72 ± 0.44** |
| quality + anti-aligned style | +1.85 ± 0.43 (identical) | +0.10 ± 0.33 |
| **superadditive excess** (quality + aligned − quality − style) | +0.54 ± 0.32 | **+0.40 ± 0.62** |
| alignment gap, elite units / base units | 0.00 / 0.00 | **+2.62 ± 0.44 / +2.79 ± 0.43** |

**Reading.** An aligned elite offence earns +2.7 margin against +0.1 for the same players run against their style: fit *matters*. But the interaction between quality and alignment is not measurably positive: the structure `F(q)·A` predicts the gap should grow ×1.5 with quality, and the pre-simulation fit shift does (0.47 → 0.70 yd/carry), yet the simulated gap grows only 0.74 → 0.87 yd/carry (×1.17) and not at all in margin. I have not isolated why (candidates: saturation in the rush-yards channel, noise: SE 0.44). **Update (see `REFINEMENT.md` §A):** with ~2,300 pairs per cell the quality × alignment interaction is detectable (+0.17 ± 0.06 yd/carry at talent 1.0, +0.29 ± 0.06 at 1.5); the A.3 result above was under-powered. Pure RB × line quality interaction is zero by construction in the prototype (mean-combined quality) and ≈ 0.02 yd/carry at best with a geometric combination. **The original wording was:** "I therefore do not claim \"elite RB behind elite OL beats the additive expectation\" for the prototype"; I claim "aligned elite units beat misaligned elite units by ≈ 2.6 margin". Whether to steepen `F(q)` (and accept more stacking risk) is an open question for the owner (see §9).

---

## 3. Experiment B — roster-building skill under equal resources

Each team, 40–60 reps: a market of 8 random league starters per offensive skill slot (QB, RB, WR×3, TE, OT×2, OG×2, C); prices follow overall and position only (the trade-chart form), so style is free.
* **H** buys the highest overall at every slot and runs the concept its players happen to fit ("natural").
* **F** picks an identity and, with *total* spend ≤ H's (Lagrangian knapsack, money can move between slots), buys by `quality + λ·alignment` (λ = 0.6 base).
* **B** has H's players and no declared concept.

| | [ENGINE] 1.5 | [PROTOTYPE] 1.5 | [PROTOTYPE] 1.0 | [ENGINE] 1.0 |
|---|---|---|---|---|
| **F − H** (margin) | +0.03 ± 0.12 | +0.19 ± 0.18 | +0.10 ± 0.23 | −0.26 ± 0.17 |
| F − B | +0.03 ± 0.12 | **+1.03 ± 0.26** | +0.06 ± 0.36 | −0.26 ± 0.17 |
| B − H | 0 (identical) | **−0.84 ± 0.23** | +0.04 ± 0.33 | 0 |
| mean overall of F's starters vs H | −0.13 | −0.13 | −0.13 | −0.13 |
| spend F − H (chart points) | −5.4 | −5.4 | −5.4 | −5.5 |
| pairs | 1,920 | 1,920 | 960 | 960 |

Sensitivity (prototype, talent 1.5, 1,280 pairs): weight scale ×2: F − H +0.24 ± 0.25, F − B +0.58 ± 0.34; ×3: +0.24 ± 0.24, +1.18 ± 0.36. Buyer's fit weight λ = 1.2: **F − H +0.44 ± 0.22**; λ = 2.4: **+0.51 ± 0.24**.

**Reading.** (1) The real engine offers nothing for the fit-builder (and F is not penalised for buying slightly lower overalls). (2) In the prototype the largest single effect is **adopting the identity your roster already fits (+0.84 ± 0.23 vs no identity)**: that is a coaching/identity decision, available to anyone who reads their roster, not a shopping edge. (3) Buying *for* fit adds a further +0.2 (base) to +0.5 margin (strong fit preference) at no extra spend, ≈ +0.1 to +0.25 wins per season. (4) At talent 1.0 the effects are weaker (n.s.). The stronger preference being better is itself informative: a player who ignores overall rating more aggressively gets more, up to the point where quality loss bites; the equal-spend frontier is flat near the middle, which is a good property (no cliff, and no single dominant way to shop).

---

## 4. Experiment C — scouting [HARNESS]

**Model.** `ê = E_pub + k·(ε + N(0, σ²))`, `ε = trueOverall − E_pub`, σ = 7 (basic, 1 point) and 3.5 (deep, 3 points), `k = τ²/(τ²+σ²)` with τ taken from the **measured** residual spread by public rank (6.6 for ranks 1–32 rising to 11.2; 9,600 prospects; DESIGN §1.1). 24 leagues (seeds 9701–9724), 11 treated teams each (every third team), 264 teams per arm; the other 21 teams draft with the real CPU logic; a treated team drafts by `(ê − 50)·POSITION_VALUE` with per-position caps; the metric is the team's `ratings.exact.overall` after the draft and rookie signing minus the same team in the control draft. Control = no treated team (CPU default). Same prospect-level report noise for every arm (a seeded function of league, prospect, tier).

| Arm | Points | Δ rating vs CPU control (SE) | **paired vs public** (SE) | Mean true rating of picks |
|---|---|---|---|---|
| public (visible board, caps, no scouting) | 0 | −0.12 (0.04) | – | 63.3 |
| basic, **top of board** | 24 | −0.14 (0.04) | −0.02 (0.03) | 63.3 |
| basic, near my picks ("window") | 24 | −0.13 (0.04) | 0.00 (0.03) | 63.3 |
| basic, value-of-information (position-weighted) | 24 | −0.13 (0.04) | −0.01 (0.03) | 63.6 |
| basic, random prospects | 24 | −0.07 (0.03) | +0.05 (0.03) | **65.3** |
| basic, **positions of need** | 24 | −0.02 (0.03) | **+0.10 (0.03)** | 63.8 |
| basic, need ∩ my pick range | 24 | −0.03 (0.04) | **+0.09 (0.03)** | 63.8 |
| deep, top of board | 24 (8 deep) | −0.13 (0.04) | 0.00 (0.01) | 63.3 |
| deep, value-of-information | 24 (8 deep) | −0.08 (0.04) | +0.04 (0.03) | 63.6 |
| deep, need | 24 (8 deep) | −0.11 (0.04) | +0.01 (0.02) | 63.3 |
| basic ×48 value-of-information | 48 | −0.14 (0.04) | −0.02 (0.03) | 64.2 |
| deep ×16 value-of-information | 48 (16 deep) | −0.11 (0.04) | +0.01 (0.03) | 63.5 |
| **perfect information on all 260** | – | **+0.08 (0.04)** | **+0.20 (0.03)** | **71.6** |

(`public` is −0.12 below the CPU control because the CPU's drafts also weigh team need and strategy, which the harness policy does not; the paired column removes that.)

**Reading.**
1. **Scouting the top of the board is worthless** (0.00 ± 0.03, 63.3 mean true rating): the public projection is already tight there (τ = 6.6) and those players are drafted by anyone. The "avoid the dominant top-N strategy" requirement is met *by the data*, not by assumption.
2. **The value is where a rookie could displace an incumbent starter**: need-targeted scouting captures about half of what perfect information on the whole class gives, with 24 basic reports (9% of the class).
3. **Breadth beats depth at equal points.** 24 basic reports beat 8 deep ones (+0.10 vs +0.01); a position-value-weighted "value of information" heuristic did *not* work (−0.01), because it ignores whether the rookie would start. The ★ suggestions in the UI must therefore be **need- and incumbent-aware**, not rank-based.
4. **Random scouting raises the mean true rating of the picks by +2.0 but not the team rating** (+0.05): it finds depth gems in late rounds that do not start in year one. This is real value for roster depth and for later years, which the immediate rating metric understates.
5. **Magnitude.** The best limited allocation is worth ≈ +0.1 rating per draft (the PR #105 conversion of roughly 1 rating point ≈ 1 win per season gives ≈ 0.1 win per draft, accumulating over several drafts); perfect information on everything is worth +0.2 immediately and ≈ +1 after three drafts (PR #105 X2). So a points-limited scouting system is worth *a fraction of a win per season*: real, bounded, and not a dominant strategy.

**Not measured.** The game-level (wins) effect of these arms (taken from PR #105's link, not re-run); the value of the *skill-profile* and *development* reports (they are not in the harness model: only the rating residual is); CPU use of scouting; fantasy-draft interaction (not applicable: veterans are fully visible).

---

## 5. Experiment D — schemes, counters, game plans

### D.1 What the existing coordinator-scheme mechanic does [ENGINE]
32 rosters × 16 reps, coordinator rating held at 50, scheme varied, versus the neutral scheme (`pro_style` / `multiple`), margin (SE), n = 512 per cell:

| Offence scheme | players with `scheme_tags` (pool-2026) | players **without** tags (default league, rookies) |
|---|---|---|
| west_coast | −0.86 (0.41) | −1.76 (0.64) |
| vertical | −0.01 (0.34) | −1.02 (0.58) |
| spread | −0.41 (0.41) | −2.01 (0.63) |
| power_run | −0.54 (0.39) | −1.14 (0.58) |
| zone_run | −1.07 (0.42) | −0.93 (0.63) |

Defence (four_three, three_four, cover_3, cover_2, man_press): −0.20, **+0.47**, +0.20, −0.32, −0.35 with tags; −0.54, −0.57, −0.71, −0.54, −0.87 without. Which offensive scheme is best for a team is not stable (split-half agreement 3 of 32, chance 5.3). **Corrected reading (see `REFINEMENT.md` §C):** the penalty is real and mechanical for *untagged* rosters, which is every default-league player and every rookie, and is largest for offence; for tagged rosters the fit term averages zero, so a distinct scheme is neither penalised nor rewarded on average (the negative tagged cells above are not distinguishable from noise: 0 of 5 offensive cells survive Holm adjustment). For a default league, the neutral scheme is therefore the dominant coordinator choice, and the identity decision is effectively absent. Cause: `scheme_tags` are empty for every default-league player and rookie; `schemeFitFraction` is then 0 against a baseline of 0.2–0.6 from the reference pool, a flat penalty (`offSchemeFitShift("zone_run", tagless)` = −0.21 yd/carry, −0.04 logits). Phase 0 of the roadmap fixes this.

### D.2 Concept strategies [PROTOTYPE], 32 teams × 24 reps vs a random opponent (n = 768; margin minus "balanced", SE)
| strategy | effect |
|---|---|
| natural concept (matches the roster's own styles) | +0.28 ± 0.44 |
| natural, leaning to the counter only where the roster has no preference | +0.06 ± 0.45 |
| **opposite concept** | **−1.39 ± 0.41** |
| weekly counter (concept chosen from the opponent's front/coverage) | −0.35 ± 0.42 |
| everyone zone + vertical | −0.47 ± 0.45 |
| everyone power + timing | −1.05 ± 0.43 |

By opponent front (stout n = 330 / quick n = 349): all-zone vs stout +0.48 ± 0.68, vs quick **−2.04 ± 0.66**; all-power vs stout **−1.07 ± 0.65**, vs quick −1.06 ± 0.63; natural +0.62 / −0.40.

**Reading.** No concept beats balanced as a league-wide choice (the "everyone runs X" strategy loses), the roster's own identity is the safe optimum, and a weekly counter loses to the cost of abandoning the roster's identity. The counter term is real (zone does better against stout than quick fronts) but small relative to fit, which is the intended ordering: *identity first, opponent second*. The prototype also shows what the UI recommendation must do: lean within the identity, not replace it.

---

## 6. Experiment E — multi-season outcomes [MODEL]

Rating dynamics fitted to PR #105's real-engine CPU leagues (X1; 8 leagues × 8 seasons, burn-in year dropped): AR(1) ρ = 0.592, stationary sd 2.17 rating points, margin per rating point 1.9 (≈ 1 win per rating point), NFL game sd 13.5, 7-team conference playoffs. A focal team gets a *permanent* edge of +a (an upper bound; in the game the edge must be re-bought every year). 4,000 simulated decades per row; the model reproduces the real-engine CPU league (best CPU team ≈ 2.1 titles per decade; X1 observed max 3 in 8 seasons).

| edge a (rating) | wins/season | titles per decade (fair 0.31) | P(≥ 3 titles in 10 y) | P(3 straight) |
|---|---|---|---|---|
| 0 | 8.5 | 0.32 | 0.8% | 0.2% |
| +0.5 | 9.0 | 0.42 | 1.4% | 0.3% |
| +1 | 9.3 | 0.51 | 2.3% | 0.3% |
| +1.5 | 9.8 | 0.67 | 4.0% | 0.7% |
| +2 | 10.2 | 0.87 | 6.7% | 1.0% |
| +3 | 11.0 | 1.32 | 15.8% | 3.4% |

**Reading.** An edge of +1 to +2 rating (≈ what the full package could plausibly deliver, §0) makes a team a regular playoff contender, not a dynasty: no more than ≈ 7% chance of three titles in a decade at +2, against ≈ 2.1 titles for the *best CPU team* by luck alone. Dynasty risk appears only at ≥ +3. This is a model and ignores that the edge decays when the roster ages; the real-engine confirmation is Phase 5.

---

## 7. Balance safeguards — status

| Safeguard (brief) | Evidence / status |
|---|---|
| Prevent runaway stacking | Extreme aligned-vs-anti gap 2.6–2.8 margin (QB +10 ≈ 3.9); realistic rosters ≈ 0.3–1.4; one concept per axis; `F(q)` clamped; fit enters tanh-capped channels. Raising all fit weights ×2 or ×3 left F − H at +0.24 (B sensitivity). **Unmeasured:** a full roster stacking every fit term at once (planned in Phase 3 acceptance). |
| Diminishing returns | Quality factor clamped at 2.0; alignment clipped at ±2 z; breadth > depth in scouting (C) |
| Viable alternative strategies | B: highest-overall equals fit-based within ±0.5 on the frontier; D2: no concept dominates; C: three allocation strategies are within noise of each other except the one that is worthless (top-N) |
| Avoid excessive RNG / determinism | Reports are deterministic per (seed, prospect, tier) but never exact (advanced ±4.3); fit terms are small relative to game sd 13.5 |
| CPU competition credible | Not tested in the engine; design gives CPUs the same scouting menu and an identity (Phase 5). Until then CPU rosters are fit-neutral and a human's fit edge is a pure gain (RISKS B8) |
| Elite individual players still matter | Quality alone still gives +1.5 margin per +0.8 z on the run units; fit adds to, not replaces, ratings. A +10 QB (3.9) > any fit term (≤ 2.8 at extremes) |
| Realistic **and** amplified talent | B at 1.0 and 1.5 (above); A, C, D at 1.5; effects are weaker at 1.0 (B: +0.10 ± 0.23). A and D at 1.0 were **not** run |

---

## 8. Limitations

* **The prototype is a model of the proposal.** Weights were calibrated to a target, not fitted to NFL data. Style axes depend on attribute generation (`attributeFit.ts`) and archetype boosts; the 2026 pool's styles differ from a long-evolved fictional league's.
* **Superadditivity is not demonstrated** (A.3); the quality factor may need to be steeper or the channel may saturate. Unisolated.
* **B's market is a stylised 8-candidate draw** with price = f(overall, position); real markets have contracts, ages and cap rules. The equal-spend frontier would be steeper in a market where style differences are larger.
* **C measures the immediate rating change after one draft**, not wins and not multi-season development; it omits skill/development reports and CPU scouting; effects are small relative to its SE (0.03).
* **E is a model**; **D1** uses coordinator rating 50 and no HC; **D2** uses pool rosters, not evolved leagues.
* No experiment has a human or a UI in the loop; the UI proposal is untested with players.
* Seeds and sample sizes: A 768 pairs/cell (A4 1,280); B 1,920 (960 at 1.0; 1,280 sensitivities); C 24 leagues × 11 teams; D1 512/cell; D2 768; E 4,000 decades per row.

---

## 9. Conclusions

### Recommended system
1. **Repair and then rely on the existing scheme mechanic** (derived tags, neutral when untagged). It is the largest effect in the study and the precondition for any identity decision.
2. **Add points-limited, need-aware scouting** with two tiers, deterministic reports that are never exact, measured priors by rank, CPU parity, and a ★ suggestion list that is *need- and incumbent-aware*. Expect ≈ +0.1 rating per draft for a careful player; communicate it as modest.
3. **Add skill-style fit (six axes from existing attributes) and team identities**, read-only first, engine second, flag-gated per league; keep counters small (a quarter of fit) so that identity dominates the weekly opponent.
4. **Tie coaching to execution** (`exec ∈ [0.6, 1.4]`) so a coordinator realises more or less of the available fit.
5. **Keep every fit term inside the existing saturating, centred channels**, and measure stacking explicitly before release.

### Evidence summary
Findings 1–8 above. Strongest: (1) the scheme penalty, (6) top-of-board scouting is worthless while need-targeted scouting recovers half the value of perfect information, (3) alignment is worth ≈ 2.6–2.8 margin at the extremes with a negative control that proves the engine cannot see it today.

### Unresolved questions
1. ~~Should `F(q)` be steepened?~~ Resolved in `REFINEMENT.md` §A: no; superadditivity (quality × alignment) is demonstrated at adequate n without changing weights; the owner decided not to raise multipliers.
2. Is a +0.1-rating-per-draft scouting edge "meaningful" enough, or should the budget/σ be more generous (B and C suggest the whole package is ≈ 0.5–1 win/season)? Owner decision.
3. Should the weekly counter be a visible lever at all, given D2 (−0.35 for an unconstrained counter)? Proposed: lean within the identity only.
4. Does the scouting value rise when skill-profile and development reports (not modelled) feed later fit and ageing? Needs an engine-level multi-season run.
5. How should CPU trade valuation price fit (RISKS X4)?
6. Talent 1.0 behaviour for A and D (not run).

### Recommended first implementation phase
**Phase 0 (repair scheme fit), immediately followed by Phase 1 (scouting).** Phase 0 is small, is supported by the clearest evidence in the study (a 1–2 margin-point penalty on specialising, currently in the shipped game), and unblocks identity; it needs explicit approval because it changes balance. Phase 1 is the best information gain per line of code, touches no simulation or validation baseline, and is purely additive for existing franchises. The engine fit terms (Phase 3) should wait until the read-only vocabulary (Phase 2) has been tested with players, and until the superadditivity question above is answered.
