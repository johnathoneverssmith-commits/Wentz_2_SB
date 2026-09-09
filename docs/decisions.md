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

**Deferred to Phase E:** §13.6 joint calibration loss across all resolvers at
once; simulation-level distribution targets (§22) with modifiers on; the v0
per-attribute weights within each family will move under the joint loss.

**Portability (still open):** M01/M02/M03/M05/M09/M10/M14 chose HGB; the TS
runtime can't load joblib. Before/within Phase E, export chosen HGB models to
portable JSON trees or fall back to logistic where the gap is small.

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
