# REFINEMENT — superadditivity, long-term scouting, scheme-fit wording, acceptance criteria

Follows owner decisions on PR #107. No production code is changed. Labels: **[ENGINE]** unmodified engine; **[PROTOTYPE]** engine + `harness/synergy-proto.patch` (a prediction, not an engine fact); **[EXACT]** noise-free calculation of the model's own shift; **[HARNESS]** real draft/aging code with a scouting model that exists only in the script; **[PROJECTION]** arithmetic from measured parts. Weights were **not** changed in any experiment below (`harness/proto-weights.json`); nothing was tuned toward an outcome.

## A. Why was the RB × line interaction "not distinguishable from zero"?

**Design.** 2×2×2 factorial on all 32 rosters, matched seeds and opponents: RB quality {average, elite +1.0 z} × line quality {average, elite +1.0 z} × style {aligned, mismatched; same players, only the declared concept differs}. Quality bumps are style-neutral. Interaction = c(1,1) − c(1,0) − c(0,1) + c(0,0), measured directly. Run at talent 1.0 and 1.5, in yards per carry (low-noise) and margin. `harness/diagA_factorial_shift.ts` (exact) and `harness/expA2_factorial.ts` (simulated), analysis `analyze_A2.py`.

**Three separate questions were conflated in the first report.**

| Interaction | [EXACT] yd/carry, current model | [PROTOTYPE] simulated yd/carry (talent 1.0 / 1.5; ~2,300 pairs) | [ENGINE] simulated (1.5; 2,400 pairs) |
|---|---|---|---|
| **RB × line quality** (aligned) | **0.000 ± 0.004** (zero by construction) | −0.003 ± 0.055 / +0.052 ± 0.057 | +0.010 ± 0.056 |
| RB × line quality (mismatched) | +0.004 | +0.059 ± 0.047 / +0.033 ± 0.049 | +0.010 ± 0.056 |
| **Quality × alignment** (both elite vs both average, aligned minus mismatched) | **+0.26** (after saturation; +0.29 before) | **+0.174 ± 0.057 / +0.286 ± 0.061** (3.0σ / 4.7σ) | 0 (engine cannot see style) |
| Same, margin | – | +0.89 ± 0.44 / +0.94 ± 0.45 | 0 |
| alignment gap, average RB + line → elite RB + line (margin) | – | +1.5 → +2.4 / +2.3 → +3.2 | 0 |

**Findings.**
1. **RB × line quality interaction is zero by construction in the prototype, not by chance.** Fit multiplies a quality factor `F(mean of RB z and line z)`; `F` is linear in that mean, so c(1,1) − c(1,0) − c(0,1) + c(0,0) = 0 exactly (measured 0.0004 ± 0.0044). The engine's own RB × line term (`runnerLine`, weight 0.015) contributes +0.011 yd/carry exact, which is undetectable (+0.010 ± 0.056 simulated).
2. **Quality × alignment superadditivity is real and detectable once powered.** The earlier test (1,280 pairs, SE 0.62 margin) was under-powered for an effect of +0.9 margin; at 2,250–2,325 pairs the yd/carry interaction is +0.17 (3σ) at talent 1.0 and +0.29 (4.7σ) at 1.5, the same order as the exact calculation (+0.26 yd/carry before any talent scaling; the simulated value is lower at 1.0 and higher at 1.5, and I have not reconciled the talent scaling exactly). The earlier "alignment gap does not grow with quality" was noise; it grows 1.5 → 2.4 margin (1.0) and 2.3 → 3.2 (1.5).
3. **Saturation is not the cause.** The rush-yards channel cap is 1.4 yd/carry; the largest pre-saturation shift of any team in the factorial is 1.0, and `tanh` keeps 93% of the elite-aligned value (post/pre = 0.933). Effect on the interaction: −10% (0.287 → 0.257).
4. **Quality normalisation was the cause of finding 1.** Combining the two units' qualities by their *mean* makes them perfect substitutes. Alternatives, tested exactly (+1 z both units, aligned): geometric mean of the two unit factors +0.018 ± 0.003; product (clamped at 2.5) +0.012 ± 0.018 (the clamp binds and cancels it); weakest-link `min` +0.089 ± 0.012 (but −0.077 when mismatched, and an elite RB with an average line gains nothing, which contradicts "elite individual players remain valuable"). Simulated geometric mean: RB × line +0.078 ± 0.075 (talent 1.0), +0.083 ± 0.074 (1.5): not distinguishable from zero, as expected for a 0.02 yd/carry effect.
5. **Positional weighting.** The line enters as a mean over five players; in the factorial all five are bumped equally, so weighting cannot matter there. It would matter for a single elite tackle on an average line (diluted to one fifth); that is the existing weak-link cohesion term's job, not the fit term's.
6. **Talent 1.0 vs 1.5.** All fit shifts scale with `talentScale`; the interaction roughly scales with it (+0.174 → +0.286 yd/carry). At 1.0 the margin-scale interaction is only 2σ.

