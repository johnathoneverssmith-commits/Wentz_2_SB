# Engine handoff

Written to be handed to another model or engineer working on the simulation
engine without the benefit of the conversation that produced it. It assumes
you have the repository and nothing else.

`docs/engine_spec.md` is the build contract and `docs/decisions.md` holds the
reasoning behind every open question. This file is the orientation, the
current numbers, and the traps.

---

## 1. What the engine is

A play-by-play NFL simulator built empirically from nflverse play-by-play
data, not from invented constants. Every model in it was fit against real
plays, exported to a portable JSON form, and is evaluated at runtime with no
Python in the loop.

```
analysis/          the Python pipeline that FITS the models (scikit-learn)
artifacts/         the committed outputs the runtime loads
  models/          portable model coefficients
  ratings/         the rating-layer calibration
  validation/      the reports you will be judged against
src/engine/        the TypeScript runtime — this is what actually plays games
analysis/engine/   a Python mirror of src/engine, used by the validation harness
```

The TS runtime and the Python mirror must agree. When you change one, change
the other, or the validation harness stops measuring the thing that ships.
`src/engine/home-field.ts` and `analysis/engine/home_field.py` are a worked
example of the pairing — they were written digit-for-digit identical on
purpose.

### The play loop

`simulateGame(seed, home, away, opts)` in `src/engine/sim.ts` is the entry
point and is a **pure function**. Same seed and same inputs, same game, every
time. Model IDs (M01, M04, M09, M20 …) appear throughout and correspond to the
numbered analysis scripts that fit them — `M09` is the pass-result model fit
by `analysis/10_pass_result.py`, and so on. Follow the number to find the
science.

---

## 2. The invariant you must not break

**`simulateGame(seed, home, away)` with no rosters must stay byte-identical.**

The validation harness (`analysis/23_full_sim_validation.py`, spec §22) drives
the engine in a pool-free configuration. Every published number in this
document was produced that way. If you change the RNG draw order — adding a
random call, reordering two existing ones, taking a branch earlier — you
silently invalidate the entire validation suite, and nothing will fail loudly
to tell you.

Two consequences worth internalising:

- New behaviour goes behind a flag that is **off** in the pool-free path. The
  home-field work is the pattern: it is gated on `ratingsOn`, so the validated
  path draws exactly the numbers it always did.
- `npm test` includes tests that pin specific game outcomes for specific
  seeds. If those change, you changed the draw order. That is the alarm.

---

## 3. Where the engine actually stands

**16 of 20 validation metrics are within 10% of the real league**
(`artifacts/validation/simulation_validation.json`, 250 simulated games
against 2025 play-by-play).

The four that miss, in order of size:

| metric | sim | real | diff |
|---|---|---|---|
| `penalties_per_team_game` | 4.90 | 6.16 | **−20.4%** |
| `dpi_per_team_game` | 0.44 | 0.52 | **−16.0%** |
| `points_sd` | 8.38 | 9.93 | **−15.6%** |
| `penalty_yards_per_team_game` | 42.41 | 50.02 | **−15.2%** |

Everything else lands inside 10%, most inside 5%: points/team-game −2.0%,
completion % +2.2%, yards/attempt +4.4%, FG make % +1.5%.

> **Update (V1.7, 2026-09-16).** Three of the four misses are closed. A single
> global scale on the fitted penalty hazards (`PENALTY_HAZARD_SCALE`, 1.0 ->
> 1.22 in both `src/engine/sim.ts` and `analysis/engine/sim.py`) moved
> penalties/team-game from -20.8% to -2.8%, penalty yards from -15.7% to
> +3.3%, and DPI from -26.7% to -6.0%, measured over 1,500 games on the
> pool-free path. Points per team-game moved 21.79 -> 21.85, inside the noise,
> so the §26 joint calibration is undisturbed. **The §22 table below has not
> been regenerated** — it wants a run of `analysis/` with the parquet data,
> which is git-ignored. `points_sd` is unchanged at 8.87 and is now the only
> open miss. The paragraph below is kept as the record of what was wrong.

**Three of the four misses are one subsystem.** The penalty module is at V1.5
(`docs/penalty_module_plan.md`, `analysis/25_penalties.py`,
`analysis/25c_penalty_enforcement.py`) and under-calls fouls across the board.
That is the single highest-value piece of work available, and it is well
scoped: the data is already fit, and the gap is in which situations draw flags
and how enforcement is applied.

The fourth, `points_sd`, is a different and more interesting problem: the
simulated league is **too consistent**. Real football has fatter tails —
blowouts and shootouts — than the engine produces. Suspects worth testing
before changing anything: correlated within-game outcomes (the engine treats
too many plays as independent), missing garbage-time behaviour, and turnover
clustering.

#### `points_sd`: diagnosed (2026-09-16)

**The first version of this section was wrong** and is replaced. It guessed
that the engine lacked a game-level "form" factor and that the missing
variance was week-to-week. The data says the opposite. Measured against
2023–25 (1,632 team-games) and against the engine with the rating layer on
(2,000 team-games):

