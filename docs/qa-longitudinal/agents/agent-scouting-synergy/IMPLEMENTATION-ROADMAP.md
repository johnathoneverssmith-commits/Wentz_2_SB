# IMPLEMENTATION ROADMAP

Status: proposal. **Nothing here is approved or built.** Each phase changes production code, balance constants or save shape and therefore needs separate explicit approval (CLAUDE.md). Mechanics: [DESIGN.md](DESIGN.md). Evidence: [EXPERIMENTS.md](EXPERIMENTS.md). Risks: [RISKS.md](RISKS.md).

## 0. Ordering and why it differs from the brief

The brief lists scouting → interactions → schemes → UI → balancing. The evidence supports a different first step and one reordering:

* **Phase 0 (new, small, first): repair the scheme-fit mechanic.** Today every drafted rookie and every player in a default league has `scheme_tags = []`, and a non-neutral coordinator scheme is *always* worse than the neutral one (D1: −0.9 to −2.0 margin points offensively with no tags, −0.0 to −1.1 even with them). Anything built on schemes is built on a trap until this is fixed.
* **Scouting (Phase 1) stays early** because it is the largest *information* gain per line of code, is engine-independent, and can ship without touching simulation or any validation baseline.
* **UI read-only fit chips move ahead of the engine change** (Phase 2 before Phase 3): the style axes can be shown before the engine rewards them; the engine change is the riskiest step and should come after the vocabulary is proven comprehensible.

| Phase | Name | Touches sim? | Touches saves? | Needs approval for |
|---|---|---|---|---|
| 0 | Repair scheme fit | engine (staff-fit) | no | balance change |
| 1 | Scouting information and prospect evaluation | no | optional field | gameplay rule |
| 2 | Style axes and read-only fit chips | no | no | UI |
| 3 | Fit synergy, identities and counters in the engine | **yes** (flagged) | config flag | balance change |
| 4 | Scouting UI, identity card, recommendations and feedback | no | no | UI |
| 5 | CPU adaptation, multi-season balancing, regression, rollout | yes (tuning) | no | balance change |

## Phase 0 — Repair scheme fit

* **Modules.** `src/engine/staff-fit.ts` (`schemeFitBaseline`, `offSchemeFitShift`, `defSchemeFitShift`), `src/engine/staff.ts` (`OFF_SCHEME_TAGS`, `DEF_SCHEME_TAGS`, `schemeFitFraction`), `ui-source/src/state/rules.ts` (`upsertRookiePlayer` sets `scheme_tags: []`), mirror `analysis/engine/staff_fit.py`.
* **Change.** Derive each player's scheme tags on read from `archetype` + style axes (a function `tagsFor(player)`; never stored), and make an empty tag list *neutral* (zero fit, not "zero fit against a baseline of 0.3–0.6"). Option B (smaller): centre the fit on the league's own current mean instead of the 2026 reference pool.
* **Data.** None stored. Pure function of existing fields.
* **Saves.** None. Behaviour changes for existing leagues → ship behind `config.schemeFitFix` default off for existing leagues, on for new (same pattern as `talentImpact`).
* **CPU.** CPU staff already carry schemes (32 authored v0 staffs); their fit becomes real. Re-run `coach-effects.test.ts`, `coachScale.test.ts`.
* **Tests / criteria.** Re-run `harness/expD_schemes.ts D1`: every scheme's margin vs neutral within ±0.5 on a tagless roster, and a roster built for its scheme gains ≥ 0.5 over neutral. `engine-realism.test.ts` unchanged; `leagueAverageStaff` remains an exact no-op. Python mirror updated and parity-tested.
* **Risk / complexity.** Low–medium risk, **S–M**. Any coach already hired on a non-neutral scheme gets better in existing leagues if the flag is turned on.

## Phase 1 — Scouting information and prospect evaluation

* **Modules.**
  * `ui-source/src/domain/draft.ts` — `DraftProspect` unchanged; add types `ScoutTier`, `ScoutReport`, `ScoutingState`.
  * new `ui-source/src/state/scouting.ts` — `scoutReport(state, prospectId, tier)` (pure; seeded by `(league seed, prospect id, tier)`), `publicProjection` (= `expectedRatings`), `posterior(ê, s, band)`, `spendPoints`, `defaultPoints(difficulty)`; replays the same `Rng(fnv(prospectId))` draws as `upsertRookiePlayer` so previewed skills equal signed skills in expectation.
  * `state/draftBoard.ts` — `expectedRatings` stays the public layer; a new `effectiveRatings(prospects, scouting)` swaps scouted estimates in.
  * `state/rules.ts` — `planAutopicks` / `runAiPicks` read `effectiveRatings` for each CPU team's own scouting.
  * CPU spend: new step before `runAiPicks` in `onStageEntered` (`online/src/phases.ts`) and the local equivalent; heuristic = **need- and incumbent-aware** targeting (Experiment C: rank- or position-value-based VOI did not work), points by difficulty.
  * `aiDifficulty.ts` — points per level (Casual 12 … Expert/Master 36).
