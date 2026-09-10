# Design decisions & open questions

Running log. Each entry: **status** (open / decided / deferred), the question,
and — once decided — what and why. Convert relative dates to absolute.

---

## OQ-8 — Simulation engine architecture
**Status:** decided (2026-09-08); Phase A (audit) done, Phase B not started.

The engine follows `docs/engine_spec.md` (the empirical modeling build
contract): a stochastic play-by-play engine in three separated layers —
empirical nflverse baseline → current-player rating modifiers → calibration of
how far ratings may move the baseline. 25 numbered resolvers; strict
no-leakage rules; `overall` never touches a play outcome.

**Decisions:**
- **Split toolchain.** The §28 data audit is pure inspection → done in
  TypeScript in this repo (`analysis/`, `hyparquet`). Model fitting (Phase B+)
  needs scikit-learn → Python venv, added when Phase B starts. See
  `analysis/README.md`.
- **Layout.** `analysis/` (pipeline) + `artifacts/` (committed — the runtime
  loads these) inside this repo. `data/*.parquet` git-ignored. The existing TS
  project becomes the runtime engine that consumes `artifacts/`.
- **Seasons.** 2023–2025 only for the production baseline (spec §6.5).
  2020–2022 parquets exist locally but are unused.

**Audit findings that feed later models** (full report:
`artifacts/schema/data_quality_report.md`):
1. All 3 seasons: identical 372-col schema, all §1.1 required fields present.
2. `goal_to_go` physical type changed INT32 (2023) → DOUBLE (2024–25); values
   unaffected, but a typed Python load must coerce.
3. `run_gap` is ~26% missing within `play_type == "run"` → Model 13 fits
   LEFT/MIDDLE/RIGHT from `run_location` (≈0% missing) as the V1 target.
4. Kickoffs: 2023 ≠ 2024 ≠ 2025 (touchback 73%→64%→21%). Model 22 trains on
   2024–25 only *and* likely needs a 2024-vs-2025 regime indicator; onside
   kicks (`desc` "kicks onside", ~53/yr in 2025) are a separate event.
5. `roof == "open"` appears in 2023 (1,999 rows), gone by 2024 — models must
   accept the category. `temp`/`wind` structurally null indoors (§17.1).
6. ~72–86 scrambles/yr have `qb_scramble == 1 & qb_dropback == 0` — Model 04's
   `qb_dropback == 1` population misses them; use the derived `qb_player_id`.
7. `players_local_final.csv`: `free_agent` is `true` for all 1,987 players
   (fantasy-draft pool) — **not** a roster-status signal. Build the active-role
   reference pool from `nfl_team` + `overall` (spec §3 fallback), which
   `artifacts/ratings/attribute_reference_stats.json` now does (1,024-player
   pool, per-attribute mean/SD).

**Phase B started (2026-09-08).** Python 3.12 venv at `analysis/.venv`
(`analysis/requirements.txt`). This machine is Windows-on-ARM — no `pyarrow`
wheel — so the pipeline uses **polars** for parquet I/O + dataframes and feeds
sklearn numpy arrays. `analysis/lib_py/` mirrors `lib/filters.ts` (§6) and adds
§7 split / §8 metrics / §8 model builders / §20 report scaffold.

- **Model 01 (fourth-down action)** done — `analysis/02_fourth_down.py`,
  `artifacts/models/fourth_down.*`, `artifacts/models/m01.report.md`.
  Multinomial GO/FG/PUNT. Chosen: `HistGradientBoostingClassifier`
  (2024-val log loss 0.271 vs 0.304 for spline+logistic — a decisive gap, not
  a marginal one; HGB is a §8-sanctioned calibrated tree). 2025 locked-test
  log loss **0.241**, per-class calibration slopes 0.90–1.07, ECE ≤ 2.5%.
  Environment (`roof`/`temp`/`wind`) adds ~nothing (Δ log loss < 0.001) —
  kept but prunable. Conditional diagnostic: the 2023–24-trained model
  **under-predicts 4th-and-short GO by ~7pts in 2025** (league aggressiveness
  drift — spec §16 territory, not a bug; do not tune the baseline on 2025).

**Phase B complete (2026-09-08).** All 15 league-baseline resolvers fitted,
validated on the 2025 locked holdout, refit for production, and reported per
§20 — see `analysis/README.md` for the table. Rating modifiers = 0 throughout.

- **Toolchain gotcha:** scipy-openblas oversubscribes threads on Windows-ARM
  (a 20k-row multinomial lbfgs fit: 92 s → 0.03 s once `OPENBLAS/OMP/MKL/
  NUMEXPR_NUM_THREADS=1`). `lib_py/__init__.py` sets these before numpy loads;
  every `NN_*.py` imports `lib_py` first.
- **`lib_py/pipeline.py`** — one `run_resolver()` for every binary/multiclass
  model (dev C-grid + HGB challenger, HGB only wins by >0.003 log loss;
  locked test; production refit; §21 auto-slices; §20 report). **`lib_py/
  yardage.py`** — category multinomial + empirical exact-yard PMF + full
  mixture-sampler holdout (NLL vs global-PMF, PIT coverage, mean/var, tails).
- **Recurring finding:** M04/M13/M11 sit at the marginal rate because the
  signal is post-snap (matchup) — exactly what the spec expects; these
  resolvers supply the calibrated baseline, Phase D supplies discrimination.
  M01/M08/M09/M20 clearly beat marginal on legitimate context.
