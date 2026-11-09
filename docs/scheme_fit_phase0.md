# Phase 0 scheme fit: results and compatibility notes

Mechanism and decision: `docs/decisions.md` -> "Phase 0 scheme fit". Harness: `npx tsx analysis/47_scheme_fit.ts`.
Rosters: the 32 reference teams from a local, git-ignored `data/players.local.json` copied from the authored UI pool (not the nflverse-generated pool).

## Exact fit shift, mean over 32 teams, tags stripped (rush yd/carry | completion logit)
| scheme | legacy | derived |
|---|---|---|
| west_coast | -0.243 \| -0.049 | +0.016 \| +0.003 |
| vertical | -0.124 \| -0.025 | +0.027 \| +0.006 |
| spread | -0.257 \| -0.051 | +0.005 \| +0.001 |
| power_run | -0.144 \| -0.029 | -0.015 \| -0.003 |
| zone_run | -0.213 \| -0.043 | +0.010 \| +0.002 |
| four_three (vs offense) | +0.076 \| +0.015 | -0.062 \| -0.013 |
| three_four | +0.083 \| +0.017 | +0.031 \| +0.006 |
| cover_3 | +0.118 \| +0.024 | +0.030 \| +0.006 |
| cover_2 | +0.076 \| +0.015 | -0.001 \| -0.000 |
| man_press | +0.125 \| +0.025 | +0.022 \| +0.004 |

Tagged rosters: 0.000 in both modes. `pro_style` / `multiple`: 0 always. Positive defensive numbers help the offense, i.e. hurt that defense.

## Real-engine margins (team A, 384 games/cell, standard error about 0.75 at talent 1.0 and 0.9 at 1.5)
Mean over the five specialised offences, margin vs the neutral scheme's cell: stripped legacy talent 1.0 +0.18 vs +0.10 neutral (inside noise); talent 1.5 -0.74 vs +0.02 (clearly negative, the defect); stripped derived talent 1.5 +0.55 vs +0.02. Defensive cells are all inside noise in both modes at both talents (legacy -0.46..+0.77 at 1.0, +0.21..+0.64 at 1.5), so the sim does not by itself demonstrate the defensive penalty; the exact shifts above do. Compatible rosters (every starter tagged for the scheme) gain +1.5..+2.4 over neutral at talent 1.0 and +0.2..+2.4 at 1.5 (offence at 1.5 is noisy: +0.21..+0.84). "Incompatible" cells equal legacy-untagged exactly (same fit of 0), as expected. Full tables were printed by the harness; do not read single cells as precise.

## Compatibility
- Absent `LeagueConfig.schemeFit` or `Staff.schemeFit` = legacy; asserted byte-identical at talent 1.0 and 1.5 (`test/engine-scheme-fit.test.ts`).
- Tagged rosters are byte-identical in derived mode; the league-average staff stays an exact no-op.
- No save version bump; no in-app toggle yet. Existing and online leagues stay legacy until an explicit later migration.
- Not re-run: Python engine (syntax-checked only), `engine-realism`'s statistical baselines (the suite passed).