* **New data.** `LeagueState.scouting?: { season: number; points: Record<team, number>; reports: Record<team, Record<prospectId, ScoutTier>> }`. Only *which tier was bought* is stored; report contents are recomputed (so there is no noisy data to keep consistent and none to tamper with). Absent ⇒ every prospect is public ⇒ identical to today.
* **Saves.** Optional field; no `CURRENT_SAVE_VERSION` bump; `upgradeLeagueState` initialises `scouting` for the current class when absent. Online: JSONB, no SQL migration; `online/src/actions.ts` gains `scout(prospectId, tier)` (validated server-side: stage, budget, tier upgrade rules, idempotent).
* **Multiplayer.** Reports are private to the buying team; `privacyView.ts` strips other teams' `reports` and any computed estimate (same discipline as the hidden `potential`). Cost accounting is per GM.
* **Tests / criteria.**
  * Calibration: over ≥ 5,000 prospects the 80% range contains the truth 78–82% of the time at each tier.
  * Never exact: best estimator using all available reports has RMSE ≥ 3 rating points.
  * Determinism: same inputs → same report; reload/replay identical; reports never contradict the signed player's profile (preview vs `upsertRookiePlayer`, seeded).
  * Value: Experiment C acceptance (below): scouted arms beat public by a stated margin; no allocation strategy (top-of-board, random) beats the VOI/need strategies.
  * `draftSupply`, `draftOrder*`, `rookieBoard-determinism` and `draft-completion` suites unchanged; fantasy draft untouched.
  * `potential-privacy`-style test for reports; `howItWorks.test.ts` updated.
* **Risks / complexity.** Medium (UI state + online action + CPU step); **M**.
* **Acceptance (Experiment C, re-run on the implementation).** Points-limited (24 basic reports) need-targeted scouting captures 30–60% of the immediate rating benefit of perfect information (prototype: +0.10 ± 0.03 of +0.20 ± 0.03); top-of-board scouting yields ≈ 0 (measured 0.00 ± 0.03); breadth (basic) beats depth (deep) at equal points; CPU Standard/Expert teams with scouting beat their un-scouted selves by a margin consistent with their points.

## Phase 2 — Style axes and read-only fit chips