- **Portability note:** several models chose HGB. The TS runtime can't load a
  joblib pickle — Phase D/E must export chosen HGB models to a portable form
  (compact JSON trees, or fall back to the logistic where the gap is small).

**Phase C complete (2026-09-08).** Empirical usage-role share priors
(`analysis/lib_py/roles.py` + `08_target_roles.py`, `13_carry_roles.py`),
96 team-seasons, ratings never used (§15 usage≠ability).

- **M07 target roles** (51,102 targets): overall shrunk shares ROLE_1..4 +
  ROLE_5_PLUS = 0.236 / 0.175 / 0.133 / 0.105 / 0.350. DEEP throws concentrate
  hard on ROLE_1 (0.355); short/checkdown spread to the tail.
- **M12 carry roles** (39,152 carries): ROLE_1..3 + OTHER = 0.547 / 0.241 /
  0.092 / 0.120. Short-yardage (≤2) pulls ROLE_1 down to 0.482 (goal-line
  back vultures); late-lead spreads carries to ROLE_3.
- Artifacts: `artifacts/distributions/{target,carry}_role_shares.parquet`
  (tidy: dimension × level × role → league/mean/shrunk-mean/sd/p10/p90 share).
  The engine ranks current players into roles from the depth-chart system,
  then draws which role gets the ball from these shares (+ a per-team spread
  draw from sd/p10/p90). `artifacts/models/m07.report.md`, `m12.report.md`.

**Phase D V1 complete (2026-09-08).** `analysis/22_rating_calibration.py`
(+ `lib_py/residuals.py`).

- **Step 1 (§13.2/§13.3) — historical residual variance.** Per-unit mean of
  (actual − Phase-B-expected), empirical-Bayes shrunk by opportunity count.
  p10↔p90 shrunk spreads (`artifacts/validation/residual_variance_targets.json`):
  QB adj completion **±5.2 pp** (65 QBs), defense adj completion 3.3 pp, QB adj
  INT 1.5 pp, receiver adj YAC **1.34 yd/rec** (154), rusher adj **0.78 yd/carry**
  (105), defense rush 0.46 yd, kicker adj make 7.7 pp (42), offense sack 2.1 pp,
  defense sack 1.3 pp. These match known cpoe / YAC-OE / rush-EPA ranges.
- **Step 2 (§13.4) — coefficient set.** 11 attribute families
  (`artifacts/ratings/rating_effect_coefficients.json`), `beta_per_z` per
  family split by weight so a synthetic 90th-percentile player moves the
  outcome by ~half the historical p10↔p90 span for that matchup side.
  Sign-constrained per §23.
- **Step 3 (§13.5) — synthetic percentile sensitivity.** All 11 families
  monotonic; no ≥3-attr family dominated by one attribute; elite-vs-average
  spreads plausible (e.g. runner ±0.78 yd, qb_accuracy ±0.23 logit).

**Phase E V1 complete (2026-09-09).** `analysis/engine/` (game loop in §4
chronology, consuming the joblib resolvers + empirical PMF parquets) +
`23_full_sim_validation.py`. Rating modifiers = 0 (§22 baseline check).

- **14/16 league metrics within 10%** of the empirical 2023–25 baseline
  (100 sim games): dropback rate, completion % (.628 v .647), YPA (7.07 v
  7.06), air yd/att, INT rate, sack rate, YPC (4.43 v 4.28), explosive
  rush/pass, FG %, plays/team-game (65.6 v 62.0), drives/team-game (10.6 v
  10.7), pass/rush att.
- **Iteration 2 (2026-09-09):** the −19.5% points miss was a **clock bug** —
  M24's elapsed model is trained on *same-drive* snap gaps (~35 s incl.
  huddle) and the engine applied that to drive-*ending* plays too
  (~250 s/game overrun → too few plays/drives). Fix: drive-ending plays
  elapse ~65% of the sampled gap. Also fixed: air-yd cap near the goal line
  (uncapped deep balls from the 8 inflated INTs), the sack fumble check
  passing `qb_hit=0` (M15's `qb_hit=0` main effect drove P(fumble) to ~0.5
  for sacks), TD counts as a first down, pick-6 / scoop-6 added.
  **points now −10.7%** (20.2 v 22.6).
- **Residual misses:** points −10.7% and points_sd −13.9%. Initially blamed on
  the penalty module + RZ finishing; both turned out not to be the driver
  (penalties are ~net-neutral on points; RZ TD rate matches at 0.556 v 0.560
  once measured consistently). See the "diffuse points gap" note below the §23
  entry. points_sd is low because the average-rating engine runs two identical
  teams (scores regress to the mean); variance widens with rating modifiers on
  — the §23 check.
- Engine is **Python** (loads joblib directly). Per-play `predict_proba` is
  cached on a bucketed context key → ~2.5 s/game.
- V1 gaps: no penalties (V1.5); `qb_hit`/`pass_location` from marginals
  (Models 06/08 not wired); kickoff/XP/sack-yd hard-coded (Models 22/23 not
  fitted); running-clock only; no per-player attribution (so §24 stat-integrity
  tests are deferred to the shippable engine).

**Phase E V1 §23 rating-layer validation complete (2026-09-09).**
`analysis/24_rating_layer_validation.py`; artifacts
`artifacts/validation/rating_layer_validation.json`,
`artifacts/models/m24b_rating_layer_validation.report.md`. Rosters loaded from
`data/players.local.json`, depth charts ranked by `overall` (roles only, §3/§15),
per-play lineups → attribute z-scores → Phase D coefficients as
`baseline_logit + Σβᵢ·attr_z` (`engine/roster.py`, `engine/ratings.py`,
`engine/sim.py`).

