# Reproduction guide

All commands run from `ui-source/` of a checkout at `3abcfff` (+ PR #93). The `harness/*.txt` files are vitest files kept as `.txt` so they are never compiled or run by CI. To run one, copy it to `ui-source/src/state/_a5_<name>.test.ts` (the leading underscore keeps it out of the repo's own conventions; do not commit it back as `.ts`).

| Evidence file | Harness | Command | Seeds / sample |
|---|---|---|---|
| `run-seed21-GB-REAL-ENGINE.json` | `a5_playthrough.test.ts.txt` | start the adapter first: `npx tsx server/index.ts` (repo root). Then `A5_OUT=out.json npx vitest run src/state/_a5_playthrough.test.ts` | league seed 21, team GB, 5 seasons (2027–2031), pays $3M each offer; 105 engine `simulate-week` calls; ~7.5 min |
| `run-seed21-GB-MOCK-SIM-superseded.json` | same, without the adapter (the test setup stubs `fetch` and the store falls back to the mock simulator) | same | same; **not engine results** |
| `hf-montecarlo-1800.json` | `a5_hf_mc.test.ts.txt` | `A5_OUT=out.json npx vitest run src/state/_a5_hf_mc.test.ts` | 300 trials × 6 payments ($1,2,3,5,7,10M) |
| `e1_eligibility_rules.json`, `e1b_cooldown.json` | `a5_experiments_E1_E3.test.ts.txt` (tests "E1", "E1b") | `A5_OUTDIR=<dir> npx vitest run src/state/_a5_exp.test.ts -t E1` | synthetic league seed 7, 4,000 seasons per cell |
| `e3_persistence_multiplayer.json`, `e3b_store_double_submit.json`, `e3c_negative_leak.json` | same file ("E3", "E3c") | `-t E3` | fixture seed 9001 (KC, BUF both streak 2); E3c: 40 seasons |
| `e2_preseason_consumption.json` | same file ("E2") | adapter must be running: `-t E2` | league seed 33; spies on the `simulate-week` request body |
| `e4_payment_ev_raw.json` | `a5_payment_ev_E4.test.ts.txt` | `A5_OUTDIR=<dir> npx vitest run src/state/_a5_ev.test.ts` | league seed 77, 10 payments × 300 trials |
| `ui-*.jpg` | built-in browser against `npx vite --port 5199`; the league was put at the stage with `await import('/src/state/store.ts')` in the console, then the real screens were used (paying $3M through the stepper and button) | | seed 5 (figure screens), seed 11 (draft) |

Notes
- `e3b` reports a first-payment cap delta of 241.7: the fixture's `cap.used` had not been computed before the first `recomputeTeamRatings`, so that number is an artefact. Only the second-call refusal and zero second charge are meaningful.
- E4's rival is CHI in every trial because the fixture's records are all 0-0, so ties resolve alphabetically. Real leagues pick the best-record division team.
- The schedule in E4 is the mock generator's 17-game slate, not the real 2026 slate.
- I ran no tests on a live online league server (no database). The online claims are from `online/src` reading plus the existing `hooded-readiness` and UI redact tests.