| | real | engine |
|---|---:|---:|
| points/team-game | 22.56 | 20.73 |
| points sd | **9.93** | 8.92 |
| **between**-team-season sd | **4.28** | **2.15** |
| within-team-season sd | 8.96 | 8.68 |

**Week-to-week variation is already right** — 8.68 against 8.96, about 3%
light. What is missing is *between* teams: the engine's good teams are not
good enough and its bad teams are not bad enough, by almost exactly a factor
of two. Put the real between-team spread on the engine's within-team spread
and you get `sqrt(4.28² + 8.68²) = 9.68`, which is inside tolerance of 9.93.

The right tail is where it shows up. Real football puts 20.7% of team-games
over 30 points; the engine manages 14.9%. The left tails already agree (8.5%
vs 8.1% under 10 points), which is the reverse of what the earlier guess
predicted.

**This is independently confirmed by a number already in the repo.**
`artifacts/models/m24b_rating_layer_validation.report.md` records the
favourite-by-overall win rate at **58.8%**, and the favourite-by-modelled-edge
rate at 60.0%, against NFL point-spread favourites at **66–70%**. Two
unrelated measurements — scoring spread and win rate — both say the rating
layer carries about half the team-quality signal it should.

**Why, and what not to do about it.** The same report shows all seven modelled
families landing at 0.99–1.0× their historical anchors by design magnitude.
Each modelled channel is calibrated correctly. So the shortfall is not a bad
fit to be scaled away — multiplying the betas would make every one of those
seven ratios wrong by 2× in order to fix an aggregate. The report names the
actual cause in passing: *"overall folds in depth / special teams / blocking
the V1 engine does not model yet."* Team quality acts through more channels
than V1 models, each modelled one is right, and the unmodelled remainder is
missing entirely.

That makes the fix an **addition, not a rescaling**: a team-quality channel
carrying what the modelled families cannot see, calibrated against two targets
that should move together — between-team points sd 2.15 → 4.28, and favourite
win rate 58.8% → 66–70%.

> **Update (V1.8, 2026-09-17/19).** Built as `src/engine/team-strength.ts`
> (mirrored in `analysis/engine/team_strength.py`): a snap-weighted mean of
> the *whole* roster, entered as a shift on completion, sacks and rush yards.
>
> **First cut used one index per team and overshot margin.** A single
> team-wide number makes every matchup exactly zero-sum — the same gap that
> helps one offense hurts the other by the identical amount — so scores went
> almost perfectly anti-correlated: at scale 1.2, `points_sd` landed fine
> (9.58 vs real 9.93) but score-margin sd came out **16.15 vs a real 14.33**,
> +12.7%. That failure mode is invisible if you only check the summary
> statistic the channel was built to fix.
>
> **Fixed by splitting the index into offense and defense.** A team's
> offense and its own defense are different numbers; what decides a play is
> *this* offense against *that* defense, not team-mean against team-mean.
> With the split, `TEAM_STRENGTH_SCALE` re-swept to **1.0** (not chosen —
> see the table in the source file) and the §22/§23 pipeline, regenerated
> for real against the parquet data:
>
> | metric | before (rating layer on) | after | real |
> |---|---:|---:|---:|
> | points_sd | 8.65 | **9.58–9.88** | 9.93 |
> | score-margin sd | n/a (not measured) | **15.9–16.1*** | 14.33 |
> | favourite-by-overall win % | 58.8% | **65.8–71.7%*** | 66–70% |
>
> \* the §23 harness runs only 100–120 pairs, so these two are noisier than
> the 2,816-game sweep in the source file (margin 14.58–14.75, favourite
> 67.8–68.3%) — trust the source file's numbers over the small-sample report
> for anything past one significant figure. All three land inside or at the
> edge of the ±10% band; none of the seven modelled families' design ratios
> moved (still 0.99–1.0×), and the pool-free §22 path is unchanged (19/20
> within 10%, `points_sd` −12.9% because that path never turns the rating
> layer on — expected, and the one metric this channel cannot touch there).
>
> `artifacts/models/m23_full_sim_validation.report.md`,
> `m24b_rating_layer_validation.report.md`, and both `artifacts/validation/*.json`
> are regenerated and current as of this update.

### Known residuals, already investigated

- **≈ −0.8 ± 0.4 points per team-game** against the real league after the §26
  joint calibration. Documented as "small, borderline, and diffuse" and
  deliberately left open.
- **The played game is not the validated game.** Measured over 500 games per
  configuration: the validation path (staff on, injuries off) scores 21.17
  points/team-game; what the franchise adapter actually runs (injuries on)
  scores 20.71. In-game injuries cost about 0.46 points/team-game. Neither is
  wrong, but any re-calibration must state which configuration it targets —
  closing the −0.8 gap against the no-injury path leaves the played game low.
  See `docs/decisions.md` → "OQ-10 addendum".
- **Home-field advantage is done and calibrated.** 54.23% home win rate
  against a league 54.02%, inside the 0.36pp standard error, over 19,840
  games. Honest caveat recorded: mean margin comes out +1.36 against a real
  +1.57, and fitting the margin instead would push the win rate two standard
  errors too high. `src/engine/home-field.ts`, OQ-10.