- **§12 centering bug found + fixed.** `attribute_reference_stats.json` means are
  over the whole 1,024-player pool, but the engine only fields *starters* (above
  that mean) → every matchup carried a non-zero net shift and league scoring
  drifted. Fix: each family subtracts its league-mean modifier over the on-field
  slot (`engine/ratings._offsets()`, computed once from the 32 depth charts), so
  an average real matchup → ≈0 shift. Paired invariant tests are unaffected (the
  offset is common to both cells and cancels).
- **Invariants (n=35/cell, paired CRN):** the analytic `designed_magnitude` is
  the trustworthy check — **all 11 families land at 0.99–1.0× the historical
  p10↔p90 anchor** (logit and yard scales in common units), Phase D calibration
  confirmed sound. The Monte-Carlo directions are 5/7 with only qb_accuracy
  clearing z≥2 (Δ +0.054, MCratio 1.02); the yardage channels (runner,
  run-defense) have such large per-game YPC variance that even n=35 paired
  can't resolve them — `runner` flip-flops sign run-to-run (noise, not a bug).
- **Larger §23 run (2026-09-09): the pinned picture is softer than the n=32
  read.** League (120 pairs, modifiers on): completion +2.5%, YPA +2.0%, YPC
  +4.1%, sack +4.4% (the n=32 "+14.5%" was sample noise). Favourite-by-summed-
  `overall` win rate **55%**; by net-modelled-channel-edge **62%** (below the
  NFL point-spread favourite's ~66–70%). **Paired ON vs OFF (100 pairs): the
  centred rating layer costs ~1.2 pts/team-game and score-margin sd *shrinks*
  (11.29 v 11.99)** — §12 predicts ≈0 and a widen. Best-vs-worst roster still
  → favourite 73% both directions.
- **This is the same "correct per-play, compounds wrong through the drive
  model" pattern as the §22 points gap** — the analytic magnitudes are exactly
  1.0×, so it's not a centering or sign bug; the shifts just don't aggregate to
  the right league-level effect. It's a **§13.6 joint-calibration** item (tune
  βᵢ against the engine's *emergent* points/wins, not just per-play residual
  spreads). Not blocking A1/season-sim; do it before rating-layer magnitudes
  surface in franchise-mode UX.

**Wider residual window (2018–2025) ADOPTED (2026-09-09).** The user supplied
2018–2022 pbp (`data/*.parquet`, git-ignored; same 372-col schema, all
Next-Gen fields present). `22_rating_calibration.py` now runs step 1 on the
8-season window; `--compare-wide` keeps the 3-vs-8 diff tool and writes
`residual_variance_targets_wide.json`. Two changes: `step1_residuals(seasons=…)`
is parameterised, and the four **team anchors now use team-SEASON as the unit**
(a franchise's pass D in 2018 ≠ 2025) — a better estimate on its own, and it
lets the wide window add units (32 team codes → 256 team-seasons), not just
plays.
- **Anchor spreads (`residual_variance_targets.json`, re-derived):** player
  anchors gain data (QBs 65→97, receivers 154→345, rushers 105→211) and the
  thin tails firm up — `m09_qb_completion` +8.4%, `m14_rusher_yards` **+22%**
  (0.779→0.951), and the *defensive* team anchors, which were the worst-counted
  at n=32, move most: `m09_def_completion` +20%, `m04_defense_sack` **+31%**,
  `m04_offense_sack` +14%. Era drift is negligible (completion flat 0.636–0.655
  across 2018–25; 2023–25 M09 per-season bias on 2018–22 ≤1pp; season-de-meaning
  the rush residual leaves the spread at 0.951→0.954), so the 3-season anchors
  were under-powered, not era-biased. **1999–2017 not needed** — no Next-Gen
  pre-2016, huge scheme drift.
- **βᵢ (`rating_effect_coefficients.json`, re-derived):** family p10↔p90 effects
  grow in step: qb_accuracy +8%, receiver/coverage +20%, protection +14%,
  pass_rush +31%, runner +22%; the well-sampled ones barely move
  (yac ±2%, kicking 0%, ball_security/run_D −3%). No invariant violations
  (monotone, no single-attr dominance). `test/fixtures/rating_cases.json`
  regenerated to match; full TS suite + typecheck green.
- **§22 re-run (200 games):** unchanged — it's the rating-layer-OFF baseline
  check, so re-deriving βᵢ can't touch it. Still 15/20 within 10%, points
  −11.9% (the diffuse drive-aggregation gap, unrelated).
- **§23 re-run (40/cell, 120 league, 100 impact):** the paired ON-vs-OFF
  **points cost halved, −1.22 → −0.67 pts/team-game** (closer to §12's ≈0),
  and INT-rate drift shrank. Still open: margin sd *narrows* under the layer
  (11.85 on vs 13.13 off) where §12 predicts a widen, and the per-channel
  invariant sims (coverage, pass_rush, runner) don't resolve the right
  direction at n=40 — `designed_magnitude_ratio` is 0.99–1.0× for all 7, so
  the per-play magnitude is right; the emergent sim signal and the sample
  size aren't. Still a **§13.6 joint-calibration** item (tune βᵢ against
  emergent points/wins/margin, and bump the invariant sim count); not
  blocking A1.

**§13.6 joint-calibration harness — and the §23 hash-seed bug (2026-09-09).**
`analysis/26_joint_calibration.py` measures the *simulation-level* targets the
per-play §13.2 anchors don't constrain (points neutrality, score-margin
variance) and carries the loss ingredients to tune βᵢ if a real bias shows.
- **The committed "margin narrows / costs 1.2 pts" §23 reads were an unlucky
  hash draw.** `24_…validation.py` `league()` seeded games from Python's string
  `hash()` (randomised per process); through a cache it warms before
  `layer_impact()`, the paired ON/OFF numbers drifted run-to-run — Δpoints
  −0.67 / −0.94 / −0.96, margin "narrows" 11.85÷13.13 in one draw and "widens"
  13.9÷12.5 in another. **Fixed:** `zlib.crc32` game seed; the full script is
  now byte-reproducible (also run it and `26` with `PYTHONHASHSEED=0`).
