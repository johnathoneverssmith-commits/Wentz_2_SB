# RISKS — balance, performance, compatibility, exploits

Companion to [DESIGN.md](DESIGN.md) and [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md). "Evidence" points to [EXPERIMENTS.md](EXPERIMENTS.md). Likelihood/Impact are the author's judgement (L/M/H).

## 1. Balance

| # | Risk | L | I | Evidence / mitigation |
|---|---|---|---|---|
| B1 | **Synergy stacking** makes fit-built rosters unbeatable | M | H | Fit is `exec·Q(q)·A` through channels that already `tanh`-saturate and are reference-centred; one concept per axis; weights set so that a fully aligned elite offence is worth ≈ +2 margin vs ≈ 3.9 for a +10 QB. Measured: extreme aligned-vs-anti gap 2.6–2.8 margin, realistic rosters ≈ +0.3 / −1.4. Acceptance: gap ≤ 3 in the extreme cell, a full-stack roster (every fit term aligned at once) ≤ 4. |
| B2 | **One dominant identity** (e.g. everyone runs Power Running because the pool's fronts are skewed stout) | M | H | The first prototype standardised style against the whole player pool, which skewed fronts stout (376 of 768 matchups stout, 33 quick) and put every offensive line at the clamp; standardising within the position group fixed it (330 stout / 349 quick). Production must standardise within position group (DESIGN §2.1) and D2 must be re-run per identity per opponent type. Acceptance: no identity beats "balanced" by > 0.5 margin averaged over opponents unless the roster is built for it. |
| B3 | **Scouting becomes mandatory busywork** (everyone must scout, no real choice) | M | M | Value of a report is concentrated in a few prospects and depends on pick position and need (Experiment C); a flat 30 points plus a ★ suggestion list keeps the decision to ≈ 10 taps. If top-of-board scouting dominated, re-price by rank (see DESIGN §1.5). |
| B4 | **Scouting too strong or too weak.** Perfect information on all 260 prospects is worth ≈ +1 win/season after 3 drafts (PR #105); a points-limited team should capture a fraction | M | M | Cap total capturable value by points, report σ and shrinkage; assert in regression test that `perfect − advanced(all)` > 0 and `advanced(30 points) < 50%` of perfect. |
| B5 | **Elite individual talent devalued** | L | H | Fit adds to, never replaces, the linear/rating layer. Test: +10 QB still worth ≥ 2× the largest fit term; the "highest-overall" roster remains ≥ as good as a fit roster when the fit roster is ≥ 3 overall points worse (Experiment B). |
| B6 | **Lock-in / snowballing** of a good-fit team into a dynasty | L | H | Fit is a *level* edge (not compounding) and decays if the roster ages out; Experiment E (model) shows a sustained +1 rating edge is worth ≈ +1 win/season and < 1 extra title per decade; hard cap on total fit. Re-check with the real longitudinal harness before release. |
| B7 | **Talent-impact interaction.** Fit terms are roster-driven shifts and must scale with `talentScale` like synergy | M | M | Pass `talentScale` through the new terms (they live in `synergyShift`, which `talentScale` already multiplies); run A–D at Realistic 1.0 and Amplified 1.5 (done for B; see EXPERIMENTS). |
| B8 | **CPU becomes less credible** (CPU rosters ignore identity, so humans out-fit them trivially) | H | M | Phase 5 teaches CPU GMs an identity (derived from their coordinator and roster) and the same scouting menu. Until then CPU teams are fit-neutral and a human's fit edge is a pure gain; the roadmap gates release on this. |
| B9 | **Counters punish a good plan** (weekly swings) | M | M | Counter weights are a quarter of fit weights; D2 shows abandoning the roster's identity for a weekly counter loses. Recommendations lean *within* the identity. |

## 2. Information and exploit risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| X1 | **Re-roll exploits**: scout, reload, scout again for a different report | M | M | Reports are a pure function of `(league seed, prospect id, tier)`: identical on every machine and every reload; nothing to re-roll. |
| X2 | **Information leak** between GMs (multiplayer) | M | H | Reports are private per team (same treatment as the existing hidden `potential`, see `online/test/potential-privacy.test.ts`); server computes reports and returns only the requesting GM's. The seed-derived function is never shipped to the client in online play; in single-player it is client-side and therefore inspectable (acceptable: single-player). |
| X3 | **Reverse-engineering hidden ratings** from repeated tiers (basic + advanced average) | M | M | Advanced report *includes and replaces* basic (not independent), `σ_advanced ≥ 3.5` is a floor, and no tier reveals attributes at finer than 5-point bands. Regression test: the best estimator using every available report has error ≥ 3 rating points. |
| X4 | **CPU asymmetry**: CPU trade valuation ignores fit, so a human buys stars that "fit badly" for the CPU and flips them | M | M | CPU valuation needs a fit term in Phase 5; until then fit-based trade arbitrage is bounded by the existing friction and the deadline window (PR #105 X3). |
| X5 | **Contract-dump interaction** (PR #105 STRAT-002): cheap fit acquisitions plus free dumps make mistakes free | M | M | Independent of this design; fix first or at least track (R2 of PR #105). |
| X6 | **Public information is gamed** (CPU "tanking" the displayed grade) | L | L | The college grade is demoted, not removed; no mechanic reads it other than display. |

## 3. Compatibility

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| C1 | **Existing franchises change under their feet** | H | H | The engine fit terms ship behind a league-level flag (`synergyModel`) stored in `LeagueConfig`, absent = current engine, byte-identical, exactly like `talentImpact`. New leagues default to v2; existing leagues keep v1 until the owner opts in. A replay at a different model is a different game, so the flag must be passed on **every** simulation and replay (adapter, both playoff endpoints, viewer broadcast, online block calls). |
| C2 | **Save schema** | L | M | Only optional fields (`scouting?`, `config.synergyModel?`). No `CURRENT_SAVE_VERSION` bump required (absent ⇒ default). `upgradeLeagueState` (idempotent, runs on every online read) can backfill; no SQL migration (state is JSONB). |
| C3 | **Multiplayer fairness during rollout** | M | H | Flag is per league and fixed for the league's life; mixed-version clients get the same server-computed reports; commissioner can opt a league in at a season boundary only. |
| C4 | **Byte-identical validation paths** (§22/§23, `engine-realism.test.ts`, `passing-volume.test.ts` baseline) | M | H | New terms are zero when no concept is declared and the model flag is v1; the statistical baseline is re-measured on seeds 101–124 in the same commit as any deliberate change (CLAUDE.md rule). |
| C5 | **Derived scheme tags** change `staff-fit` outcomes for existing leagues | M | M | Phase 0 changes balance (D1 shows today's penalty) and therefore needs explicit approval and its own regression run; flag-gated like C1 if the owner wants existing leagues untouched. |
| C6 | **How It Works must stay true** | H | L | Mandatory text update in the same commit as each mechanic (CLAUDE.md). |

## 4. Performance

| # | Risk | Mitigation / measure |
|---|---|---|
| P1 | Style axes add ~25 attribute reads per lineup per play | They are computed per lineup and cached by lineup identity exactly like the current `cachedOffense/cachedDefense`; prototype A–D ran at the same wall-clock rate as baseline (≈ 22 s per 640 games). Budget: ≤ 5% slowdown on `simulateGame`. |
| P2 | Scouting preview replays `fittedAttributes` for ≤ 30 prospects | Trivial (microseconds each); computed on demand, never stored. |
| P3 | Recommendation panel runs 160 paired sims | Already how plan preview works; the cheap style-axis pre-filter limits it to one lean per request. |
| P4 | Online server (stateless block simulation) | No new persistent per-play state; scouting reports are returned per request; `league_state` JSON grows by < 2 KB per team per year. |

## 5. UX risks

| # | Risk | Mitigation |
|---|---|---|
| U1 | Too much new vocabulary | Four words by default; Advanced toggle; usability checks in UI-PROPOSAL §5. |
| U2 | Scouting adds tedium to a draft that already takes many taps | ≤ 2 new tasks per offseason, no new gates; ★ suggestions; "Auto-scout for me" option that spends points by the CPU heuristic. |
| U3 | Explanations over-promise (a chip says "Good fit" and the team loses) | Always show ranges and a luck line; calibrate recommendation confidence to the preview's own SE. |
| U4 | Fit chips punish unconventional rosters | Poor fit is advice, not a block; a mixed roster pays a small bounded penalty, never a catastrophe. |

## 6. Honest limits of this evidence

* The synergy terms are a prototype with weights calibrated to a target, not fitted to NFL data; effect sizes are predictions.
* Experiment E is a model, not an engine run.
* Scouting was validated at the draft (rating of the roster after signing) and against PR #105's game-level link; a full multi-season engine run with scouting was not done.
* The UI proposals are untested with players.