---

## 4. Ranked work, highest value first

1. **Penalties — three of the four misses.** Under-calling by 20%. Start at
   `docs/penalty_module_plan.md` and `analysis/25_penalties.py`. DPI
   specifically is 16% light and is its own model.
2. **Scoring variance (`points_sd`, −15.6%).** Investigate before adjusting —
   the likely cause is independence assumptions across plays rather than any
   single mis-fit distribution.
3. **OQ-2, the ratings model** (`src/model/ratings.ts`). `tierOf` scores a
   player as `0.55 × snap share + 0.3 × draft capital + 0.15 × years
   survived`, which measures *"is he a starter with pedigree"*, not *"is he
   good"*. It rated a declining 31-year-old safety the best player in the
   league and a backup quarterback level with Joe Burrow. **The shipped pool
   no longer uses it** (see §5), so this only matters if you regenerate — but
   it is the reason regenerating is dangerous, and fixing it properly needs a
   real performance signal (EPA or similar), not snap counts.
4. **The validated-vs-played configuration split** above. Cheap to resolve by
   decision rather than modelling: pick the configuration, re-calibrate
   against it, and say so in the report.
5. Remaining open questions are catalogued in `docs/decisions.md` — OQ-3
   (scheme fit), OQ-4 (aging curves), OQ-5 (trade value), OQ-6 (FA demand),
   OQ-7 (injury severity vocabulary), OQ-9 (AI GM objective). Each has its
   reasoning written down; read the entry before touching the area.

---

## 5. Traps

These cost real time to find. None are obvious from the code.

- **Do not regenerate `ui-source/src/data/pool-2026.json`.** `npm run
  generate:pool` rebuilds it with the `src/model/` heuristic, whose ratings
  are wrong in the way described above. The shipped pool's ratings are
  **authored**. Regenerating looks like an update and is a regression. Edit it
  through `npm run pool:export-csv` / `pool:import-csv`, which round-trips
  losslessly and validates every row against the zod schema.
- **Head coaches and coordinators are real people** (`src/engine/staff-data.ts`,
  cross-checked against Wikipedia's current-staff lists). Do not rename them
  or invent ratings for them. First-time coaches sit at the league baseline
  (56 / 50 / 0.15) deliberately, rather than being given a personality they
  have not earned. Generated rookies, draft prospects and free agents *are*
  fictional by design — that asymmetry is intentional.
- **The Python mirror is not optional.** `analysis/engine/` must track
  `src/engine/`. The validation numbers come from the Python side.
- **Never commit** `data/*.parquet`, `data/*.local.json`, or `data/*.csv`.
- **`"FA"` is the free-agent sentinel** for `nfl_team`, not a team. Code that
  iterates teams must exclude it.
- **`overall` is graded within a position.** A 95 safety is not the equal of a
  95 quarterback. Anything comparing players across positions needs a
  positional-value term — `draftValue()` in `ui-source/src/state/rules.ts` is
  the existing one.

---

## 6. Commands

```bash
npm install
npm test                                      # engine suite — 334 tests
npm run typecheck
npm run season -- --seed 1 --year 2026        # play a full season
npm run season -- --box KC@BUF                # one game, box score
npm run season -- --through 12                # standings + clinch at week 12
npm run analysis:audit                        # spec §28 schema audit
```

The Python pipeline lives in `analysis/.venv` — see `analysis/README.md`. The
numbered scripts run in order and write to `artifacts/`.

Re-running validation after an engine change:

```bash
python analysis/23_full_sim_validation.py     # §22 — the table in §3 above
python analysis/24_rating_layer_validation.py # §23 — the rating layer
```

---

## 7. Test state, so you know what you did not break

- **Engine (`npm test`): 334 passing.** This is the suite that matters for
  engine work. It should stay green.
- **Online server (`npm run online:test`): 72 passing, 8 skipped.** The skips
  need a Postgres instance (`DATABASE_URL`) and pass when one is present.
- **UI (`cd ui-source && npx vitest run`): about 12 known failures.** These
  pre-date this handoff. They came from swapping the player pool to real
  players: the fixtures still assume the old generated pool — they look for a
  player at a position a real roster does not carry, or build a roster that is
  already at the 53-man limit. They are fixture problems, not product bugs,
  and they are worth fixing, but they are not evidence that you broke
  something. Affected files: `aiBidding`, `capEnforcement`, `contracts`,
  `offerScore`, `pickTrading`, `evaluateTrade`.

---

## 8. What to hand over with this file

Attach these alongside, in this order:

1. `docs/engine_spec.md` — the build contract, §1–§28. Long, and the
   authority on what each model is.
2. `docs/decisions.md` — every open question and why it was decided or left
   open. Read the relevant OQ before changing an area.
3. `CLAUDE.md` — repository conventions, layout, and the pool warning.
4. `docs/penalty_module_plan.md` — if working on penalties, which is the
   recommended starting point.
5. `artifacts/validation/simulation_validation.json` — the numbers in §3, so
   the work can be measured rather than asserted.