- **Clean picture (wide βᵢ, deterministic):** score-margin sd **widens** under
  the layer (12.4 vs 11.3 at n=100/§23; 12.3 vs 11.5 at n=320/`26`) — the §12
  direction. Points delta converges to **≈ −0.8 ± 0.4 pts/team-game** (z≈1.9,
  ~−4%): small, borderline, and **diffuse** — `diagnose()` masks each channel
  and none carries it; `curvature_probe()` shows the per-play logit-Jensen gap
  is ≤0.2pp, so it is a drive-level aggregation effect (same family as the §22
  gap), not a per-play miss.
- **No coefficient change.** At z≈1.9 with no identifiable lever, tuning βᵢ
  against −0.8 pts would fit noise; the per-play magnitudes are exactly right
  (designed 1.0×) and the margin behaviour is now correct. `26` writes
  `artifacts/validation/joint_calibration_probe.json`. Revisit if A1 season
  sims surface a compounding wins/points bias. The material scoring gap stays
  the **§22 −12%** (rating-layer *off* — drive model, out of §13.6 scope).

**Headless season loop (A1 regression guard, 2026-09-09).** `src/engine/season.ts`
— `simulateSeason(seed, opts?)` plays a balanced 17-round circle-method round
robin through `simulateGame` (rating layer ON) and rolls it into a standings
table (W-L-T, PF/PA, point diff, winPct, sorted with point-diff tiebreak).
`roundRobinSchedule()` is the schedule generator; `SeasonOptions.schedule`
takes an explicit `[home, away]` list so the **real NFL division/conference
schedule + playoffs (A1 proper) plug in without touching the loop** — deferred
to pair with the franchise UI, per the owner. `test/engine-season.test.ts`
(gated on the generated pool): 272 games / 17 per team, ΣW=ΣL, ties paired,
leaguewide PF=PA, deterministic in the seed, ~19 pts/team-game, and
Pearson(winPct, summed-roster-overall) ≈ 0.2–0.5 across seeds (better rosters
win more). ~11 s/season, so the full-season assertions run once at module
scope and determinism uses a 3-round mini-season.

**Penalty module (§25 V1.5) — models fitted (2026-09-09).**
`analysis/25_penalties.py` (M25a pre-snap dead-ball hazard, M25b live-ball
hazard by play family — both logistic, ~marginal rate, well-calibrated;
locked-test log loss 0.141 / 0.193) and `analysis/25c_penalty_enforcement.py`
(M25c — 40+ raw `penalty_type` strings → 9 engine buckets with per-bucket
off/def share, yardage, auto-first-down rate; DPI spot-foul yardage PMF by
field-position band). All use the RAW play stream (a bespoke mask that keeps
`no_play` rows — penalties negate the play they occur on, so `load_clean`'s
`admin_exclusion_mask` would drop the target population). Full plan in
[`penalty_module_plan.md`](penalty_module_plan.md).

**Wired into `engine/sim.py` (2026-09-09).** Pre-snap M25a rolls before the
play call (capped 2/snap, replay down); live-ball M25b rolls after the physical
outcome with deterministic accept/decline (the non-penalised side takes the
better outcome), an accepted foul nullifies the play via a stat
snapshot/restore, DPI is enforced to the spot capped at the 1, `p_auto_first`
overrides the down logic, punt fouls are marked off from the new spot. §22
validation gains penalties/, penalty-yд/ and DPI-per-team-game targets.

- **Finding — penalty volume vs the scoring effect are in tension, so
  `PENALTY_HAZARD_SCALE` is left at 1.0.** The raw hazard runs penalties
  ~15–20% light (the engine's scrimmage-snap population is smaller than the
  per-row training stream). Scaling up to hit the empirical 6.16/team-game
  hits that metric exactly (DPI 0.52 v 0.52) **but drops points/team-game from
  −10% to −16%** — the physical-outcome resolvers are fit penalty-FREE (§6.2)
  and this engine's drive model over-punishes offensive fouls, so more
  penalties = less scoring rather than reproducing the league mean.
  Reconciling the two needs gained-conditioned penalty hazards (V1.6). At scale
  1.0 the module is ~net-neutral on points and modeled directionally.
**Diffuse points gap (2026-09-09).** After the penalty module and a round of
scoring fixes (`XP_RATE` 0.940→0.958, kick/punt return TDs, `rz_td_rate` added
as a §22 metric), the engine sits at **16/20 within 10%**, points/team-game
still **−9.4%** (20.4 v 22.6). It is *not* one cause:
- RZ TD rate **matches** (0.556 v 0.560) — the earlier "~54 v 57" was a noisy
  n=24 read against an inconsistent empirical method; RZ-bucket splitting in
  the exact-yard PMFs is **not** needed.
