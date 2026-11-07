# Agent 3 — Competitiveness & Strategic Depth: reproducibility sheet

Documentation, harnesses and raw data only. **No production gameplay, rating, pool or balance value was changed.**

- Baseline: `master` @ `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b` (branch `claude/kind-feynman-ay3w05`), pool `ui-source/src/data/pool-2026.json` via `NFL_POOL_PATH`.
- Start here: [REPORT.md](REPORT.md) (findings + roadmap) and [TAFI_REGISTER.md](TAFI_REGISTER.md).

## Experiment status (completed vs incomplete)

| Experiment | Status | Config | Raw data |
|---|---|---|---|
| Unit swap, talent 1.0 (QB 72/95; OL, WR+TE, RB, front, LB, secondary, K, P at ±10) | **Complete, 18 arms.** OL, WR+TE, RB, QB: 1,280 pairs; front, LB, secondary, K, P: 640 pairs | all 32 rosters as base, opponent/venue/seed fixed per pair, treated vs untreated roster play the same seed (paired), injuries on, weather on, **no staff** | `data/unit_swap.jsonl` |
| Unit swap, talent 1.5 (new-league default) | **Partial: only QB and OL** (4 arms, 640 pairs). WR+TE, RB, front, LB, secondary, K, P were **not run** at 1.5 | same | `data/unit_swap.jsonl` |
| Coaching staff (HC/OC/DC at 95 or 20 vs league-average staff) | **Complete, 8 arms, 640 pairs each**, talent 1.5 only. Single-role arms are underpowered for win% | focal staff varies; opponent has league-average staff | `data/staff_swap.jsonl` |
| Longitudinal, real engine, headless (no UI) | **Complete: 3 leagues (seeds 9301–9303) × 5 seasons × 2 variants.** CPU runs every team; no human GM | `online/` block simulation (`simulateBlock`, `simulatePlayoffBlock`), talent default | `data/longitudinal_real_engine.json` |
| Price-table probe | **Complete (one league, synthetic players)** | `expectedSalary` vs `playerPerformanceValue`, age 27 | `data/price_arbitrage.csv` |
| Five seasons through the real **UI** with four human strategies | **Not done** — see REPORT §9 for the blocker and a procedure | – | – |
| Draft-strategy, FA-bidding, trade-acceptance, exploit simulations | **Not done** (only code/price-table review) | – | – |
| Multiplayer fairness | **Not done** | – | – |

## Reproduce

```bash
export NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json
cd docs/qa-longitudinal/agent-03-competitiveness/harness
npx tsx unit_swap.ts OL 10 40 1          # <unit> <delta|abs:N> <reps> <talent>; seeds 5_100_000 + rep*1009 + teamIndex
npx tsx staff_swap.ts OC 95 20 1.5       # <roles> <rating> <reps> <talent>; seeds 7_100_000 + ...
cd .. && python3 harness/analyze.py      # -> data/analysis_unit_summary.md (run from the agent folder)
```
`run_all.sh` was the original driver (40 reps); it was stopped after 8 arms and `run_rest.sh` resumed the missing arms at 20 reps to fit the time budget — hence the mixed sample sizes. The first 8 arms' results are unchanged.
Longitudinal: copy `harness/longitudinal.test.ts` to `online/test/_a3_longitudinal.test.ts` (scratch; do not commit) and run
`A3=1 A3_SEEDS=9301,9302,9303 A3_SEASONS=5 A3_OUT=out.json npx vitest run --root online test/_a3_longitudinal.test.ts` (about 10 min).
Price probe: copy `harness/price_arbitrage.test.ts` to `ui-source/src/state/_a3_price.test.ts` and run it with `A3_OUT=<file>`.

## Method notes
- "Pairs": each pair is one base team playing one game twice, same seed/venue/opponent, once untreated, once treated. Per-pair difference gives margin and win-outcome change. Win% = 50 × mean(sign(margin_treated) − sign(margin_base)) (ties = 0). CI = ±1.96 SE.
- A unit "shift" adds N to `overall` and to every numeric attribute of the unit's starters (QB: set `overall` to 72/95 via a per-team shift). Seeds are fixed per pair, so differences are deterministic given the code at the baseline commit; different seeds would give independent repeats.
- Sabotage variant: KC's depth chart re-set worst-first at QB, OT, OG, C, EDGE, CB before every step. It measures **lineup importance**, not the accuracy of player valuation.
