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
- **Invariants:** 7 monotonicity checks, synthetic p90 vs p10 single-family
  rosters, paired on common random numbers. Directions hold (the misses at n=10
  sit inside the paired SE — sim-sample size, not wiring). Magnitude is carried
  by the analytic `designed_magnitude()` (the MC ratio is noise-dominated for
  low-event channels at small n): **all 11 families land at 0.99–1.0× the
  historical p10↔p90 anchor** once logit- and yard-scale shifts are put in
  common units — Phase D calibration confirmed sound.
- **Centering / league (32 real matchups ×2, modifiers on):** completion −2.5%,
  YPA −0.9%, YPC +2.0% vs the empirical baseline; **sack rate +14.5%** (0.076 v
  0.066 — above §22's validated +4.3%, likely the 32-pair sample but a watch
  item for the larger run). Favourite-by-summed-`overall` win rate **59%**;
  favourite-by-net-modelled-channel-edge win rate **69%** (NFL point-spread
  favourites win ~66–70%) — the two agree on the favourite in 72% of matchups.
- **Layer impact (44 matchups, paired same-seed ON=rosters vs OFF=league-avg):**
  league points flat within sample noise (Δ +0.3), **score-margin sd widens
  12.3 vs 11.2** (matchups now move outcomes), INT rate does not inflate
  (0.0245 vs 0.0272). Best-vs-worst roster (PHI ovr 1767 vs LV 1595) → favourite
  wins **73% in both home/away directions**, +5–6 pt margin.
- **Open (Phase E iteration, not blocking):** the league block's single-run
  numbers (points −17%, points_sd −12%, sack +14.5%) are sample-noisy — they
  swing run-to-run from the 32-pair draw and the bucketed-`predict_proba` cache
  warm-state; need n_pairs ≥ 100 to pin. The paired impact test is the reliable
  read and it is clean.

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

**Still deferred:** §13.6 joint calibration loss (Phase D iteration, needs the
engine loop); a larger §23 league sample; the diffuse points gap above; the
shippable TS runtime (loader for the portable JSON + the game layer); switching
the Python engine to the portable models (fixes the M01 dtype bug, drops the
joblib dependency).

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
