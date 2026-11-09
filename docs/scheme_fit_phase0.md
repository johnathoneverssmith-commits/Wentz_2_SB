# Phase 0 scheme fit: results and compatibility notes

Mechanism and decision: `docs/decisions.md` -> "Phase 0 scheme fit". Harness: `npx tsx analysis/47_scheme_fit.ts`.
Rosters: the 32 reference teams from a local, git-ignored `data/players.local.json` copied from the authored UI pool (not the nflverse-generated pool).

## Exact fit shift, mean over 32 teams, tags stripped (rush yd/carry | completion logit)
| scheme | legacy | derived |
|---|---|---|
| west_coast | -0.243 \| -0.049 | +0.002 \| +0.000 |
| vertical | -0.124 \| -0.025 | -0.008 \| -0.002 |
| spread | -0.257 \| -0.051 | -0.001 \| -0.000 |
| power_run | -0.144 \| -0.029 | +0.008 \| +0.002 |
| zone_run | -0.213 \| -0.043 | +0.011 \| +0.002 |
| four_three (vs offense) | +0.076 \| +0.015 | -0.033 \| -0.007 |
| three_four | +0.083 \| +0.017 | +0.046 \| +0.009 |
| cover_3 | +0.118 \| +0.024 | +0.004 \| +0.001 |
| cover_2 | +0.076 \| +0.015 | +0.043 \| +0.009 |
| man_press | +0.125 \| +0.025 | -0.030 \| -0.006 |

Tagged rosters: 0.000 in both modes. `pro_style` / `multiple`: 0 always. Positive defensive numbers help the offense, i.e. hurt that defense.

(Derived column: final version, centred per slot, see below; reference rosters with tags stripped. The first draft of the Phase 0 PR used the reference-pool baseline and read within ±0.06.)

## Fictional-league check (final verification)
`createLeague(seed, DEFAULT_CONFIG)` seeds 1-3 (0 stored tags on ~2,000 players; baseline seeds are 1000-1019), starters picked by the engine's own `Roster`, all 32 teams. Legacy is a flat charge on every team; derived is centred and varies by team:

| | legacy (mean, sd 0 across teams) | derived (league mean over 3 seeds) | team-level sd |
|---|---|---|---|
| offense rush yd/carry, 5 specialised schemes | -0.124 to -0.257 | -0.035 to +0.040 | 0.02-0.07 |
| defense rush yd/carry (+ hurts the defense) | +0.076 to +0.125 | -0.050 to +0.034 | 0.03-0.06 |
| `pro_style` / `multiple` | 0 | 0 | 0 |

Before the per-slot, fictional-league centring the same check showed `man_press` still +0.054..+0.080 (hurting the defense on 27-31 of 32 teams) and `three_four` -0.065..-0.096 and `cover_2` -0.055 of unearned bonus, because the derivation's thresholds sit on the reference pool's attribute scale. That is the finding that changed the design. What remains is a per-league offset of about ±0.03 between seeds, which an engine constant cannot remove (about 0.1 yd/carry is 0.3 margin).

## Real-engine margins (earlier draft: reference-pool centring; not re-swept, the exact shifts above are the evidence) (team A, 384 games/cell, standard error about 0.75 at talent 1.0 and 0.9 at 1.5)
Mean over the five specialised offences, margin vs the neutral scheme's cell: stripped legacy talent 1.0 +0.14 vs +0.10 neutral (inside noise); talent 1.5 -0.74 vs +0.02 (clearly negative, the defect); stripped derived talent 1.5 +0.55 vs +0.02. Defensive cells are all inside noise in both modes at both talents (legacy -0.46..+0.77 at 1.0, +0.21..+0.64 at 1.5), so the sim does not by itself demonstrate the defensive penalty; the exact shifts above do. Compatible rosters (every starter tagged for the scheme) gain +1.5..+2.4 over neutral at talent 1.0 and +0.2..+2.4 at 1.5 (offence at 1.5 is noisy: +0.21..+0.84). "Incompatible" cells equal legacy-untagged exactly (same fit of 0), as expected. Full tables were printed by the harness; do not read single cells as precise.

## Compatibility
- Absent `LeagueConfig.schemeFit` or `Staff.schemeFit` = legacy; asserted byte-identical at talent 1.0 and 1.5 (`test/engine-scheme-fit.test.ts`).
- Tagged rosters are byte-identical in derived mode; the league-average staff stays an exact no-op.
- No save version bump; no in-app toggle yet. Existing and online leagues stay legacy until an explicit later migration.
- New leagues, including newly created online leagues, are derived (`online/src/leagues.ts` spreads `DEFAULT_CONFIG`; the rules patch cannot set the flag). Older saves/leagues have no field and stay legacy; reload, migration and JSON round trips do not add it (`online/test/scheme-fit-flag.test.ts`). The flag rides on the staff, which every online simulateGame call site takes from `staffPairOf` (guarded by a source test) and the standalone adapter from `engineStaffsFor(state)`.
- Python: TS/Python numerical parity (1,152 values, max abs diff 0) via `test/engine-scheme-fit-parity.test.ts`. The Python game loop was not re-run.
- CI runs the pool-dependent tests: `vitest.config.ts` supplies `test/fixtures/pool.json` when no local pool exists (verified by running `engine-scheme-fit` with the local pool moved away).
- `test/verify-safety.test.ts` "ends the command's whole process tree" fails identically on pristine `origin/master` in this sandbox (grandchild still running), so it is environmental here, not a regression.