* **Modules.** new `ui-source/src/state/styleAxes.ts` (the six axes of DESIGN §2.1 as pure functions of a player; TS-only, reuses `attributeZ` via the engine's `ratings.ts` constants), `state/identity.ts` (identity ↔ `OffScheme/DefScheme` mapping), components for Fit chip and explanation; `RosterCapManagement`, `DraftRoom`, `FreeAgencyBoard`, `TradeProposal`.
* **Data / saves.** None (derived).
* **CPU.** None.
* **Tests.** Unit tests for each axis (monotonic in the right attributes; archetypes land on the intended side: "Power back" ⇒ run style < 0, "Speed back" > 0, …); no engine effect (this phase does not change a single simulated game).
* **Risk / complexity.** Low; **S–M**. Its purpose is to prove the vocabulary before the engine rewards it, and to give players the chips in the fantasy draft where highest-overall vs best-fit is a live choice.

## Phase 3 — Fit synergy, identities and counters (engine)

* **Modules.** `src/engine/synergy.ts` (new `protoOffense/Defense/Counter` terms become `fitOffense/fitDefense/counter`; weights in `SYNERGY_WEIGHTS` and saturation), `src/engine/staff*.ts` (execution factor), `src/engine/team-strength.ts` (centre fit in the strength index), `src/engine/gameplan.ts` (identity leans), TS-only (no Python mirror, like synergy). The prototype patch is `harness/synergy-proto.patch` (≈85 lines).
* **New data.** `LeagueConfig.synergyModel?: "v1" | "v2"` (absent = v1 = today's engine, byte-identical). The identity is the coordinator's existing `scheme`, so no new state; the QB-tag convention of the prototype is replaced by passing `staff` into `synergyShift`.
* **Saves / franchises.** Flag-gated per league; existing leagues stay on v1 until the commissioner opts in at a season boundary. Passed on **every** simulation and replay (adapter week sims, both playoff endpoints, viewer broadcast, online block/simulate/broadcast) — the same rule as `talentImpact`.
* **CPU.** CPU rosters are fit-neutral until Phase 5; no CPU change in this phase.
* **Tests / criteria.** Re-run Experiments A, B, D on the implementation at talent 1.0 and 1.5: (i) quality factorial interaction not below −0.5 margin (the baseline measured −0.9 ± 0.8; superadditivity was *not* demonstrated by the prototype, so it is a goal to be re-tested, not a pass/fail gate); (ii) aligned vs anti-aligned elite offence gap in [1.5, 3] margin points, realistic rosters ≤ 1; (iii) equal-spend fit-built roster beats highest-overall by 0.2–0.6 margin (prototype: +0.19 ± 0.18 to +0.51 ± 0.24) and never by > 1.0; (iv) no identity beats balanced by > 0.5 averaged over opponents (re-centred counters); (v) league scoring levels unchanged (points/team-game 20.44 ± 0.1, `points_sd` 9.9 ± 0.2); (vi) §22/§23 and `engine-realism.test.ts` byte-identical under v1; `passing-volume` baseline re-measured under v2 on seeds 101–124 in the same commit.
* **Risk / complexity.** **High risk, L.** The only phase that changes outcomes; therefore after Phases 0–2 and behind a flag.

## Phase 4 — Scouting UI, identity card, recommendations, feedback

* **Modules.** `DraftRoom.tsx` (Projected-first rows, Scout buttons, points bar, tier badges), new Scouting board (tab, not a gate), `GamePlanScreen.tsx` (identity card, recommendation), `RookieDraftSummary.tsx` (projected vs revealed), `SeasonResults`/recap (“What shaped this result”), `UnitGradesDock` (fit row), `howItWorks.ts`.
* **Data / saves.** None beyond Phase 1.
* **CPU.** None.
* **Tests / criteria.** `npm --prefix ui-source run typecheck` (`tsc -b`), component tests, `npm run e2e` fixture hashes unaffected (no change to `teams.ts`/pool), `audit:visual` before/after at 1440/390/320 with zero unexplained pixel differences outside the new elements, usability checks in UI-PROPOSAL §5.
* **Risk / complexity.** Medium (many screens, no logic risk); **M–L**.

## Phase 5 — CPU adaptation, multi-season balancing, regression, rollout

* **Modules.** `aiGms.ts`/`aiStrategy.ts` (derive an identity per GM from coordinator + roster; a small, bounded preference for fit in draft, free agency and trade, orthogonal to strategy/difficulty as the existing three layers are), `tradeModel.ts` (fit term in CPU valuation to remove fit-arbitrage), `aiTrades.ts`.
* **Tests / criteria.** Longitudinal real-engine league runs (8 leagues × 8 seasons as PR #105 X1): persistence r 0.3–0.5; bottom-quartile 3-year mean ≤ 8.0 wins; ≤ 1 team with ≥ 3 titles in 8 seasons per league on average; skilled-fit human policy (extension of PR #105 X2/COMP-006) beats CPU by 0.5–1.5 wins/season, not more; `ai-master.test.ts` stays within noise; talent 1.0 and 1.5.
* **Rollout.** v2 default for new leagues; opt-in for existing leagues at a season boundary; documented in How It Works and the change log.
* **Risk / complexity.** Medium–high; **M–L**.

## Cross-cutting requirements

* **Existing franchises:** nothing changes unless the commissioner/owner opts in (flag per league), except Phase 1 scouting for the current class, which is purely additive.
* **Multiplayer:** all new randomness is a pure function of `(league seed, ids, tier)`; all spending is server-validated; private information is stripped in `privacyView`.
* **Validation baselines:** any deliberate engine change re-measures the statistical baselines (seeds 101–124) in the same commit (CLAUDE.md).
* **Documentation:** `howItWorks.ts` in the same commit as each mechanic.
* **Simulation path:** every acceptance run uses the real engine (adapter or online block), never the Mock fallback; until issue #74 lands, standalone play does not exercise these mechanics at all (Mock ignores plans, staffs and units).

## Refined acceptance criteria (supersede the per-phase numbers above where they differ)
See `REFINEMENT.md` §D: (1) complementarity gates are the exact quality × alignment interaction (≥ +0.15 yd/carry at +1 z) and a ≥ 2,300-pair simulation (≥ +0.10 yd/carry, CI above 0) at talent 1.0 and 1.5, not a simulated RB × line interaction; (2) elite players: +10 QB ≥ 3 margin, rating layer byte-identical without a declared concept, fit-built ≤ +1.0 over highest-overall; (3) no identity > +0.5 over balanced averaged over opponents; (4) CPU information ≤ human maximum and no CPU path reads hidden ratings; (5) absent flags ⇒ byte-identical legacy engine, migration only by explicit season-boundary action; (6) fit indicators labelled "information only" until `synergyModel: "v2"`. Phase 1 scouting ships **one** rating-oriented report with a free coarse growth/role label; no separate development or profile tier (REFINEMENT §B). Phase 3 uses the geometric combination of unit quality factors.
