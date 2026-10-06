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
- **Exotic return TDs at IRL rates (2026-09-10).** Empirical `opp_touchdown`
  drives = pick-6 + strip-sack scoop + **punt-return TDs** (nflverse labels the
  punting team's drive "Opp touchdown") + run-fumble returns. The engine
  already had the right per-event rates; the bug was a punt-return-TD drive
  being labeled `punt`. Relabeled → `opp_touchdown` 0.72% → 1.06% (emp 1.11%).
  Blocked-kick / muffed-punt return TDs are ~0 in 2023–25 — not modelled.
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

### A1 — real NFL schedule, standings, playoffs (2026-09-10)

`src/engine/{nfl-structure,schedule,standings,playoffs}.ts` +
`simulateNflSeason` in `season.ts`. Headless; the franchise UI wires on top
later. Round-robin `simulateSeason` stays as the pool-independent regression
guard.

- **Schedule** — the current (2021–) 17-game formula, `nflSchedule({ year,
  priorRank })`. Same-place games use prior-year division finish rank (defaults
  to 4 / roster order when there's no history). Matchup construction is exact;
  the parity of the same-place home/away split is chosen so each team gets
  1 home + 1 away there (the naïve `(k+r)%2` gave two divisions both-home).
- **Rotation anchored to reality (2026-09-10 revision).** The intra-conference
  4-game block (3-year cycle) and both inter-conference pairings — the 4-game
  block and the 17th game (each a 4-year cycle) — are hard-coded from the NFL's
  published pairings for 2023–2026 (`INTRA_CONF_CYCLE`, `INTER_CONF_CYCLE`,
  `SEVENTEENTH_CYCLE`, keyed on `year % 3` / `year % 4`). AFC hosts the 17th
  game in odd years. So `year: 2026` reproduces the actual 2026 slate
  (division-block and 17th-game opponents verified against
  operations.nfl.com / Wikipedia) and later years roll the same cycles
  forward. Default year is now **2026**.
- **Week assignment** — an 18-week balanced edge-colouring with byes confined
  to weeks 5–14 (`BYE_WEEK_RANGE`); weeks 1–4 and 15–18 are full 16-game
  slates. **Decision:** backtracking, most-constrained game first, mandatory
  (non-bye) weeks packed ahead of the bye window, per-team forward checks
  (can't run out of games for the 8 mandatory weeks or overfill the 9 window
  weeks), seeded randomised restarts. Deterministic per season, ~50–150 ms
  typical (worst seen ~650 ms). Every team: 17 games, one bye in weeks 5–14,
  8–9 home, 6 division / 12 in-conf / 5 inter-conf, no opponent 3×. Bye
  spread per week is a little lumpy (2–8 teams) but inside the real range.
- **Calendar constants** — `TRADE_DEADLINE_WEEK = 9` (deadline is the day
  after Week 9), `BYE_WEEK_RANGE = [5, 14]`. Exported for the franchise layer;
  surfaced in the text report header.
- **Standings tiebreakers** — full chain: head-to-head (combined for
  divisions, sweep-only for wild cards), then division / common / conference
  records, strength of victory, strength of schedule, net points, then team
  code standing in for the coin toss. The obscure "combined ranking of points
  scored and allowed" steps are folded into net points — they'd change a
  result only in vanishingly rare cases. Division winners always seed 1–4
  above wild cards, even with a losing record. When a tiebreaker actually
  decided a team's placement, `StandingRow.tiebreaker` records it in plain
  English ("conference record over BAL, PIT") — `breakTie` returns
  `{ order, notes }` and the note goes to the team that finished ahead; the
  cross-division seeding note wins over a within-division one. Shown in the
  report under each affected row.
- **Playoffs** — 7 seeds/conf, #1 bye, 2v7/3v6/4v5, re-seed each round, higher
  seed hosts, Super Bowl neutral (better seed listed home). A playoff game
  can't tie: a drawn sim is replayed with a bumped seed up to 24× and, failing
  that, awarded to the higher seed (`decidedBySeed`). Per-game seed offsets are
  fixed (`CONF_BASE` + round offset), so the round-by-round stepper
  (`startPlayoffs` → `playPlayoffRound` → `finishPlayoffs`) and the one-shot
  `simulatePlayoffs` — now defined as `finishPlayoffs(startPlayoffs(…))` —
  produce byte-identical brackets. `games` are grouped by round (all Wild Card,
  then Divisional, …), Super Bowl last.
- **Clinch / elimination tracker** (`clinch.ts`) — from games-so-far + the full
  schedule, tags each team `berth` / `division` / `bye` / `homefield` /
  `eliminated`. **Decision: conservative, bounds-only.** It reasons purely from
  each team's win floor (loses out) and ceiling (wins out) plus the pigeonhole
  on 7 spots, and it accounts for weak-division-winner displacement
  (`threats = record-catchers + 3` for a non-locked team). It never claims a
  clinch or elimination that remaining games or tiebreakers could overturn, so
  it can lag the NFL's official scenarios by ~a week and on rare completed
  seasons leaves a tiebreaker-decided team untagged — acceptable for a "never
  wrong" mid-season indicator. Surfaced by `formatStandingsThrough` /
  `npm run season -- --through W`.
- **Week-by-week loop** (`season.ts`) — `startSeason` → `playWeek` (pure step,
  returns advanced progress + that week's games) → `finishSeason` (plays out
  the rest + the playoffs). `progressStandings` / `progressClinches` /
  `remainingOpponents` read the partial state; `playoffPicture(p)` folds
  standings + clinches into a per-conference "if the season ended today"
  (7 seeds with clinch tags + tiebreaker notes) plus `inHunt` (games back from
  the #7 seed) and `eliminated`. `formatPlayoffPicture` /
  `npm run season -- --picture W`. `finishSeason(startSeason(seed,
  opts))` is byte-identical to `simulateNflSeason` (same schedule, same per-game
  seed offset = index in the 272-game slate), which is now defined as exactly
  that. This is the surface the interactive franchise UI drives.
- **Box scores** (`boxscore.ts`) — `boxScoreFor(progress, {home, away})`
  re-sims one scheduled game by its slate index (deterministic, reproduces what
  `playWeek` played) and returns a flat `BoxScore`: per-team yardage / downs /
  turnovers / red-zone / TOP plus the drive log. `fourthDown` reports
  `[conv, conv + fourth_att]` because the sim only counts `fourth_att` for
  *failed* fourth downs. `formatBoxScore` + `npm run season -- --box AWAY@HOME`.
- **Save / load** (`serde.ts`) — `SeasonProgress` / `PlayoffProgress` are plain
  JSON, so `serializeSeason` / `deserializeSeason` (and the playoff pair) are a
  version-tagged envelope + a shape check on load: rejects a stale
  `SAVE_VERSION`, the wrong kind, non-JSON, a non-272 schedule, or a
  results/`nextWeek` mismatch. `priorRankToObj` / `priorRankFromObj` bridge the
  one `Map` in the option bags.
- **`scheduleMatchups`** — the 272 `{ home, away }` pairs with no week
  assignment (no solver), for a "who plays whom" view.

### A1 add-on — coaching / coordinator layer (2026-09-10)

`src/engine/staff.ts` + `staff-shift.ts` + `staff-data.ts` (mirrored in
`analysis/engine/staff{,_shift}.py`). Fits spec §16: coaching is another
additive contributor to the same resolver-shift layer the player ratings use
(`ratings.ts`).

- **Model (hybrid, per the chosen approach)** — HC `{gameManagement, discipline,
  aggression}`, OC `{rating, scheme, passBias, tempo}`, DC `{rating, scheme,
  blitzBias}`. `Staff` per team; 32 authored on a compressed ~40–66 scale in
  `staff-data.ts` (real HC names, placeholder coordinators, schemes/biases
  loosely tracking real identity) — **v0, meant to be tuned / edited in
  franchise mode**, not a ranking.
- **Magnitude = subtle (the chosen dial).** Coefficients in `staff-shift.ts`
  sized so a best-vs-worst *authored* staff moves a game's margin ~1–2 pts and a
  contrived 95-vs-10 staff gap ~6–8 — individual games barely move, §22
  untouched. `leagueAverageStaff` (all 50s / zero biases) produces **exactly
  zero** from every shift function, so a staff-on game with neutral staffs is
  byte-identical to staff-off (verified TS + Python).
- **Wired levers (v0)** — HC discipline → penalty-hazard scale (avg of both
  HCs); HC aggression + game-management → M01 GO_FOR_IT logit; OC rating → M09
  COMPLETE + M14 rush; DC rating → opp M09 (−), M04 SACK (+), M14 rush (−); OC
  tempo → `advanceClock` runoff; DC blitzBias → M04 SACK (+) & M09 allowed (+).
- **Scheme fit** (`staff-fit.ts`, added 2026-09-10) — a unit's fit = fraction of
  starters whose `scheme_tags` overlap the coordinator's scheme, *centred* on
  the league-mean fit for that scheme (computed once over all 32 depth charts,
  the `ratings.ts` `offsets()` pattern), times a small coefficient → M09
  COMPLETE + M14 rush. `pro_style` (OFF) / `multiple` (DEF) are treated as
  scheme-agnostic and contribute **nothing** — which is also what keeps a
  neutral staff (those two schemes) an exact no-op. Verified: neutral-staff
  games stay byte-identical to staff-off with scheme fit wired (TS + Python).
- **Still deferred to v0.1** — OC passBias → M02 (needs new play-call shift
  plumbing), challenge/timeout modelling, and per-*player* (rather than
  per-unit) scheme fit.
- **Wiring** — `simulateGame(seed, home, away, { homeStaff, awayStaff })`;
  staff rides on the rating layer (no rosters ⇒ no staff). `simulateNflSeason`
  / `startSeason` / `simulateFranchise` default **staff ON** with the authored
  data (`staff: false` to disable); `SeasonProgress.useStaff` persists it.
  `npm run season -- --staff KC` prints a staff card; `--no-staff` disables.

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
**Status:** unit-level done (2026-09-10); per-player still open.

The coaching layer (`decisions.md` → A1 add-on) defines the OC/DC scheme
vocabularies (6 each) and `OFF_SCHEME_TAGS` / `DEF_SCHEME_TAGS` mapping them to
the populated `scheme_tags`. `staff-fit.ts` wires the **unit-level** in-scheme /
out-of-scheme term: a unit's fit fraction minus the league-mean fit for that
scheme (`schemeFitBaseline()`, the `ratings.ts` `offsets()` pattern) × a small
coefficient. `pro_style` / `multiple` contribute nothing (scheme-agnostic),
which keeps a neutral staff an exact no-op.

**Still open:** the per-*player* multiplier — scaling an individual player's
rating-z contribution by their own tag match rather than the unit average. That
needs threading a per-player scale into `familyModifier` / `centered`.

## OQ-4 — Aging curves
**Status:** substantially addressed (2026-09-11)

`RETIREMENT_AGE` (`ui-source/src/sim/roster-template.ts`) is now cross-checked
against recent (2023-2025) positional aging-curve research and real recent
veteran retirements rather than being purely hand-set (WR nudged 33→34 per
that research showing later receiver decline in the modern rules era).
`retirementOutcomes` (`MockSimulationService.ts`) replaces the old flat
`injury_history.length * 0.04` penalty with `injuryAgeReduction`: a real
type/severity-weighted, diminishing-returns reduction to a player's effective
retirement-age norm, grounded in recent sports-medicine findings (concussion
history costs the most, per Kuechly/Luck-era precedent; knee/ACL-pattern
injuries cost a real but more moderate amount per RTP-rate literature;
soft-tissue injuries cost little except at high severity).

**Update (2026-09-11):** found, while implementing the above, that this was a
bigger gap than "hand-set constants" - `dev_age_threshold`/
`decline_age_threshold` were set on every player at creation but nothing in
the franchise loop ever *read* them, and `RetirementReview.tsx` only ever
displayed who'd retire without actually removing them from the roster.
Neither aging nor retirement execution existed as a mechanism at all. Added
both: `agingDelta` (`MockSimulationService.ts`) is the per-player
season-over-season `overall` drift (growth while developing, tapering as the
dev threshold nears; a small random walk in the prime window; accelerating
loss past the decline threshold - same v0-heuristic caveat as the engine's
own `AGING_CURVES` in `src/model/positions.ts`, a plausible shape rather than
one fit to real year-over-year rating deltas, since no reliable public
dataset of that exists for a heuristic 0-99 scale). `applySeasonAging`
(`seed.ts`) applies it to every active player, seeded per (season, player
id), at the real season-rollover transition. `commitRetirements`
(`store.ts`) actually retires the players `RetirementReview` showed, using
the identical seed/filter so the commit matches what the human GM was shown,
fired when leaving the `offseasonRetirement` stage. Still open: the
per-position development/decline magnitudes themselves are still a
reasoned-but-unfit curve shape, same as the engine's own OQ-4 gap.

## OQ-5 — Trade value model
**Status:** substantially addressed (2026-09-11), cap situation still open

`ui-source/src/sim/MockSimulationService.ts`: player value is now overall
*and* position-weighted (`POSITION_VALUE`, researched 2026 contract
reference points, not memorized); pick value now uses real per-round
averages from the Jimmy Johnson chart (fetched + parsed from drafttek.com,
not recalled) instead of a flat `(8-round)*6` — the real chart is sharply
convex (round 1 ≈ 2.8x round 2) where the old formula was nearly flat.
Accept-likelihood also factors in whether the deal fills/leaves a real
positional need (OQ-9). Still open: a team's actual cap situation isn't
part of the trade math itself (separate from the cap now being *enforced*
on new contracts — see OQ-9's note); the vote-safeguard threshold (`>= -3`)
is still an arbitrary constant, not derived from anything.

## OQ-6 — Free-agency demand model
**Status:** substantially addressed (2026-09-11)

`contractValueFor` is now position-weighted (same `POSITION_VALUE` table as
OQ-5). Which competing offer a free agent/coach actually accepts now uses
their own stated priorities (`playerPriorities`/`coachPriorities` — team
rating for "winning now", `positionalNeed` for "a starting role", the real
`computeSchemeFit` for "scheme fit" — see OQ-9), not just the highest dollar
figure. Team context (cap room) is now enforced on the *offering* side too.
Still open: "location"/"market size" priorities have no real signal in this
data model and are left neutral; age isn't yet a direct input to demand
beyond what's already baked into `overall`.

## OQ-7 — `severity` vocabulary for injuries
**Status:** open (low stakes, easy)

Schema accepts any string. The hand-reviewed pool uses
`minor | moderate | major | severe` in `injury_history`. Likely pin to that
set (plus `season_ending`?) once the aging model consumes it — until then the
free string is fine.

## OQ-9 — AI GM decision objective (draft / FA / trades / coach hiring)
**Status:** decided (user, 2026-09-10) — **implemented across free agency,
coach hiring, draft-pick selection, trade evaluation, and which competing
offer a free agent/coach actually accepts** (`ui-source/src/state/store.ts`:
`aiOfferForPlayer`/`aiOfferForCoach`/`bestAvailable`/`offerScore`, all need-
and/or scheme-fit-weighted; `MockSimulationService.evaluateTrade`'s AI
accept-likelihood similarly need-weighted — 2026-09-11). Along the way:
- Found and fixed a real sign bug in `evaluateTrade`'s original formula (the
  AI was *more* willing to accept a trade the worse it got for itself).
- Found the salary cap was never enforced anywhere (`team.cap.used` was
  never computed, and `cap.total` used a different unit than every contract
  field around it) — `aiOfferForPlayer`/`aiOfferForCoach` now check cap room
  before picking a team. Deliberately did **not** extend this to the human's
  own `signStandingFreeAgent` action that night — a silent no-op on a blocked
  sign is worse UX than no enforcement, and doing it properly needs a real
  error path back to `FreeAgencyBoard.tsx`, not just a guard clause. Left as
  a clearly-scoped follow-up rather than shipped half-done.
  **Closed (2026-09-11):** `checkStandingSign` (`store.ts`) is a pure,
  read-only cap-room gate `signStandingFreeAgent` now runs first; on
  rejection the action returns `{ ok: false, reason }` instead of silently
  no-opping, and `ContractNegotiation`/`FreeAgencyBoard.tsx` show the reason
  inline in the negotiation modal (verified live: an over-cap offer is
  blocked with the reason shown and the modal stays open; a fitting offer
  succeeds and closes it).
- Player/coach *value* itself (positional value, draft-pick trade value) was
  also ungrounded — see OQ-5/OQ-6, now substantially addressed too.

**Update (2026-09-11):** `generateDraftClass`'s prospect *composition* (which
positions get drafted in which round, and at what age) is now grounded in
real data too. The user supplied nine years (2018-2026) of
Pro-Football-Reference draft-listing PDFs directly (the earlier "not reliably
fetchable" note was specifically about live web-fetch access, which was
hitting a bot-detection wall — not about the data not existing); those PDFs
had no text layer (print-to-PDF rasterizations), so they were OCR'd
(Tesseract, with a word-bounding-box row-reconstruction pass — the naive
`image_to_string` extraction badly scrambled PFR's wide stat table into
column-major garbage on denser pages) and parsed into 1,961 individual picks.
See `ui-source/src/sim/draft-history.ts` for the resulting
`POSITION_BY_ROUND`/`AGE_BY_POSITION` tables, sourcing detail, and the
fractional-split methodology used for years where PFR's own table only gives
a broad OL/DL/LB/DB group instead of the specific position (each broad pick
is split across its specific members using the empirical ratio from years
that do give the specific code — documented per-split sample sizes, since
the ILB/OLB split in particular rests on a thin n=31). `generateDraftClass`
now draws each pick's position and age from these real distributions instead
of a flat, round-agnostic heuristic. retirement-age curves are addressed
above (OQ-4). Still an honest gap: prospect *grade*/overall distribution by
pick slot is still a synthetic decay curve, not fit to real draft-outcome
data — PFR's Approximate Value columns didn't OCR reliably enough (misaligned
digits, 0/O confusion) to trust for that purpose, so it was deliberately left
alone rather than shipped on shaky data.

Every AI-driven roster decision (draft-class evaluation and pick selection,
free-agency bidding, trade proposals/acceptance, coach hiring) must optimize
for **winning** — a team's actual competitiveness (needs by position, scheme
fit against the roster's existing scheme, cap-efficient value, positional
scarcity/replaceability, depth-chart construction) — **not** for maximizing
the sum/average of roster `overall`. A naive "always take the highest-overall
player available" AI is explicitly wrong: it ignores position need, drafts
3 QBs before a starting OL, overpays scheme-mismatched free agents, and
produces unrealistic, unwinnable-looking rosters. This applies to OQ-5
(trade value: a trade's value to an AI team is about the roster it produces,
not raw point totals) and OQ-6 (FA demand: which team a player picks from
competing offers factors in likely playing time / scheme fit / team
competitiveness, not just the highest number) equally — and to the
not-yet-modeled draft-class evaluation and coach-hiring logic. Any
`ui-source/src/sim/MockSimulationService.ts` replacement (or the UI's own
AI-GM logic once real-backed) should be evaluated against this before
shipping, not just "does the roster's average `overall` look plausible."

## OQ-10 — Home-field advantage

**Status: closed.** The engine gives the home team a measured advantage, fitted
to the league's own home win rate. `src/engine/home-field.ts`, mirrored in
`analysis/engine/home_field.py`.

### How the gap was found

Measuring what a rating gap is worth (`analysis/30_win_probability.ts`,
47,616 games) answered a question it wasn't asked. Fitting

    P(home win) = 1 / (1 + exp(-(A + B * gap)))

returned **A = -0.013** — 49.7% for an even matchup. And that residue was not
a small home-field edge: 1.0% of games end tied, a tie is not a home win, and
scoring ties against the home team moves an even matchup from 0.500 to about
0.495. The intercept *was* the tie rate. The engine gave the home team
nothing.

### How big it should be, and where it lives

`analysis/31_home_field.py` reads both off the same 2018-2025 play-by-play the
engine is calibrated against — 2,127 regular-season games:

- **54.02%** of games won by the home team (ties as half), by a mean margin of
  **+1.573**. Worth measuring rather than quoting: the historical figure is
  nearer 57%, and the answer for the era this engine models is not.
- And, by splitting each channel on `posteam_type`, *where* the advantage
  shows up. Every channel favours the home offense:

  | channel | home | away |
  |---|---|---|
  | completion rate | 0.60811 | 0.59647 |
  | sack rate per dropback | 0.06196 | 0.06473 |
  | interception rate per dropback | 0.01999 | 0.02056 |
  | field goals made | 0.85023 | 0.84177 |
  | yards per carry | 4.557 | 4.496 |
  | pre-snap fouls per play | 0.01857 | 0.01964 |

Two of those readings carry weight beyond their size. Field-goal *distance*
attempted is 39.15 at home against 39.21 away, so the kicking gap is kickers
kicking better rather than an easier set of attempts. And the foul gap is
almost entirely pre-snap: subtract those and the live-ball rate differs by
0.7%, which is nothing. That is the crowd-noise story appearing exactly where
the story says it should, in the snap count.

One column points the wrong way. Raw EPA per play is *higher* for the away
offense, which is score-state confounding rather than a finding: the home team
leads more often, so it runs more and throws shorter. The same confound
suppresses every other column, which matters for reading the fit below.

### The design

Each channel's home-away difference is halved and applied as `+half` to the
home offense and `-half` to the away one, through the same shift points the
coaching layer already uses — M09 COMPLETE and INTERCEPTION, M04 SACK, M20
MADE, the rushing modifier, and the dead-ball penalty hazard.

**Symmetry is the load-bearing part.** Because the split is symmetric and
every team plays half its games at home, the league average does not move.
Measured across scales that shift the home win rate by twelve points, points
per team-game reads 20.84, 20.82, 20.84. Nothing §22 measures league-wide
changes.

**And it is gated on the rating layer**, so a pool-free `simulateGame(seed)`
is byte-identical to the pre-OQ-10 engine. That is not a detail:
`23_full_sim_validation.py` sims with no team codes, so the validation the
engine was signed off against is untouched rather than re-run.

The Super Bowl passes `neutralSite` and gets nothing, which is what a neutral
site means.

### The fit, and the one target it misses

`analysis/32_fit_home_field.ts` sweeps the one scalar over every ordered pair
of the 32 teams — a design where roster strength cancels exactly, so the home
win rate that comes out is the home-field effect and nothing else.

| scale | home win % | mean margin | points/team-game | games |
|---|---|---|---|---|
| 0 | 50.18% | +0.13 | 20.84 | 3,968 |
| 1.00 | 53.62% | +1.19 | 20.70 | 19,840 |
| **1.11** | **54.23%** | **+1.36** | **20.77** | **19,840** |
| 2.00 | 57.27% | +2.53 | 20.82 | 3,968 |
| 4.00 | 62.51% | +4.31 | 20.84 | 3,968 |

Anchored on the scale-1 point, the league's 54.02% wanted **1.11**, and a
second 19,840-game run at that value returned **54.23% — 0.21pp high, inside
the 0.36pp standard error**. So the measured per-channel gaps need scaling by
a tenth and no more: the mechanism is doing essentially all of the work, which
was not the expected result given the score-state confound above would have
justified a scale of two or three.

**Win rate was fitted; mean margin was not, and misses.** The league's +1.573
margin would want a scale of 1.32, which puts the win rate at 54.8% — two
standard errors *above* the league, trading a miss inside the noise for one
outside it. So the engine's home teams win as often as the league's (54.23%
against 54.02%) by a smaller margin than the league's (+1.36 against +1.57). Efficiency shifts convert into wins more
readily than into points; closing the rest would mean modelling the part of
the advantage that isn't efficiency — field position off returns, and
fourth-down nerve in front of a crowd.

### What the UI does with it

`ui-source/src/sim/win-probability.ts` has a venue term again, and the team
hub, the bracket and the Mock's own playoff coin-flip all pass home, away or
neutral. The advantage is worth about 1.1 rating points, so a one-point
underdog at home is a coin flip and a two-point underdog is not.
## OQ-10 addendum — the engine as validated vs the engine as played

The §22/§26 work settled on a residual of **≈ −0.8 ± 0.4 points per team-game**
against the real league — "small, borderline, and diffuse", and left open.
Worth recording alongside it: the franchise game does not run the engine in
the configuration that residual was measured in.

Measured over 500 games per configuration, real rosters:

| configuration | points/team-game |
|---|---|
| staff on, injuries off — the validation path | 21.17 |
| neither | 21.09 |
| injuries on, staff off — **what `server/index.ts` runs** | 20.71 |
| both on | 20.52 |

So in-game injuries cost about **0.46 points per team-game**, and the
franchise adapter has them on while the validation harness does not. That is
not an error in either — a game with injuries in it *should* score slightly
less — but it means the played game sits about half a point below the
calibrated one, which roughly doubles the known residual for anyone reading
the box scores rather than the validation report.

Two things follow, neither urgent:

- Any future re-calibration should decide which configuration it is
  calibrating, and say so. Closing the −0.8 gap against the no-injury path
  would leave the played game still low.
- The coaching layer is very nearly free in aggregate (+0.08 without
  injuries), which is what `leagueAverageStaff` being exactly zero predicts.
  It shifts individual matchups, not the league's scoring.

## Synergy — position groups that are more than their average

**The gap.** Every rating family reads a unit through its *mean*, so the
engine was exactly additive: five great linemen were worth five times one,
one bad lineman cost exactly his fifth, and two great edge rushers were worth
exactly twice one. The run game had it worst — `rushYardsShift` took the
offensive line as an argument and ignored it, so blocking did nothing for the
run at all. A fantasy draft lets a GM build units no real team could afford,
which is where additivity reads most wrong.

**The design** (`src/engine/synergy.ts`). One pairwise term over per-player
skill z-scores, `J(a, b) = min(a, b) · |max(a, b)|`: superadditive when both
are good, a drag when one is bad (the weak link), compounding when both are
bad. Groups are weighted means of `J` over their pairs, with the pairs that
work together weighted up (adjacent linemen, the corner pair, the edge pair).
Units covered: OL pass protection and run blocking (with the TE), RB × line,
QB × each receiver, the pass rush (edge pair dominant), the secondary, LBs
who cover × the secondary, the front four's run defense, LBs who fit the run
× the front, pressure × coverage — and one term that reads *both* teams, this
defense's rush against this offense's protection (weak-link-weighted), which
feeds sacks, completions and interceptions. It rides the same three channels
as the rating layer and team strength (M09, M04, M14) plus interceptions;
nothing touches the scoreboard directly.

**Keeping the calibration.** Every term is centred on the 32 reference depth
charts (the matchup term on every ordered pair of different teams), so an
ordinary roster nets ~0. Each channel's total is soft-capped with `tanh` so
compounding can't run past real-world extremes. TS-only (no Python mirror);
pool-free paths never reach it and stay byte-identical.

**The fit** (`analysis/33_synergy.ts`, every ordered pair of reference teams):

| | synergy off | on | real |
|---|---:|---:|---:|
| points / team-game | 20.45 | 20.44 | — |
| completion % | 64.4 | 64.3 | — |
| sack % | 7.17 | 7.00 | — |
| YPC | 4.43 | 4.42 | — |
| points sd | 9.32 | 9.90 | 9.93 |
| margin sd | 14.47 | 15.13 | 14.33 |
| favourite win % | 68.8 | 67.2 | 66–70 |

Means sit still; the spread moves toward real (points sd lands on it; margin
sd +5.6%, inside the ±10% bar).

Unit experiments on the median team (sack %, YPC, completion % — linear → synergy):
five elite linemen 4.31 → 2.53 sacks and 4.38 → 4.77 YPC, where three elite
went only to 3.71 / 4.48 and four elite plus one bad to 5.06 / 4.37; elite line
+ elite back 5.63 YPC; two elite edges force 2.6× the sacks of one over
baseline (linear: 1.6×), one elite next to a bad one is *below* baseline;
great QB + great WR 71.6% completion, horrible QB + great WR ~50%. The
matchup: the league's weakest starting line against its two best rushers
goes 18.2% sacks / 53.1% / 5.76 YPA / 4.7% INT, against 6.8 / 63.0 / 6.85 /
2.7 for an ordinary matchup — +2.4 points of sacks beyond the two sides
summed (linear: +0.3).

**Knobs.** `SYNERGY_WEIGHTS` (per channel), `SATURATION` / `SACK_CEILING_UP`,
and `setSynergyScale` for A/B runs. `test/engine-synergy.test.ts` pins the
*shape* — superadditive, weak-link, >2× edge pair, bad QB tanks a great WR,
matchup compounds, centring — not the sizes, which may be retuned.

## Unit links — each channel read from the units that play in it

The team-strength index used to be one number per side, so an elite running
back made his quarterback complete more passes and get sacked less, and an
elite corner stopped the run as well as an elite tackle. `CHANNEL_UNITS`
(`src/engine/team-strength.ts`) now builds a separate index per channel from
the positions that decide it: the passing game (QB, receivers, protection vs
the secondary, the linebackers and the rush), sacks (line and QB vs the rush
*and* the coverage that makes him hold it), interceptions (QB decisions vs
ball-hawking DBs and a rush that forces throws — a channel with no
team-quality term before), and the run game (line and back vs the front seven
and the safeties). `PER_POINT` was rescaled by each channel's real-team spread
so games swing as much as before; what changed is who swings them.

Each channel's league offset is fitted per talent setting
(`analysis/40_channel_calibration.ts`): sacks and INTs to their rates, and
completions and the run game together to scoring, because the engine's red
zone converts short and all-four-rates-exact scores ~20 a game.

Measured on the median team with each unit swapped for elite starters
(`analysis/38_unit_links.ts`, talent 1.5, 248 common-seed games):

| elite | margin | opp cmp | opp INT | opp sack | own |
|---|---:|---:|---:|---:|---|
| QB | +8.2 | | | | cmp +12.1, INT −2.0 |
| OL | +9.0 | | | | sack −3.8, ypc +1.4, INT −0.9 |
| RB | +5.4 | | | | ypc +1.3 (was +6.2 margin, nearly a QB) |
| DL | +14.0 | −6.8 | +0.67 | +12.7 | ypc against −1.0 |
| DB | +10.5 | −14.4 | +1.97 | +2.7 | |

A great rush makes the secondary intercept more; a great secondary produces
coverage sacks. Defense / offense sum of unit margins: 0.95.

League (`analysis/39_league_metrics.ts`, talent 1, 1,984 games): points 22.9
(+1.4%), points sd −2.0%, margin sd +4.1%, favourite 68.8%, INT −1.3%, sack
−2.2%, completion +6.8% and YPC +8.9% (the price of the scoring fit).

**Credit follows skill** (`creditWeight` in `synergy.ts`): sacks, picks,
breakups, tackles and forced fumbles tilt each slot's share by the player's
skill *against his own position's starters*, so it never changes a result,
only whose line it lands on. Incompletions are now a breakup about a third of
the time (passes defended read zero league-wide before), batted balls
included. Season leaders at talent 1.5 (`analysis/41_defensive_leaders.ts`):
sacks 23, INT 11, PD 33, tackles 174.

The Master AI's unit weights and the price table were re-measured from the
same harness; Master vs Expert margin went +1.0 → +1.7 (talent 1) and
+0.5 → +1.8 (talent 1.5). DPOY scoring now favours splash plays over tackle
volume.

## The 2026-10 realism pass: rotation, blitz, weather, calibration, contracts

**Engine.** `RUNNER_OWN_SHARE = 0.65` on the fitted runner family: the
family had no line term, so the back took the line's credit, and with the
line now carrying its own run-game channels the back was counted with it
(an elite back was worth ~QB). The defensive front rotates (`Game.rotation`,
a hash of the snap, never the RNG): starting DTs rest ~30% of snaps and edges
~20%, more on long drives, so line depth matters. A coordinator's blitz bias
now depends on the personnel around it (`blitzContext`: coverage left behind,
protection, quarterback). Weather (`weather.ts`) by venue and week: wind,
cold, rain/snow, domes, Denver's air, deterministic from venue/week/seed and
threaded through every franchise game and replay (`weatherFor`).

**Calibration** (`CALIB_BY_TALENT`, `analysis/40_channel_calibration.ts`).
With completions, INTs, sacks and YPC exact, a game scored ~20. The causes
were measured (`analysis/39_league_metrics.ts`): the red zone (TD rate
0.50 vs 0.56), no long-run tail, third downs (35% vs 39%), kicking. Each got
its own fitted term, and a final shared nudge closes the remaining ~1.3
points. At talent 1, over 1,984 games: points +0.1%, points sd −2.9%, margin
sd +4.0%, favourite 68.7%, completion +3.2%, INT +1.1%, sack +1.2%, YPC
+4.2%, red-zone TD +6.7%, third down +3.3%, FG −1.1%, drives +0.4%, punts
−1.3%. `test/engine-realism.test.ts` guards these bands on every test run.

**Unit values after the pass** (median team, elite starters swapped in,
talent 1.5): QB +7.4, RB +3.5, WR +4.3, TE +2.0, OL +9.6, EDGE +7.5, DT +2.9,
LB +3.5, CB +5.7, S +4.0, defense/offense 1.02. The Master AI's weights and
the price table were re-derived from these. The Master-vs-Expert benchmark
now reads within its own noise (a 320-game margin has a standard error of ~0.8).

**Franchise.** Franchise tag (top-5 average at the position, ≥120% of
current pay, one a team a season), fifth-year option for first-rounders
(tiered like the real one), holdouts (an underpaid star on a human team sits
until extended, traded, or the deadline; CPU teams pay if their budget
allows, at most one a team), compensatory picks (net free-agent losses,
rounds 3–7, not tradeable, the pre-2017 rule), a 16-man practice squad
(`nfl_team = "PS:<team>"`, so no roster filter has to know about it), and a
persistent career record book with the NFL's real marks and an in-season
record watch.

**Online.** Web Push (`online/src/push.ts`), see `online/README.md`.

## The hot seat: human GMs can be fired

After the season (stage `offseasonHotSeat`, between the season-end screens and
the retirement review) every human GM is scored 0–100 on the last five
seasons with their current team (`ui-source/src/state/hotSeat.ts`): start 60;
±4 per win above/below .500; +10 for the playoffs, −2 for missing them; +5 per
round won; +15 for the title. 55+ secure, 40–54 warm, 20–39 hot seat, below 20
fired, and never before the third season with a team (so the Hooded Figure,
which triggers on two losing seasons, gets to act first). A fired GM chooses
one of the five worst CPU-run teams (nobody else's); the old team goes to the
CPU, and the new tenure starts at zero. One who doesn't choose (away, or the
timer) takes the worst on offer as the stage closes. Computed from
`state.history` plus a per-season `state.hotSeat` snapshot (so options and
choices survive a reload). Online, the move goes through `actions/job`, and
`withLeague` keeps the `franchises` seat table in step with the document.

## Motion: Framer Motion, three levels, a moment for every score

The interface moves, at a level the player chooses per device (Full / Subtle /
Off, `ui-source/src/motion/level.ts`; with no saved choice it follows the OS
"reduce motion" setting). The level is mirrored on `<html data-motion>`: CSS
reads it to scale the `--dur*` tokens (everything in the stylesheet already
takes its timing from them) and the Framer-driven parts read it through
`useMotion()`. Framer Motion loads through `LazyMotion` with the DOM feature
set only (`m` components, never `motion`); it costs about +30 KB gzipped on a
~390 KB game. Motion is enter-only (no exit animations: an old screen never
holds up the next one) and animates transform and opacity, so it stays on the
compositor while a week simulates.

What moves: the routed screen slides in; stat figures count to new values
(`CountedValue` in `primitives.tsx`, which parses "$165.2M" and keeps its
format); rows rise in a staggered cascade capped at ~0.6 s however long the
list (`ExpandableRow` is its own stagger item inside a `StaggerList`); detail
panels grow open; team colours are registered `@property` colours, so a
change of team (a new job after a firing) blends instead of snapping. The big
beats are `ScoreMoment`: every score in the gamecast, in the *scoring team's*
colours (so the opponent's touchdown is as big as yours in theirs), the
viewer's draft picks (first-round picks by others in the quiet version), the
champion, and taking a new job. Full is a banner sweep, an overshooting label
and confetti; Subtle a brief band and label; Off nothing. Cues come from the
existing audio engine (`audio/cues.ts`), whose own switch mutes them.

The embedded preview browser throttles to ~2 fps, so smoothness and feel were
verified structurally (what renders at each level, final states, clean-up) and
need a human eye on a normal screen.

Later additions to the same system: every table body's rows rise in order from
one global CSS rule (`tbody > tr`, step 30 ms full / 12 ms subtle, capped at
the 24th row), so the thirty-odd tables need no per-screen code; and taking a
new job has its own cue (`newJob` in `audio/cues.ts`). The motion screens were
checked at a 375 px phone width for sideways overflow: none.

**Optimization pass.**
- Count-ups write each frame straight to the DOM instead of through React
  state, so a running count no longer re-renders its component sixty times a
  second.
- A count started in a background tab lands on the value at once, and an
  interrupted count never leaves a half-counted figure.
- Score moments render through a portal on `<body>`, so a moment fired while
  a screen is still sliding in can't be trapped inside the transformed
  wrapper.
- A moment in a hidden tab is skipped and releases whatever was waiting on it.
- Lists and tables animate only their first 24 rows; the rest appear with no
  animation work at all (a 120-row market cost 120 animations; it now costs
  24).

**Gamecast.**
- The ball glides between spots (CSS transform transitions timed from the
  playback speed, never longer than a play's slot).
- At 1x a cinematic score holds the replay until its moment finishes, the
  way a broadcast holds on a celebration.
- At 2x and up moments use the brisk version, so a skimmed replay is never
  covered.
- The viewer's own game ends with a Victory / Defeat moment in the winner's
  colours; a loss is the brisk one.
- Headline results on Game Day and the results screens count up from zero as
  they are revealed.
- Full-screen interstitials and dialogs fade and lift in.


## A soft limit on how far a roster can move a channel (the "nobody throws" bug)

A weak team's passing game collapsed. Each channel's logit is the sum of the
rating families, the team-strength index and synergy, with no ceiling; a
54-rated quarterback behind a 58-rated line against an 83-rated defence summed
to about +2.8 on the sack logit, a sack on half of all dropbacks, 4.6
interceptions a game, twelve pass attempts and two points. Real teams never get
there (the worst offence in the pool sacks 14%), but a fantasy draft or a
freshly generated league can build one, and the league the bug was found in had
a 20-point spread between its best and worst offence index.

`softCap` (`src/engine/sim.ts`, `SHIFT_LIMIT`) bends the roster shift of each
channel (complete, sack, interception, run) toward a ceiling beyond a knee, and
leaves everything inside the knee exactly as it was. It acts on the raw sum
*before* the talent scale multiplies it, so Amplified and Extreme still make a
stacked team win by more (`test/engine-talent.test.ts` pins that). Home field,
coaching and the league calibration sit outside it. League numbers are
unchanged (talent 1, 992 games: points -0.3%, margin sd 14.37 vs 14.33,
completion +3.3%, INT +0.2%, sack +1.0%). `test/engine-realism.test.ts` plays
a deliberately sub-worst offence against the league's best defence and requires
more than 20 attempts a game, a sack rate under 22% and more than four points.

## Roster construction, draft settings, playoffs, and the compare tab (2026-10)

**Roster construction (audit, no change to the AI).** An 8-season dynasty
audit (`online/test/_spread.test.ts`, scratch) measured the AI teams' average
starter rating: sd 1.0-1.8 across the league, against 1.9 for the real rosters, so
the AI GMs' differing philosophies don't spread teams further than real life;
offense/defense and QB/line spreads track the real ones. The only holes were
momentary (a starting QB whose deal had just expired is a free agent at season
end and is replaced by the next preseason: the worst starting QB was 75-79
every year). The lopsided league that exposed the passing collapse came from the
non-default start, below, and from the engine having no ceiling (see "A soft
limit").

**Fantasy draft off now starts from real rosters.** A new league's pool is
normalised once, under the default (draft on), which releases every player and
forgot who he played for; switching the draft off in setup changed the flag
and nothing else, so every team started with no players. Players now remember
their team (`home_team`), and `applyDraftSetting` re-normalises the pool
whenever the setting changes during setup, locally and from the online
commissioner's settings; a save from before the field rebuilds it from the
seeded real pool.

**Fantasy draft order.** The order was seeded on the league seed, and the app's
first league (and any created with the default seed) used seed 1, so one
franchise had the first pick every time. The initial league now gets a random
seed, and a league with the legacy default seed draws and keeps a random salt
(`draftSalt`); a league with a real seed still derives its order from it.

**Playoff games run the regular-season simulation.** The local adapter played
them without in-game injuries and returned only scores. They now go through the
same options as a regular-season week (`injuries` and `trace` on) and the same
box-score builder (`presentGame` in `server/simGame.ts`); the client stores them
in `games` with the same ids online uses, the viewer's with play-by-play, and
applies their injuries. `test/engine-playoffs.test.ts` plays a game via
`decidePlayoffGame` and via `simulateGame` with the franchise options and
requires the identical result.

**Job security: playoff drought.** From the third season, every consecutive
season with no playoff win beyond the second costs 10 more (a first-round loss
doesn't end it). Five 8-9 years with no January now ends a GM.

**How they compare.** Each unit rank on the matchup tab has its figures
underneath, with the league rank: offense (points, rushing, passing, completion
%, separation, pressure allowed, time of possession), defense (points, passing
and rushing yards allowed, interceptions, fumble recoveries), special teams
(kicking points, kick and punt return TDs, own and opponents' average start).
`teamProduction` aggregates the box-score totals (new counts: attempts,
completions, sacks, QB hits, interceptions, fumbles lost, return TDs, extra
points, drive starts) over the games the GM has seen. Separation is a modelled
estimate (receivers' route running and hands against the coverage, by depth),
not a simulated quantity; it never affects a game.

## Franchise quarterbacks and the game plan (2026-10)

**Franchise QBs.** The value curve priced a 94 quarterback at two firsts, two
seconds and a third, and a GM bought Joe Burrow for that. `franchiseQbPremium`
(`MockSimulationService.ts`) multiplies a quarterback's value steeply past 80
(x2.4 at 84, x5.5 at 90, x8.5 at 94, a smaller premium for a non-starter), and
`evaluateTrade` refuses outright (`refusal`, acceptance 0, shown on the trade
screen) to move a team's franchise QB (its best QB, 84+, 36 or younger) for
anything but a quarterback within four points who is 34 or younger.

**Game plan** (`src/engine/gameplan.ts`, `GamePlanScreen`, `/game-plan`). A team's
dials: pass rate (+-15 points), go-for-it tendency on fourth down in three
zones (opponent's red zone, opponent's territory, own territory; off in the last
two minutes), blitz rate, the 11/12/13 personnel mix, and the second back's
share of runs. Every dial is a change from the validated engine and the default
plan is byte-identical to no plan (`test/engine-gameplan.test.ts`). Each has
a price: passing costs sacks, going for it costs field goals, blitzing costs
the big play (and depends on the corners and the opposing line), heavy sets run
better and throw worse, a committee is fresher with a worse back behind him.
CPU teams play the plan their GM philosophy implies (`aiGamePlan`), which keeps
league scoring and pass rate within the noise. A human's plan is saved on the
league (`gamePlans`, online via `actions/gameplan` with every dial clamped
server-side) and applies to every game simulated after it is saved; online, the
plans a block was simulated with are stored on each game (`GameResult.plans`) so a
replay is that game and not the plan as it is now.

It is a screen reached from the rail and from a strip on the weekly hub, not a
stage in the stage machine: the football is simulated in blocks online and a
gate between every set of games would have meant a new checkpoint in every
league.

### Game plan, second pass (2026-10)

**Blitz and tight ends.** A blitz is worth what the people sending it and facing it
are worth: 40% the defensive line, 30% linebackers, 30% corners and safeties
(`blitzEffect`), minus the offence's protection and quarterback. Heavier
personnel is worth what the tight ends are: their blocking adds to the run and
holds the rush off, and a second tight end who out-catches the third receiver
makes 12 personnel a passing set (`personnelQuality`).

**Lean costs and payoffs.** A defence plays a lopsided tendency: heavy passing
loses completions per point, heavy running loses yards a carry, and each pays
back in proportion to the offence's own grade for it (`leanDelta`,
`styleGrades`). A running plan on a good line and back also keeps the ball: more
clock per carry (`advanceClock`), so the other side gets fewer snaps.

**AI strategies** (`STRATEGY_PLANS`) are tuned by `analysis/42_strategy_tournament.ts`:
32 rosters x plan against the standard plan on identical seeds. Last run
(60 games a roster, talent 1.5, points of margin; overall / best-fit 8 / worst-fit 8):
offense_heavy +0.15 / +0.91 / -1.10, defense_heavy -0.09 / +0.67 / -1.36,
pass_heavy -0.10 / +1.16 / -1.97, run_heavy -0.09 / +0.41 / -1.03,
high_ceiling +0.49 / +1.11 / -0.77, high_floor -0.14 / -0.17 / -0.42 (low
variance is its point, it only breaks even), trenches_first -0.09 / -0.18 / -0.67
(not yet positive on its best-fit rosters). No style steamrolls.

**Seven more dials.** Quarterback runs (scrambles and designed keepers, priced by
the quarterback's athleticism, `qbMobilityZ`: Jackson ~ +1.8, Cousins ~ -1.6),
two-point tries (0 is the engine as it was, a kick every time; positive follows
the chart then widens, negative kicks everything but a late tie try), fourth and
short / fourth and long (added to the zone dials by distance), kickoffs (deep for
the touchback vs pinned and covered, by the kicker's leg), returns (bring it back
vs fair catch, by the returner), and rookie playing time (a rookie starts ahead of
a veteran within 4 overall points; he develops faster at training camp, a veteran
who sits him slows him: `withRookiePlaytime`, `rookieDevelopment`).

**Keeping decisions sane.** The fourth-down push is capped (`fourthSane`: no go
from fourth-and-15, from inside the own 20, or from fourth-and-long in the own
end; a team behind late can't be pushed into a punt), no field goal past 62
yards, no two-point try with a 17-point lead, and the last two minutes belong to
the clock. `nonsense()` is a separate statement of the rules and
`test/engine-gameplan-levers.test.ts` runs every decision of four extreme plans
through it (it caught three fourth-and-15+ go-for-its on the first run).

**What the levers are worth** (`analysis/43_lever_audit.ts`, points of margin;
noise is about +-0.3 on an overall figure): quarterback runs +100 is +0.04
overall, +0.91 on the 8 most athletic quarterbacks, -0.96 on the 8 least.
Kickoffs deep +100 are +0.98 with the strongest legs and -1.19 with the weakest.
Rookies +100 cost -0.49 now (what you pay for development). Fourth and short
+100 is +0.48 and -100 is -0.50: going on short yardage is a real edge in this
engine, as it is in the league. Two-point tries, fourth and long, returns and
the kickoff overalls are inside the noise.

## GM identity, CPU GMs and the staff (2026-10)

**A strategy belongs to a GM.** It used to be a hash of team and season, so a
franchise's philosophy changed every year and belonged to nobody. Its job is to
make rosters differ, so now it goes where the GM goes (`state/aiGms.ts`).
`LeagueState.aiGms` holds every CPU GM: a name, a strategy, a skill, the team
they run (or null in the pool), when they last worked, and a season-by-season
record. The league keeps more of them than CPU teams (`poolExtras`: the larger
of 8 and 40% of the CPU teams). A new league seats them in team order from a
shuffled deck of the eight strategies, so no league is eight GMs of one mind.
`syncAiGms` is idempotent and keeps the roster in step with who runs what (a
person takes a team and its GM goes to the pool; a seat reopens and the pool
supplies one); a hosted league keeps it in step at every stage entry (`onStageEntered`). Saves from
before CPU GMs existed are not migrated; `strategyOf` falls back to the old hash for them. Everything that read `strategyFor`
now reads `strategyOf(state, team)`.

**Skill, a normal curve inside a difficulty.** A GM's skill is a bell-curve draw
(z, clipped at +-2.2) and moves them 0.3 of a level per standard deviation
along casual 0 .. master 4 (`effectiveLevel`), so the best Competitive GM is
past the halfway mark to Expert and the worst is past it toward Standard.
`difficultyProfileAt` blends the two neighbouring profiles (numbers linearly;
search depth and strict trades take the nearer level's). `difficultyFor(state,
team)` is what every decision site now calls: a person's own team plays at
Expert as before.

**The firing block.** The hot seat's score (`securityOfTenure`, extracted from
`jobSecurity`) is applied to the CPU GMs too: their seasons are recorded at the
same point as a person's (`recordAiOutcomes`) and `ensureHotSeat` runs
`runAiFirings` once a season. A fired GM joins the pool and the team hires a
different mind (a different strategy from the one it let go) from whoever has
been out of work longest; a GM who has not worked in years has no recent bad
results, and one fired this season is hired last. Nobody is fired before a
third season with a team. The Hot Seat screen's "Around the league" tab shows
who was let go, who replaced them, and which CPU GMs are on the seat.

**People choose an identity too**, at team select and before the fantasy draft
(`GmIdentityPicker`, `chooseGmStrategy`, `/actions/strategy`), and may change it
once a year at the owners' review (the hot seat screen); it is locked the rest
of the year, rides on the `Gm` (so a fired GM keeps it into a new
job), steers their fantasy-draft auto-picks (the human branch of
`planAutopicks` no longer plays "balanced"), and steers what their staff does.
It is not shown to anyone else (`gmIdentity` returns none for a person) and
the online pull strips other people's identity and game plan.

**Seen in the app.** Every team's GM and identity ("Prioritizes the trenches",
"Prioritizes the pass", "Defense first", ...) show on the matchup tab, the
postseason bracket and the trade window (with the positions that GM pays up
for). The fantasy-draft summary's bars are replaced by a map of every team by
offense and defense, coloured by identity, and each identity's teams ranked
within the group and against the league with the units that group built
stronger than the league (`state/draftIdentity.ts`, `IdentityMap`).

**Staff sign.** Free agency and the trade deadline get the roster fix's
mechanism: "Let my staff take this turn" shows exactly what the staff would do
(`chooseFaMove`, `staffDeadlineMove`: the CPU teams' own choosers, led by the
GM's identity) and does it only on a yes, through the same action a person
would have sent. A CPU free-agency turn is now `chooseFaMove` then apply, so
the CPU teams and a person's staff are the same code; free agency and the CPU
deadline buyers gained a bounded identity term.

## Audit of the game-plan / GM-identity stretch (2026-10)

Driven by one question: does an engaged person's team do as well as the CPU's?
It did not. An engaged GM (identity set, staff running free agency and the
deadline, re-signing starters) still collapsed to 1-16 within four seasons.

**Defect: a person could almost never extend a star.** `extendContract` judged
next year's cap from *this* year's payroll (`team.cap.used`, a few million
under the cap in season), so 11 of 32 teams could not extend their best player
even in preseason, and nearly none in season. The CPU re-signs through
`applyExtension` against next year's commitments, so only people were hit:
the measured human team lost an 87 QB to free agency and went 4-13 twice with
a roster the screens ranked third. Now judged against `nextYearCommitments`
(`extensionCap.test.ts`). With it, the same engaged GM went 5-11, 15-2, 12-5,
15-2, 9-7, 13-4, 11-6, 8-9 and was never fired.

**Staff re-sign.** The expiring-contracts notice offers "Let my staff re-sign
the core": the exact list the CPU teams use (`planCoreResign`, extracted from
`resignAiCore`), within next year's budget, shown first, signed on a yes.
Holdouts (a person-only cost; CPU teams pay theirs as camp opens) now appear
in the same notice with their price and a "Pay him" button.

**Team ratings weighted by position.** The starting-lineup overall was a plain
mean of 24 starters, so a 73 QB counted as much as a 73 guard. Each starter is
now weighted by his unit's measured worth (`UNITS` in `unitValue.ts`, shared
among its starters; a QB is about 3.5x an average starter). Against 24 engine
games per team on the real rosters, the rating's correlation with margin rose
from 0.877 to 0.926. It feeds the win probabilities, rankings and free agents'
"winning now" appeal.

**Fantasy draft defaults to snake.** With the same order every round, slots
1-8 finished 1.7 starting-lineup points ahead of slots 25-32 on luck alone;
snake order, 0.7. Still selectable.

**Trenches-first plan retuned** to `{ passRate -4, heavy personnel, blitz 20,
fourthShort 30, rbCommittee 30 }`: tournament overall +0.03, best-fit +0.48,
worst-fit -0.46 (was -0.09 / -0.18 / -0.67). `high_floor` is unchanged: its
point is lower variance, which a mean-margin tournament cannot see.

**Smaller fixes.** Camp focus's development tie-break follows the GM's skill
rather than the league's difficulty label; CPU GMs of franchises a humans-only
league deletes return to the pool; coincident dots on the identity map fan
out; a slow draft test got headroom under load.

**Checked and left alone.** Default-plan byte-identity; replays (36/36 in the
dynasty); CPU firings run 1-6 an offseason (NFL-like), the pool never drains,
a replacement never shares the fired GM's strategy; no remaining direct reads
of `config.difficulty` or `strategyFor`; the new screens at phone width (no
horizontal scroll).

### Audit follow-ups (2026-10)

**Rookie development follows who plays.** The camp bonus used to go to every
rookie whether he played or not (about +1 a year across ~14 young players a
team, for a cost of a few starts: a free upgrade). It now goes by role
(`rookieRoles`, `src/engine/rookies.ts`, browser-safe): the rookie the policy
promotes ahead of a better veteran grows most (x1.6), one who starts on merit a
little (x0.4), a rookie it sits who would have started loses a point under a
negative dial; a rookie on the bench either way is unchanged
(`rookieCamp.test.ts`).

**Kickoff and return dials re-priced** with a 1,500-game isolated benchmark
(returns +100: all +0.26, best returners +0.09, worst -0.16 points a game, noise
about 0.4; the league-wide lever audit is too noisy for these two). Pinning the
kickoff short was a free lunch (+0.56 even with weak kickers): it now costs
more return touchdowns and less field position, helping with a strong leg.
Bringing everything back raised return touchdowns 0.049 to 0.083 a game for
every returner and now carries a flat yardage cost and a **fumble risk** (about
2.5% of live returns at the full dial, more with poor hands; a kickoff fumble
gives the kicking team the ball where it fell, a punt fumble the punting team).
Fair catching risks none. The broadcast and gamecast describe a fumbled punt
return.

**high_ceiling's CPU plan trimmed** (+0.46 to +0.31 overall in the tournament;
fit stays positive). **Variance is now measured**: the tournament reports the
standard deviation of a game's margin, the close-game win rate and 17+ point
losses. high_floor narrows the spread by 0.53 points (and costs 0.05 a game);
pass_heavy widens it by 0.86 and adds 2.3 points of 17+ point losses; so the
styles are doing what their names say. Close-game win rate fell for every plan
(-1.4 to -6.8 points); not understood, not acted on.

**Statistical tests.** `SEED_SHIFT` runs the plan tests on a different set of
seeds. The first attempt at this check silently changed nothing (an assertion
aborted the edit), so its "robust" result was meaningless; the real one found two
fragile assertions (the fourth-down go rate, ball control), now measured on
300 games with smaller bars; all plan tests pass at shifts 0, 2000, 3000 and 4000.

**UI.** Every staff button (roster fix, free-agency turn, deadline, re-sign the
core) shows its plan inline (`useStaffPlan`) with a yes and a no instead of a
browser `confirm()`; the draft map places its labels clear of each other
(`layoutLabels`; 1 of 32 overlaps on a real post-draft league).

## Playthrough fixes, 2026-10 (Opus pass)

**0 passing yards league-wide (live server only).** Every dropback on the live
server became a scramble: no throws, no sacks, 0 passing yards for all 32
teams, in every new league. The rating caches (`ratings.ts` `familyModifier`,
`synergy.ts` lineup caches) keyed on player *ids*, which a real player shares
across every league, every season, and the 32 reference rosters every rating
is centred on. A long-running server therefore scored one league's lineups
with another league's attributes, and a single non-finite value computed
anywhere was cached and served to every league after it. One NaN in the M04
shift made every class NaN, and `Rng.choice` falls through to the last label,
which on M04 is SCRAMBLE. Fixes: caches key on object identity
(`playerKey`), non-finite attributes are treated as missing and never cached,
and `predictProba` drops a non-finite shift term (logging it once) instead of
poisoning the resolver. `test/engine-cache-isolation.test.ts` reproduces it:
on the old code a broken league simulated first leaves every later game at 0
passes. `online/test/passing-volume.test.ts` guards a simulated week at every
stat layer.

**Skip Free Agency soft-lock.** A skip carried from one market to the next
finished year two's market on the way in, and `runPendingCpuTurns` only moved
the league on from a market still open, so the stage never left. Skips now
reset when every market and every trade deadline opens (`clearSkips`), a
finished market or deadline always moves the league on, and the deadline
sweep moves on a save already stuck that way.

**Trade value follows the market.** `tradeAssetValue` used the engine-measured
`POSITION_VALUE` (DT 0.79, CB 1.42), which priced a 92 DT below a 78 CB. Trades
now use `TRADE_POSITION_VALUE` (the NFL market's hierarchy, interior line a
little under the edge), a steeper rating curve (`playerTradeBase`, exponent
2.2, a 90 about a first), an age factor, and years of control and contract
surplus. Free-agent salaries keep `POSITION_VALUE`. The Master AI's measured
unit value still decides what it will accept, so it and the market can disagree.

**Playoffs a round at a time (online).** The postseason used to be simulated
in one pass when the stage opened, so a GM had no say in any playoff game.
Now each round is a checkpoint: GMs still alive set a plan and check in, and
the round is played (`playNextPlayoffRound` -> `playoffRound` block job) once
everyone has, or the clock runs out, with the plans saved at that moment.
Eliminated GMs stand ready. The bracket sent to a client carries
`roundsPlayed` so the screen knows "watch" from "plan and check in". Solo
already played a round per press; both bracket screens show the plan strip.

**Preseason lab.** `src/engine/plan-preview.ts` plays the GM's next game
(next unwatched preseason game, else Week 1) both ways on paired seeds, 160
games each, and reports the standard plan's win chance, the plan's, the
margin change and its uncertainty (two standard errors); inside the noise it
says "too close to call". It reads the margin, not the win count, because a
plan moves a game a point or two and paired win counts cannot see that at
this sample size. Only in the preseason; from Week 1 on, win chances are
labelled "with default game strategy".