**Smallest justified adjustment (proposal, not implemented; no weight increase):** combine the RB and line quality factors **geometrically** (`F = sqrt(F_RB · F_line)`, each clamped to [0.3, 2]) instead of by the mean of z. It is *identical* when the two units are equally good (so league calibration and the balanced-roster results do not move), and gives a small positive RB × line term (+0.018 yd/carry exact) when one is stronger. It does not and should not be expected to produce a large RB × line effect: with weights set by the stacking limit, the pure RB × line complementarity available is ≈ 0.02 yd/carry (≈ 0.1 margin). **The demonstrable complementarity is style alignment × unit quality (+0.17 to +0.29 yd/carry ≈ +0.9 margin), not RB × line quality.** If the owner still wants a larger RB × line term, that requires a larger weight (rejected by decision 5) or the `min` form (rejected by the elite-player criterion).

**Resolved:** why the interaction was missed (zero by construction for RB × line; under-powered for quality × alignment); saturation excluded; talent 1.0 and 1.5 behaviour. **Needs production to test:** interaction under full-season play, evolved leagues, and with staff execution factors.

## B. Does scouting development and skill profile add long-term value?

**Design [HARNESS].** 24 leagues (seeds 9801–9824), 11 treated teams each; real class generator, CPU drafts for the other 21 teams, and the real aging model (`applySeasonAging`) run for five offseasons. Teams are otherwise static (no free agency or retirement), so differences come only from the draft class. A **development report** reveals the hidden draw behind a rookie's `potential` (replayed exactly from the rookie's own RNG stream; verified equal to the signed player's potential) with the same cost (24 basic reports at positions of need) and noise (σ = 1 sd, k = 0.5) as the rating report. Policy horizon = rating estimate + 0.458 × estimated development gap (the measured 3-year slope; `expB2_pre.json`, 2,560 rookies: 3-year change correlates r = 0.65 with the gap; slope 0.22 / 0.46 / 0.53 at 1 / 3 / 5 years). Arms: R (rating reports), D (development only), RD (both for the same 24 reports), and perfect versions.

Rating of the treated team minus the same team in the control draft, paired difference vs the reference arm (SE), rating points:

| Contrast | year 0 | year 1 | year 3 | year 5 |
|---|---|---|---|---|
| R24 − public (rating reports) | +0.126 (0.035) | +0.152 (0.040) | +0.160 (0.050) | **+0.192 (0.062)** |
| **RD24 − R24** (adding development reports) | −0.019 (0.028) | +0.009 (0.030) | +0.029 (0.036) | **+0.019 (0.044)** |
| D24 − public (development only) | +0.004 (0.026) | +0.019 (0.032) | +0.013 (0.041) | +0.015 (0.050) |
| Rperf − public (perfect rating info, upper bound) | +0.248 (0.040) | +0.372 (0.046) | +0.601 (0.061) | +0.820 (0.074) |
| **RDperf − Rperf** (perfect development info on top) | −0.065 (0.032) | −0.044 (0.038) | +0.047 (0.052) | **+0.081 (0.059)** |

Share of the 21 starting slots held by a team's own draft class: 5.6% (year 0), 8.4% (year 3), 10.2% (year 5).