- Penalties are ~net-neutral on points at scale 1.0.
- The engine runs **more** plays/team-game (67 v 62) but scores ~1.9/drive vs
  ~2.1, and punts more (0.38 v 0.35/drive) while reaching the RZ less
  (0.30 v 0.36/drive).
- **Diagnosis (2026-09-09):** 3rd-down conversion *by distance bucket* matches
  (0.39 v 0.395 — the earlier "0.33" was `third_conv/third_att`, which
  undercounts penalty-driven conversions); M01 4th-down calls are reasonable
  (66% go on 4th-and-3 from the opp 40, 77–90% FG inside the 35).
- **Pass depth investigated + calibrated (2026-09-09).** Air-yд *bucket shares*
  match empirically (M05 is fine), but the completion RATE was wrong by depth:
  M09 regresses toward the pass mean → under-completes behind-LOS/checkdowns by
  ~7pp, over-completes intermediate/deep by ~3pp; and `qb_hit` was a flat 0.135
  vs the empirical 0.065 / 0.084 / 0.113 / 0.132 by depth (quick releases get
  hit less). Fixed with `QB_HIT_BY_DEPTH` + a point-of-use `M09_COMPLETE_CALIB`
  per depth. Completion, YPA, air-yд and explosive-pass now all within ~6%.
  **This *raised* the points miss −9.6% → −11%** — the old deep-ball
  over-completion was inflating explosives that masked ~1.7 pts of a scoring
  deficit elsewhere. So pass depth is a real fidelity fix but **not** the
  points-gap lever.
- **Points gap (~−11%) — deep diagnostic (2026-09-09), no single lever.**
  What *matches* empirically: down-and-distance distribution on 1st/2nd/3rd
  down; 3rd-down conversion by distance bucket; 1st/2nd-down run-gain shape
  (neg/stuff/solid/chunk/explosive); 1st/2nd-down dropback outcome shape
  (engine slightly hot post-calib); RZ-trip rate (36.5% v 36.4%); RZ TD rate.
  What's *off*: **first downs/drive 1.58 v 1.75** while **plays/drive 6.27 v
  5.69** — the engine grinds (more plays) but moves the chains less, and
  **drives that never cross midfield are 37% v 18%**. The gap is emergent from
  compounding ~2–7% misses: plays/team-game +7% (clock ~2 s/play fast),
  penalties −20% (documented tradeoff), and **no "end of half / game" drive
  outcome** — empirically 7.3% of drives (0.8/team-game) just expire; the
  engine forces every drive to a real result and its half/game clock
  transitions are ad hoc.
- **Fixes tried (2026-09-09), none closed it:** a late-game kneel-out model
  (`_can_kneel_out` / `_kneel_out` — leading team near a half boundary burns
  the clock; kept, it's correct football and will matter once the rating layer
  produces blowouts, but in the average-rating engine it fires <0.3
  drives/team-game); and raising the drive-end clock multiplier 0.65→0.78
  (plays +7.6%→+5.4% but points −11.5%→−12.2% — **fewer plays just means fewer
  scoring chances**; reverted). Every lever trades against another metric: with
  correct yardage / downs / conversions the engine's *points-per-play* is ~10%
  low, so nothing short of raising points-per-play helps. Treating −11% as the
  V1 ceiling for a strictly-marginal-calibrated average-rating engine; a real
  fix needs drive-level EPA / points-per-drive modelling — out of V1 scope.
  2-pt tries are EV-neutral.
- **SUPERSEDED IN PART (V1.6 diagnostic, see
  [`v16_points_gap_plan.md`](v16_points_gap_plan.md)).** Two of the numbers above
  are wrong or unreliable: **"drives that never cross midfield 37% v 18%" — the
  empirical figure is 42.76%**, so the engine is *better* than the baseline, not
  2× worse; and empirical plays/drive is 6.75 (all plays) / 5.80 (run+pass), not
  5.69, so the "engine grinds" reading is a definition mismatch. Separately, a
  drive-level *momentum* layer is ruled out: measured intra-drive residual
  correlation is ρ ≈ 0 (lag-1 +0.03), so real plays are conditionally
  independent given state and the engine's sampling assumption is sound. The
  live hypothesis is now that the engine **under-produces opponent-territory
  drive starts** — 9.7% of real drives start at the opponent 49 or better and
  carry ~16.5% of all offensive points, and nothing in §22 measures drive start
  field position.
- **V1.6 step-4 (2026-09-09): confirmed, and two punt bugs fixed.** New tooling:
  `analysis/29_drive_baseline.py` (empirical drive table), `lib_py/drives.py`
  (one shared summariser used by both sides), and per-drive metrics in
  `23_full_sim_validation.py`; `engine/sim.py` keeps a `drives_log` (mirrored in
  `src/engine/sim.ts`). Bugs in `_fourth_down`'s punt path: a touchback did
  `_flip_field(1 - 20)` → the receiving team started at the *opponent's* 1
  (fixed → own 20); and a punt return *added* the return yards to `yardline_100`,
  moving the returner **backward** (fixed → `100 - landing - ret`). Result:
  drive start_yl mean 71.9→71.1 (emp 70.1); "opp 0–9" starts 2.5%→0.4% (emp
  0.5%); "own 90–99" 14.5%→10.3% (emp 8.2%); points/drive −6.8%→−4.2%;
  points/team-game −13.1%→−11.8%. `never crossed midfield` 43.8% v 42.8%.
