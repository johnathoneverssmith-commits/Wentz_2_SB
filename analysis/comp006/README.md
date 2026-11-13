# COMP-006 harness: scripted skilled GM vs the default CPU GM

Analysis only. No production gameplay, rating, pool, schema, cap or balance constant is changed; nothing under `src/`,
`ui-source/src/`, `online/src/`, `artifacts/` or CI is touched. The harness imports those modules and drives them.
The report is `docs/qa-longitudinal/comp-006-skilled-gm/REPORT.md`.

## Files

| File | Role |
|---|---|
| `driver.ts` | Builds a league and plays it through the real stage machine, pressing the buttons the screens press. Records, per team-season, results, playoff depth, roster strength and cap state. |
| `skilled.ts` | The scripted skilled GM. Pure decisions from public information, split into switchable modules. |
| `run.test.ts` | One vitest test = one league-run `(seed, talent, arm, modules)`. Counts real-engine calls and the talent scale the engine received; fails if the Mock simulated a game. |
| `info-guard.test.ts` | Fails if `skilled.ts` touches hidden state (`potential`, a prospect's `trueOverall`, CPU GM strategy/skill/difficulty, RNG, unwatched results, the CPU's own decision procedures). |
| `run.sh` | Fan-out over seeds × talents × arms; resumable (skips existing outputs). |
| `analyze.py` | Paired effects with league-clustered uncertainty (numpy only). |
| `export_slim.py` | Raw run JSON -> three small CSVs (committed under the report's `data/`). |

## Arms

* `control`: all 32 teams run by their CPU GMs. The "default policy". The four seat teams are the CPU teams they would be anyway.
* `skilled`: the same four seat teams are run by the scripted skilled GM; the other 28 stay CPU.
* `idle`: the same four seats are human seats whose GM does what the production autopilot does (pick the board's top
  player, pass in free agency, skip / deny at the deadline, no re-signings, default plan, no depth-chart edits). It
  separates "being a human seat" from "being a skilled GM".
* Ablations: `skilled` with a subset of modules (`C6_MODS=trades`, ...). A module that is off falls back to the idle behaviour.

Control, skilled and idle share the starting league (verified by a player-table fingerprint), schedule, CPU GM line-up
(seated before the seats are taken, so no CPU team's GM changes) and seat teams. After the first decision the random
streams diverge, so a pair is "same team, same league, different GM", not "same dice".

## Reproduce

```bash
cd analysis/comp006
npm ci && npm --prefix ../../ui-source ci          # once, from the repo root
npx vitest run -c vitest.config.ts info-guard      # information guard
./run.sh out "9601 9602" "1 1.5" "control skilled" 10 4 4   # outdir seeds talents arms seasons seats workers [mods] [suffix]
python3 analyze.py out --arm skilled --max-season 3   # PRIMARY: seasons 1-3 (no hot-seat censoring possible)
python3 analyze.py out --arm skilled               # full horizon (survivor-selected after season 3)
python3 analyze.py out --arm skilled --max-season 3 --drop 9608:1.5   # exclude a matched league (seed or seed:talent)
                                                   # also: --arm idle, --base idle, --mods trades for ablations
python3 export_slim.py out ../../docs/qa-longitudinal/comp-006-skilled-gm/data
```
Pool: `ui-source/src/data/pool-2026.json` via `NFL_POOL_PATH` (set by `run.sh`; sha256 in the report). New leagues are the
shipped Seeded League DNA leagues (fictional players) from `createLeague(seed, ...)`, fantasy draft off, so a league
starts at `setup` with full rosters and plays the coaching draft first. Talent 1.0 = `realistic`, 1.5 = `amplified`.

## Censoring and run accounting
The hot-seat rule can fire a GM from season 4. `analyze.py` drops a seat-season once the seat's GM changed team in **either** arm
(`censoredFrom` in each run file), so the primary window `--max-season 3` is uncensored and the full horizon is survivor-selected.
Title figures: "per usable seat-season" never counts post-firing seasons; see the report, section 3c. Every run attempted, with
its disposition (reused / discarded / re-run), is in `docs/qa-longitudinal/comp-006-skilled-gm/RUN_ACCOUNTING.md`.
Runs are deterministic: re-running a seed with the committed code reproduces rows, ledgers and the fingerprint bit for bit
(checked for 4 runs against files made with earlier driver versions).

## Engine path

`createLeague` / `online/src/phases.ts` (`advanceIfReadyLocal`, `advanceStage`, `onStageEntered`) / `online/src/blocks.ts`
`simulateBlock` -> `src/engine/sim.ts` `simulateGame`. `run.test.ts` wraps `simulateGame` and every `MockSimulationService`
method: each output file records the engine call count, the `talentScale` each call received, and the Mock calls made
(schedule, draft class, bracket seeding, trade evaluation only; never a game).