**Findings.**
1. **Rating reports have a long-term purpose already:** the 24-report benefit persists and grows (+0.13 → +0.19 over five years), and the perfect-information upper bound roughly triples (+0.25 → +0.82) as a draft class takes a larger share of starting slots.
2. **Development reports add no measurable value within five seasons** (RD − R: +0.02 ± 0.04 at year 5; development-only: +0.02 ± 0.05). Even *perfect* development information adds only +0.08 ± 0.06 (n.s.) at year 5. Mechanism: the development gap moves a rookie's 3-year rating by ≈ 2 points (sd 4.35 × 0.46), against a rating residual of ≈ 10 points, so there is about a twentieth as much to learn; and rookies are ~8% of starters.
3. **Skill-profile reports [PROJECTION].** The only mechanism by which profile information could pay is fit-based buying. Measured fit-based-buying edge: +0.19 ± 0.18 to +0.51 ± 0.24 margin when *every* starter slot is bought by fit (Experiment B); rookies fill ≈ 8–10% of starting slots after 3–5 years. Projected value ≈ 0.1 × 0.2–0.5 ≈ **0.02–0.05 margin per season**, below anything detectable. Not tested in the engine because it requires production fit terms.

**Recommendation.** Do **not** add separate paid tiers for development or skill profile, and do not raise report accuracy or budgets. Keep one rating-oriented report with need-aware targeting. Show a **free, coarse "growth" label and role/style label derived from the same report** for readability and to teach the vocabulary; present them as information, not as an advantage. **Resolved:** long-term value of rating scouting (yes, growing); added value of development and profile information (no measurable value in five seasons). **Needs production to test:** profile information once fit terms exist; interaction with training camp coaching, contracts and free agency (not in this harness).

## C. Correction to the scheme-fit claim

`EXPERIMENTS.md` finding 1 previously said every non-neutral scheme is worse. **Withdrawn and replaced.** Evidence (`data/expD1_ci_summary.txt`, `data/diagD1_exact.json`):

* **Mechanism [EXACT].** For rosters with no `scheme_tags` (every default-league player and every rookie), a non-neutral offensive scheme loses 0.124–0.257 yd/carry and 0.025–0.051 completion logits; a non-neutral defensive scheme concedes 0.076–0.125 yd/carry and 0.015–0.025 logits. For tagged rosters the league-mean fit effect is **zero by construction** (the baseline is the league mean).
* **Simulation [ENGINE], n = 512 pairs per cell, 20 cells, Holm-adjusted:**

| | untagged rosters | tagged rosters |
|---|---|---|
| Offence | mean −1.37; 5/5 negative; 2/5 nominally significant; **1/5 after Holm** (spread −2.01 [−3.25, −0.78]) | mean −0.58; 5/5 negative; 2/5 nominal; **0/5 after Holm**; not explained by the fit term (exact mean 0), so treated as noise |
| Defence | mean −0.64; 5/5 negative; **0/5 significant** | mean −0.04; 3/5 negative; **0/5 significant**; `three_four` +0.47 [−0.26, +1.21] |

* **Correct statement.** The penalty on specialising is mechanical and certain for untagged rosters, strongest on offence; it is small on defence and not distinguishable from zero in simulation; for tagged rosters there is no average penalty. "Every non-neutral scheme is worse" is **not** supported. The Phase 0 case rests on the untagged mechanism (a default league cannot benefit from a distinct scheme) rather than on per-scheme simulated margins, and the split-half result (best scheme per team is not stable, 3 of 32) is not evidence of anything beyond noise.

## D. Refined implementation acceptance criteria

Each criterion states how it is tested, and whether it is a **gate** (must pass to ship) or a **monitor**. Thresholds are design targets from the prototype, not demonstrated production results.

1. **Complementary players create an advantage beyond additive talent.**
   * Gate (exact unit test, noise-free): quality × alignment interaction in the rush-yards shift ≥ +0.15 yd/carry at +1 z and a sign-correct, non-negative RB × line term (≥ +0.01 yd/carry with the geometric combination).
   * Gate (simulation, ≥ 2,300 pairs per cell, talent 1.0 *and* 1.5): the yd/carry interaction ≥ +0.10 with 95% CI above 0; aligned − mismatched gap for elite units 1.5–3.5 margin.
   * Not a gate: any simulated RB × line quality interaction (undetectable at ≈ 0.02 yd/carry).