- **Residual −11.8% ≈ −4% drive conversion + −3% fewer drives (clock hot) +
  ~1pp return TDs.** The −4% conversion concentrates in drives starting ≥ own 30
  (69% of drives): FD/drive 1.70 v 1.91.
- **Long-field-drive probe (2026-09-10) → it's the PENALTY-VOLUME gap, not
  per-play football.** Added an opt-in per-scrimmage-play trace
  (`Game.play_trace`). On drives starting ≥ own 30, the engine matches empirical
  on: down/distance state mix (±0.6pp), dropback rate by FP, designed-run yards
  by `gl`/`opp`/`own` bucket (−0.15 yд), first-down conversion by (down,
  distance) (±2.5pp), and turnover rate per play (±0.4pp). But empirical
  long-field drives get 1.913 FD/drive = **1.742 rush+pass + 0.171 PENALTY**;
  the engine's 1.70 ≈ the rush+pass-only figure. **The whole FD/drive gap is the
  ~0.17 defensive-penalty first downs/drive the engine doesn't produce** (it
  runs penalties at −25% volume). Fixed two stat-counting mismatches:
  `auto_first_pen` now also increments `first_down`; a dead-ball foul now counts
  a play in `_dplays` (matches nflverse's no-play row) — both mirrored to TS.
  Momentum stays ruled out (ρ≈0).
- **`PENALTY_HAZARD_SCALE` sweep (2026-09-10) — NOT the points lever.** Swept via
  `NFLSIM_PEN_SCALE` (dev override, defaults 1.0), field position fixed. Scale
  1.30 hits the empirical penalty count exactly (6.17 v 6.16) and the
  defensive-penalty first downs materialize (long-field FD/drive 1.79 → 1.86,
  ppd 1.846 → 1.866) — **but points/team-game does not improve** (−12.4% →
  −12.9%): the offensive fouls that scale up alongside cancel the drive-
  extending defensive fouls. Above 1.3, points and penalty *yards* both run
  away. The old "scaling → −16% points" finding **still holds** post-punt-fix.
  Left at 1.0.
- **Revised: the residual points ≈ red-zone TD conversion + clock.**
  points/team-game −12.4% ≈ ppd −5% × drives/tg −3.4%.
- **Red-zone probe (2026-09-10) → it's the PASSING game.** M13/M14 rushing at
  the goal line is correct (fed the resolver real contexts: P(rush TD) within
  1–2pp at every band — yl 1–2 .54 v .53, yl 3–4 .27 v .30, yl 5–10 .11 v .13).
  But TD rate **on a completed pass** runs far low: yl 3–4 **0.56 v 0.86**, yl
  5–9 **0.32 v 0.60**. The `ay = min(ay, yardline_100 + 3)` cap forces every RZ
  throw SHORT — depth mix inside the 10 is **DEEP 0.00 v 0.07 emp**, SHORT 0.85
  v 0.77 — so the engine throws shorter/easier passes (comp% 0.575 v 0.485) but
  a 1–2 air-yard completion from the 3 stops short of the goal line where a real
  goal-line throw goes *into the end zone*.
- **RZ air-yards fix (2026-09-10, partial).** The `air_yards` table now splits
  the RZ into `gl1`(≤2)/`gl2`(3–4)/`gl3`(5–7)/`gl4`(8–12)/`rz`(13–20) — the old
  pooled `opp_rz` bucket was a flat 0–9 SHORT draw, but empirically RZ air-yards
  spike at the exact yardline (from the 3 you throw it ~3). `sample_air_yards`
  (both engines) walks a widening fallback chain. Effect (n=200–250):
  `pass_comp TD/pl` yl 3–4 0.56→0.63; points/drive −4.2%→~−3.5%;
  `never_crossed_mid` now exact; drive outcome mix all within ~1.7pp.
  Tradeoff (`explosive_pass_rate` +9→+10%) resolved once the clock fix landed
  (back to +5%). **Not closed:** yl 5–20 pass-TD still ~−20pp — a diffuse
  M05/M09/M10 RZ interaction, deferred.
- **End-of-half clock management (2026-09-10; play-by-play prerequisite).**
  New `Game.clock_stopped` running-clock state (reset on possession change,
  incompletion, OOB; running after an in-bounds gain). 2-minute drill
  (`_hurry_up`): timeout after a fresh set of downs, then spike, then the kick
  unit on `_end_half_fg` (in FG range as time expires) via a shared `_kick_fg`.
  Dropped the OT phantom drive. `end_of_half` 8.8% → 7.9% (emp 6.85%), spikes
  0.31/tg (emp ~0.3), **points/team-game −2.6% → −2.0%**, §22 16/20.
- **RZ passing recalibration (2026-09-10) — `rz_yac` table.** M10 regresses
  goal-line YAC toward the league mean and misses the reach/dive: a completion
  caught at the opp 3 scored ~25% in the engine vs ~48% empirically. Added
  `11_yac.write_rz_yac` → `artifacts/distributions/rz_yac.parquet` → portable
  JSON: the empirical YAC PMF for a RZ completion caught *short* of the goal,
  keyed by catch position (`catch_yl` = yardline_100 − air_yards, bands
  1/2/3/4-5/6-8/9-12/13-18/19-25). `sample_rz_yac` in both engines; used when
  `yardline_100 ≤ 20` and the ball is caught short. `pass_comp TD/pl` yl 3–4
  0.63 → 0.77 (emp 0.86), yl 5–9 0.40 → 0.50 (emp 0.60). **points/team-game
  −4.9% → −2.6%**, §22 16/20. Residual ~10 pp short at yl 5–20 = the engine's
  RZ completions still skew to shorter throws (M05 depth mix), small.
- **Return-TD rate fix (2026-09-10).** `PICK_SIX_RATE` / `SCOOP_SIX_RATE` were
  ~5× too low (0.018 / 0.012 vs empirical 0.088 / 0.064 — 111/1254 INTs, 55/863
  lost fumbles returned for TDs). Fixed → `opp_touchdown` drive share 0.17% →
  0.65% (emp 1.11%), **points/team-game −6.2% → −4.9%**. drive-table
  `points_per_drive` reads *worse* (−2.5% → −4.2%) because those drives now
  score −7 for the offense — but the +7 shows up in actual team points.
- **M24 clock fix (2026-09-10) — the big one. points/team-game −11.8% → −6.2%.**
  The "engine runs +7% plays" belief was a §22 definition mismatch (5th):
  `plays_per_team_game` compared the engine's all-plays counter to a
  scrimmage-only empirical filter. Like-for-like, the engine was *low* (65.8 v
  68.1) — M24 snap gaps run ~1 s/play long, so drives ate ~8 s more wall clock
  and ~0.5 fewer fit per team-game. Fix: `CLOCK_SCALE = 0.958` on
  `sample_runoff` (both engines; swept 0.955–0.968, 0.955–0.958 lands plays and
  drives on empirical with the best points). Result (n=250): drives/team-game
  −3.3% → +1.2%, points/drive −3.5% → −2.5%, `rz_td_rate` −7.7% → −2.3%,
  **§22 16/20 within 10%**. Remaining fails all expected: `points_sd` (rating
  layer OFF) + 3 deliberate penalty-volume metrics. Also fixed the §22
  `plays_per_team_game` empirical filter to be like-for-like (62.0 → 67.8).
  TS parity: N 120 → 220, `int_rate_per_att` own 0.18 band (rare-event, sfc32
  vs PCG64). Residual −6.2% is now `end_of_half` (8.8 v 6.85%) + the diffuse
  RZ passing + return-TD rate. Full plan:
  [`v16_points_gap_plan.md`](v16_points_gap_plan.md)

**Portable HGB export done + wired into the engine (2026-09-09).**
`analysis/27_export_portable.py` + `lib_py/hgb_portable.py`. The 7 HGB
resolvers (M01/M02/M03/M05/M09/M10/M14) flatten to
`artifacts/models/portable/<mid>.json` — baseline + per-class regression-tree
forests, categorical splits resolved to string sets, sklearn 1.9's internal
`[categoricals][numerics]` feature reorder captured. `predict_proba_portable`
(pure Python, no sklearn) reproduces `sklearn.predict_proba` to **< 1e-6** on
real 2025 rows for all 7 (machine-epsilon). ~3.8 MB, ~1900 trees / ~119k nodes.
- **All 16 classifier resolvers are portable and the engine loads only those.**
  The 6 spline+logistic ones (M04/M08/M11/M13/M15/M20/M21/M25a/M25b —
  `linear-portable-1`) collapse each numeric feature's spline→coef pathway to
  an **exact per-segment cubic** (the contribution IS a piecewise cubic between
  the spline's knots) + one-hot weight rows — 2–9 KB each, machine-epsilon vs
  sklearn. `engine/loaders` has **no joblib / sklearn / pandas import** now.
- §22 unchanged (16/20 within 10%, core metrics identical) and the engine runs
  **~25× faster — 0.35 s/game vs ~10** (200-game §22 in 70 s). The pure-Python
  tree walk / cubic eval has none of sklearn's per-call `check_array` /
  DataFrame overhead.
- **Fixed a latent bug in passing:** M01 trained `goal_to_go`/`qtr`/
  `temp_missing` as int8 categories; the old `loaders._row` stringified every
  cat col, so `'0'` ≠ `int8(0)` → NaN → the live engine ignored those three
  M01 features. The portable eval string-normalises, so M01 now uses them.
- **`src/engine/hgb-portable.ts` + `linear-portable.ts`** — TS ports of both
  evaluators, verified in `test/portable-resolvers.test.ts` against
  Python-computed fixtures. These are the spec the shippable runtime consumes.
- The 16 `*.joblib` files stay on disk as the fitting artifact +
  `27_export_portable.py`'s source; nothing at runtime reads them.
- **Empirical PMF tables portable too (`28_export_distributions.py`).** The
  seven parquet lookups the engine sampled from (air-yд, m10/m11/m14
  exact-yardage, clock runoff, punt distance/return, penalty enforcement + DPI)
  export to `artifacts/distributions/portable/*.json` (123 KB total) as
  pre-cumsummed `{v[], cum[]}` leaves — sampling is one `searchsorted`.
  **`engine/loaders.py` now imports only `numpy` + `json`** (no polars / pandas
  / joblib / sklearn); §22 unchanged. The runtime is fully portable — every
  input is JSON.

**TS engine ported (2026-09-09).** `src/engine/` — a line-for-line port of
`analysis/engine/`:
- `hgb-portable.ts` / `linear-portable.ts` — the two resolver evaluators
  (machine-epsilon vs sklearn on fixtures).
- `roster.ts` — pool → depth charts (by `overall`) → offense/defense/kicker
  lineup slots.
- `ratings.ts` — `familyModifier` (Σβ·z, ±3 clip), §12 `offsets()` over all 32
  depth charts, the six resolver shift functions (matches Python to 8–10 dp).
- `rng.ts` — seeded PRNG (sfc32); `random()` / `choice(items, probs)` /
  `normal(loc, scale)`. Not a numpy PCG64 bit-match — statistical equivalence.
- `loaders.ts` — `predictProba` / `sampleClass` + the PMF samplers (replay
  Python's exact draws bit-for-bit given the same `r`); no bucket-cache (the TS
  eval is cheap and un-cached is strictly more accurate).
- `sim.ts` — the ~650-line `Game` loop (§4 chronology, clock, scoring,
  penalties, kneel-out, rating shifts, OT).
- `test/engine-parity.test.ts` — 120 TS games; every core §22 metric within
  12% of the empirical baseline and **points/team-game 20.2 ≈ the Python
  engine's ~20** (same known ~−11% gap). Runs at ~37 ms/game (vs Python's
  ~300). 120/120 tests pass.

**Still deferred:** §13.6 joint calibration loss (Phase D iteration, needs the
engine loop); a larger §23 league sample; the diffuse points gap above; the TS
franchise/game layer on top of `src/engine/`; switching the Python engine to
the portable models (fixes the M01 dtype bug, drops joblib) — the TS engine
already runs on them.

**The engine spec's full arc (A→E) now has a working V1 end to end, with the
rating layer wired and §23-validated.**

## OQ-1 — Full player pool: source vs generate
**Status:** decided + implemented (2026-09-07) — **generate from public stats.**

Options were: (a) license/source a real ratings dataset, (b) generate
attribute values ourselves from public stats + heuristics, (c) hybrid.
Chose (b): licensing is not realistic for a hobby project, and copying a
commercial ratings database (Madden) into the repo is the IP concern the
README flags — fine to *use* privately, not to redistribute.

**Implemented:** `npm run generate:pool` (`src/data/generate-pool.ts` +
`src/model/`). Fetches an nflverse season roster + per-game snap counts
(openly licensed, factual), then:
- **tier** = snap share (when the player has one) blended with draft capital
  and years survived; rookies / deep bench fall back to draft capital + tenure
- **overall** = position prior (`POSITION_OVERALL_PRIOR`) + spread·tier +
  age adjustment (`AGING_CURVES`) + seeded noise
- **physical attrs** centred on `POSITION_PHYSICAL_BASE`, nudged by overall/age
- **skill attrs** tracked to overall with one strength + one weakness
- deterministic per `--seed`; ~1,900 players; every record passes the schema

Output is `data/players.local.json` (git-ignored — large + regenerable, not an
IP issue). The Madden CSV importer (`import:madden`) stays as an alternative
for anyone who already has such a file.

**Known gap (feeds OQ-2):** snap share saturates at 1.0, so the model can rank
starters vs backups but not good starters vs great ones. First calibration
step in Phase 1: add an efficiency/grade signal (EPA per play, or a public
grade) to separate the top tier. Overlaps with the rookie-`overall`
generation model (Phase 3).

**Current pool (2026-09-08):** `data/players.local.json` is a hand-reviewed
pass over the generated 2025 pool (revised in a spreadsheet, re-imported via
`pool:import-csv`). ~1,987 players. Treat it as the working pool; regenerating
overwrites it.

**Position taxonomy change (2026-09-08):** `LB` split into `ILB` + `OLB` to
match the reviewed data (most 3-4 rush OLBs are filed under `EDGE`, so `OLB`
is sparse). `POSITION_ATTRIBUTE_KEYS` was also widened per position to cover
every attribute the reviewed pool actually uses, so `strictAttributes` stays
meaningful. Enum is now 15 positions.

## OQ-2 — Attribute → `overall` weighting
**Status:** deferred to Phase 7 (polish)

v0 `overall` values in the sample are hand-picked, not computed. Needs a
per-position weighting function, benchmarked against something. Do not treat
any interim formula as final.

## OQ-3 — Scheme-fit modifiers
**Status:** open (needed for Phase 2 core sim)

`scheme_tags` on players + an OC/DC scheme define in-scheme vs out-of-scheme
performance multipliers. Need: the scheme vocabulary, how many tags a scheme
has, and the size of the in/out modifier.

## OQ-4 — Aging curves
**Status:** open (needed for Phase 4 full loop)

`dev_age_threshold` / `decline_age_threshold` are position-curve derived and
currently hand-set. Need the actual per-position curves, the drift magnitude
per year, and how `injury_history` shifts them.

## OQ-5 — Trade value model
**Status:** open (needed for Phase 4 trades, Phase 6 vote safeguard)

A function from (players, picks, cap situation) → comparable value, plus the
human-vote threshold for lopsided deals.

## OQ-6 — Free-agency demand model
**Status:** open (needed for Phase 4 simplified FA, Phase 6 live FA)

What contract a free agent will accept, as a function of overall, age,
position scarcity, and team context.

## OQ-7 — `severity` vocabulary for injuries
**Status:** open (low stakes, easy)

Schema accepts any string. The hand-reviewed pool uses
`minor | moderate | major | severe` in `injury_history`. Likely pin to that
set (plus `season_ending`?) once the aging model consumes it — until then the
free string is fine.
