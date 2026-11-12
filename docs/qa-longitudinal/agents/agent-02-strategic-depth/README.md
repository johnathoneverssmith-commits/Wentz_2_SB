# Strategic Depth, Competitiveness & Fun — reproducibility sheet

Documentation, harnesses and raw data only. **No production code, rating, pool, schema or balance value was changed.**
Start with [REPORT.md](REPORT.md) (findings, CPU assessment, fun analysis, roadmap) and [TAFI_REGISTER.md](TAFI_REGISTER.md).

- Baseline: `master` @ `d0727ff` (Group 08, PR #103). Branch `claude/ecstatic-faraday-1ircsl`. Pool `ui-source/src/data/pool-2026.json` via `NFL_POOL_PATH`.
- Naming: the register's "Agent 2" label already belongs to Simulation Realism (`agent-02-realism/`). This report is the *strategic-depth* pass of the second brief, so it lives in `agents/agent-02-strategic-depth/` and its TAFI ids are `STRAT-nnn`. The coordinator may alias them.
- Prior work read first and **not repeated**: PR #95 (unit swaps, single-starter +10, equal-payroll QB, staff swap, sign-and-flip, CPU skill split, game-plan audits 42/43, partial UI run) and PR #102 (realism backlog, `docs/AUDIT_multiseason_2026-10.md`).

## Simulation path of every number (issue #74)

| Experiment | Path | How it was verified |
|---|---|---|
| X0 engine-path check | **real engine** | counted calls (below) |
| X1 CPU league dynamics | **real engine**, `online/src/blocks.ts` → `simulateGame`, headless | X0 on the same entry points |
| X2 draft-policy payoff | **real engine**, same entry points, matched leagues | `base` arm reproduces X1 bit-for-bit |
| X3 trade probes | **no game simulated**; the real trade model (`judgeTrade`) on seeded league states | – |
| X4 opponent tailoring | **real engine** (`simulateGame`), engine-only, no staff, no weather | – |
| X5 Mock sensitivity | **Mock fallback (labelled)**: `MockSimulationService.simulateWeek`, no engine | contrasted with X1 on the same seeds |
| UI review | **code inspection only; no browser session in this pass** | REPORT §5.1 |

**X0 result** (`data/x1_probe_x0.json`): one league-season through `finishPlayedWeek` + `advanceStage` made **333 calls to the real `simulateGame`**
(272 regular-season games recorded, the rest preseason and playoffs). `MockSimulationService` was entered only for `generateSchedule`,
`generateDraftClass`, `seedBracket`, `finalizeSeasonOutcomes`, `retirementOutcomes` and `evaluateTrade` (7 calls, which delegates to `judgeTrade`); it **never**
simulated a game. In `online/src/blocks.ts` the Mock's `advanceSingle` is reached only for a humans-only single bracket. So the headless runs are real-engine runs;
the standalone UI with no adapter is *not* (issue #74 stays open and I did not exercise it for strategy).

## Experiment status

| ID | Question | Status | Size | Raw data |
|---|---|---|---|---|
| X0 | Is the harness on the real engine? | **Done** | 1 league-season, 333 engine calls | `data/x1_probe_x0.json` |
| X1 | How do CPU-run leagues evolve? parity, persistence, rebuild time, dominance, payroll | **Done** | 8 leagues × 8 seasons (64 league-seasons, 2,048 team-seasons) | `data/x1_{a,b,c}.json`, `x1_summary.txt` |
| X2 | Is draft quality rewarded over 1–3 drafts? | **Done for 4 arms; `board` has 3 of 4 leagues (stopped to freeze data)** | 4 leagues (3 for `board`) × 4 seasons, 11 of 32 teams treated per arm, 44 (33) team pairs | `data/x02_*.json`, `x02_summary.txt` |
| X5 | How much do rating gaps matter in the standalone **Mock**? (labelled Mock) | **Done** | 8 leagues × 2 talent settings, 256 team-seasons each | `data/x05_mock_sensitivity.json` |
| X3 | Can the CPU trade model be exploited beyond K/P? need-stacking, contract dumps, window arbitrage | **Done (model-level)** | 2 leagues, 15 positions × 3 package sizes; 24 synthetic dumps; 800 window ratios | `data/x03_*.json` |
| X4 | Does an opponent-specific game plan beat the best generic plan? | **Done** | 32 matchups × 7 plans × 100 paired games, talent 1.5 | `data/x04_tailoring_t15.jsonl`, `x04_summary.txt` |
| – | Full 5-season UI playthrough by a human-like agent | **Not done** (REPORT §5.1) | – | – |
| – | Scripted skilled human over all turn-based events (COMP-006) | **Not done** (only the draft slice, X2) | – | – |
| – | Multiplayer fairness | **Not done** | – | – |

## Reproduce

```bash
export NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json
H=docs/qa-longitudinal/agents/agent-02-strategic-depth/harness
# X0 + X1 (scratch copy into the online test project; do not commit the copy)
cp $H/x01_engine_path_and_parity.test.ts online/test/_a2s_x01.test.ts
A2S=1 A2S_SEEDS=9401,9402,9403 A2S_SEASONS=8 A2S_OUT=$PWD/x1_a.json npx vitest run --root online test/_a2s_x01.test.ts -t X1   # ~25 min per 3 leagues
A2S=1 A2S_OUT=$PWD/x1_probe.json npx vitest run --root online test/_a2s_x01.test.ts -t X0                                        # writes x1_probe_x0.json, ~35 s
python3 $H/analyze_x1.py                                                       # run from agents/agent-02-strategic-depth
# X2
cp $H/x02_draft_policy.test.ts online/test/_a2s_x02.test.ts
A2S=1 A2S_ARM=skilled|board|oracle|poor|base A2S_SEEDS=9401,9402,9403,9404 A2S_SEASONS=4 A2S_OUT=$PWD/x02_ARM.json npx vitest run --root online test/_a2s_x02.test.ts
python3 $H/analyze_x2.py
# X3 (UI test project; scratch copy)
cp $H/x03_trade_exploit_probes.test.ts ui-source/src/state/_a2s_x03.test.ts   # X5: x05_mock_sensitivity.test.ts the same way (A2S=1, ~45 s)
A2S=1 A2S_OUT=$PWD/x03.json npm --prefix ui-source run test -- src/state/_a2s_x03.test.ts      # ~3.5 min;  A2S_ONLY=p5 for the contract-dump probe only (2 s)
# X4
npx tsx $H/x04_opponent_tailoring.ts 32 100 1.5 x04.jsonl && python3 $H/analyze_x4.py x04.jsonl   # ~25 min
```
Delete the `_a2s_*` scratch copies afterwards (CLAUDE.md: never stage scratch files).

## Method notes
- **Matched leagues.** Same seed ⇒ identical league, schedule and RNG up to the first intervention (checked: the `base` arm equals X1 exactly, wins and ratings, for 4 seasons). X2 compares each treated team with *itself* in the control run, and subtracts the change seen in the 21 untreated teams (difference-in-differences) to remove the drift that a changed RNG stream causes after the intervention.
- **Primary outcome in X2 is team rating** (`ratings.overall`, mean of the top 24 players), which has far less luck in it than wins; wins are reported with their SE.
- **X4 split-half.** Plan choice for each matchup is made on games 0–49 and scored on games 50–99 (and the reverse) so best-of-7 selection bias does not inflate the gain.
- **Units.** Contracts are stored in $M (CLAUDE.md says whole dollars; the code uses $M — noted in STRAT-009).
