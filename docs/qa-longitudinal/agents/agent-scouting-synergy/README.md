# Scouting, Player Synergy & Strategic Depth — design and validation

**Design and validation only. No production gameplay, rating, balance constant, save schema or UI is changed.** Baseline: `master` @ `d0727ff`.
Builds on PR #105 (strategic depth), PR #95 (competitiveness) and PR #102 (realism); does not repeat their experiments.

| Deliverable | File |
|---|---|
| Proposed scouting, synergy and scheme systems | [DESIGN.md](DESIGN.md) |
| Methodology, results, effect sizes, limits | [EXPERIMENTS.md](EXPERIMENTS.md) |
| Player-facing presentation and wireframes | [UI-PROPOSAL.md](UI-PROPOSAL.md) |
| Phased plan, acceptance criteria, compatibility | [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) |
| Balance, performance, compatibility, exploit risks | [RISKS.md](RISKS.md) |
| **Final refinement** (superadditivity diagnosis, long-term scouting, scheme-fit correction, acceptance criteria) | [REFINEMENT.md](REFINEMENT.md) |

## Simulation path of every number (issue #74)

| Experiment | What ran | Path |
|---|---|---|
| A synergy factorial + skill-style fit | `simulateGame`, 32 rosters × 30–40 matched reps | **real engine** (baseline tree) and **prototype** (baseline + `synergy-proto.patch` in a scratch git worktree) — the two are labelled everywhere |
| B fit-based vs highest-overall roster building, equal spend | `simulateGame`, 32 teams × 60 reps × 3 arms | **real engine** baseline; **prototype** |
| C scouting information and allocation | real class generator, real CPU drafts for the 21 untreated teams, real `recomputeTeamRatings`; no games simulated | **real draft machinery; scouting model is harness-only** (a proposal) |
| D scheme alignment and counters | `simulateGame` with the existing staff layer (D1) and the prototype (D2) | **real engine** (D1) / **prototype** (D2) |
| E multi-season dynasty risk | closed-form Monte Carlo fitted to PR #105's real-engine CPU leagues (fitted parameters are stored in `data/expE_model.json`; PR #105's raw files are not copied) | **mathematical model**, not an engine result |
| Probe: are players tagged for scheme fit? | one default league inspected | code/data inspection |

No result uses the standalone Mock fallback (`MockSimulationService.simGame`). The Mock is used only for league scaffolding (schedules, class generation) as everywhere else in the repo; with the Mock as the only simulator none of these mechanics (plans, staffs, units, scheme fit) would be exercised at all (see PR #105 X5).

## Reproduce

```bash
export NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json
H=docs/qa-longitudinal/agents/agent-scouting-synergy/harness
# prototype tree (scratch; nothing is committed to the repo outside this folder)
git worktree add --detach /tmp/proto HEAD && ln -s $PWD/node_modules /tmp/proto/node_modules
(cd /tmp/proto && git apply "$OLDPWD/$H/synergy-proto.patch")   # adds ~110 lines to src/engine/synergy.ts only
export PROTO_W="$(cat $H/proto-weights.json)"
npx tsx $H/expA_synergy.ts 30 a_base.json                        # baseline engine
ENGINE_ROOT=/tmp/proto npx tsx $H/expA_synergy.ts 30 a_proto.json # prototype
ONLY_COMBO=1 npx tsx $H/expA_synergy.ts 40 a4_base.json          # superadditivity cells (also with ENGINE_ROOT=/tmp/proto)
npx tsx $H/expB_roster_building.ts 60 b_base.json                # + ENGINE_ROOT=/tmp/proto
npx tsx $H/expD_schemes.ts D1 16 d1.json                         # baseline engine
ENGINE_ROOT=/tmp/proto npx tsx $H/expD_schemes.ts D2 24 d2.json  # prototype
cp $H/expC_scouting.test.ts online/test/_ss_c.test.ts            # scratch copy; delete afterwards
SS=1 SS_SEEDS=9701,9702 SS_ARMS=public,basic24-voi,perfect SS_OUT=c.json npx vitest run --root online test/_ss_c.test.ts
python3 $H/expE_dynasty_model.py <dir with PR #105 x1_[abc].json> e.json 4000
gunzip -k data/*.json.gz   # raw data are committed gzipped
python3 $H/analyze_A.py a_proto.json   # analyze_A4.py, analyze_B.py, analyze_C.py, analyze_D.py likewise
```
Seeds: A/B/D use fixed seed formulas in the scripts (`8_100_000 + …`, `8_300_000 + …`, `8_500_000 + …`, `8_700_000 + …`); C uses league seeds 9701–9724. Every comparison is paired (same seed, opponent, venue).

## Conventions
* "Margin" is points per game for the focal team; "SE" is the paired standard error; 95% CI = ±1.96 SE. Effects smaller than ≈ 2 SE are called *not distinguishable from zero*, not *zero*.
* Talent impact 1.5 (the new-league default, "Amplified") unless stated; only Experiment B was also run at 1.0 (A, C, D, E were not).
* Engine tree and weights are recorded in each data file's `proto` flag; the prototype weights are `harness/proto-weights.json`.

## Refinement experiments (REFINEMENT.md)
`diagA_factorial_shift.ts` (exact), `expA2_factorial.ts` + `analyze_A2.py` (2×2×2, prototype variants via `PROTO_Q=mean|geo|prod|min` in the patched tree; the patch now includes them), `expB2_devpre.test.ts` + `expB2_scouting_longterm.test.ts` + `analyze_B2.py` (multi-season scouting; scratch-copy to `online/test/`), `diagD1_exact_schemefit.ts`, `analyze_D1_ci.py`. A2 cells with the mean combination used 2,250–2,400 pairs (baseline 2,400); geo cells 1,280. Runs interrupted by a worker restart were reused as partial files (30–32 of 32 teams, all cells per team).