2. **Elite individual players remain valuable.** Gate: a +10 QB remains ≥ 3 margin (PR #95: 3.9) and ≥ 1.5× the largest fit term; rating-layer outputs are byte-identical between models for teams that declare no concept; a fit-built roster beats a highest-overall roster by at most 1.0 margin under equal spend (prototype +0.19 to +0.51). The `min` combination is excluded because an elite RB with an average line would gain nothing from fit.
3. **No identity universally dominant.** Gate: for each of the 6 offensive and 3 defensive identities, margin vs balanced averaged over all 31 opponents ≤ +0.5 unless the roster is built for it; a league-wide fixed identity ≤ 0 vs balanced; each concept has at least one opponent type (front/coverage tercile) where it is negative. Counters stay a quarter of fit weight; the prototype showed that a weekly counter that abandons identity loses (−0.35).
4. **CPU teams compete on equal informational terms.** Gate: CPU scouting points ≤ the human maximum at every difficulty; CPU draft code reads only `scoutReport` output (static test: no CPU path reads `trueOverall` or the hidden potential); Master has the same information as Expert; the CPU uses the same report function and seeded noise. Monitor: CPU/human edge from scouting within the measured ≈ +0.1 rating per draft.
5. **Existing leagues keep their previous mechanics unless explicitly migrated.** Gate: absent `config.synergyModel` / `config.schemeFitModel` / `scouting` ⇒ today's engine, byte-identical on golden games (a recorded multi-week replay) and on `engine-realism`, §22/§23 and `passing-volume` baselines; flags can only change at a season boundary by an explicit commissioner/owner action; every simulation and replay path receives the league's stored flag; Phase 1 scouting for the current class is additive and optional.
6. **Read-only fit indicators are never presented as active bonuses.** Gate: until the league runs `synergyModel: "v2"`, every fit indicator carries the fixed label **"Style match (information only; does not change game results yet)"**, uses a visually distinct (outlined) treatment, shows no predicted margin or percentage, and `howItWorks.ts` says the same; a UI test asserts the label is present whenever `synergyModel !== "v2"` and absent claims such as "+x%". When v2 is on, the label changes to describe the actual effect with its range.

## E. Final recommendations

**Demonstrated effects (with their evidence)**
* Phase 0: for untagged rosters, a distinct offensive scheme mechanically loses 0.12–0.26 yd/carry and 0.025–0.05 logits; tagged rosters average zero [EXACT, ENGINE]. Repairing it removes a trap and restores the identity choice; the size of the recovered effect in margin is ≈ 1–2 on offence (untagged, simulated, wide intervals).
* Scouting: top-of-board scouting yields nothing; need-targeted basic reports yield +0.13 rating at the draft, growing to +0.19 ± 0.06 after five seasons; development and skill reports add nothing measurable [HARNESS].
* Fit: style alignment × unit quality is superadditive and detectable (+0.17 to +0.29 yd/carry; ≈ +0.9 margin); aligned vs mismatched elite units differ by 2.4–3.8 margin; fit-built roster ≈ +0.2 to +0.5 margin over highest-overall [PROTOTYPE].

**Proposed design targets (not demonstrated in production)**
* Geometric combination of unit quality factors; the acceptance gates above; per-league flags; need-aware ★ suggestions; coarse free growth/role labels; informational-only indicators until v2.

**Resolved questions:** the cause of the missed interaction; saturation excluded; talent 1.0 vs 1.5 behaviour; long-term value of rating scouting; (non-)value of development and profile tiers; correct scope of the scheme-fit claim.

**Questions that require production implementation to test:** RB × line complementarity beyond ≈ 0.02 yd/carry; quality × alignment under evolved leagues and real coordinators (execution factor); CPU identity adaptation and trade valuation of fit; scouting effect on wins over multi-season leagues with free agency; profile information once fit exists; stacking when every fit term is aligned at once.

**Recommended order:** Phase 0 (with the existing-franchise flag) → Phase 1 scouting (need-aware, points-limited, one report type) → read-only indicators with the informational label → engine fit behind `synergyModel` with the geometric combination → UI → CPU adaptation.
