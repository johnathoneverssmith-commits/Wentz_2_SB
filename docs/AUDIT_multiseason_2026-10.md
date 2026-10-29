# Multi-season franchise audit, October 2026

Read-only audits of master at `b292228` (CPU trade intelligence), then a follow-up at `f9b3246` (zero-human rookie
signing fix, PR #57). Method, numbers, verdicts and open items. No gameplay code was changed by the audit itself.

## Method

All runs use existing harnesses; nothing new was added to the repository.

| Harness | Config | Used for |
|---|---|---|
| `online/test/contract-metrics.test.ts` (`B2B_METRICS=1`) | 2 human GMs, 4 seeds x 15 seasons | cap, dead money, contract length/age, team strength, parity |
| `online/test/trade-metrics.test.ts` (`TRADE_METRICS=1`) | 4 seeds x 15 seasons; two-human variant (humans skip the deadline and decline waiting offers) | trade volume, fairness, liability-dump probe |
| `ui-source` `npm run franchise:stress` | `cpu_only`, 4-6 leagues x 15 seasons, single-player store | invariants, league-year trends |
| Throwaway tests (deleted) | zero-human vs two-human, same seed, stage-by-stage state snapshots | the rookie-signing diagnosis and the post-fix rerun |

## Findings and verdicts

1. **All-CPU decay: production bug, fixed (PR #57).** With no human GM, entering free agency closed the market on the spot and
   the league landed on `freeAgencySummary` inside the same `onStageEntered` call; the rookie-signing block behind a
   `state.stage === "freeAgency"` guard never ran. About 320 players a season (224 drafted, 96 undrafted) were never created.
   Reachable online when the last human leaves (`vacateSeat`). Leagues with a human were byte-identical before and after
   (70 of 70 transitions, 2 seeds x 3 offseasons).
2. **First-year strength step (72 to 80): harness artifact.** `team.ratings.overall` holds a placeholder 72 until
   `recomputeTeamRatings` first runs; recomputed it is 78.1 at the 2026 preseason and 79.3 a year later. Growth after that is gradual
   (rookie starters ~79-81 plus development) and is a balance question, not a defect.
3. **Stress-script invariants (65,777): false positives, one real residue.** All 18,363 `missing_owner_team` are `PS:` practice-squad
   players (by design). `cap_ledger_mismatch` compares roster contracts only; the game's `capUsedOf` also counts practice squad and
   dead money, and with that definition `scripted_human` shows 0. `signed_player_still_free_agent` in human mode is players signed
   correctly and released later. Real but small: 66 transient ledger drifts (up to ~$7M, only at the two free-agency summary
   stages, gone by preseason) in `cpu_only`.
4. **Late-season trade collapse and rising free dump takes: artifacts of finding 1** (all-CPU leagues had decayed rosters). In valid
   two-human leagues, deadline trading is stable to 2040 (~10 offers, ~7 accepted per league-year, no zero-trade seasons), 0 teams
   over the cap after the deadline, buyer paid/received ratio 1.1.

## Post-fix rerun (zero-human online league, 4 seeds x 15 seasons, `f9b3246`)

| | Before fix (seed 9301) | After fix (4 seeds) |
|---|---|---|
| Players rated 75+ | 637 (2028) to 84 (2038) | 701 / 768 / 794 (2027-29); 790 (2031) to 747 (2041) |
| Rookie supply | 0 created per year | exactly 320 every offseason, all 15 (per-class count, no duplicates) |
| Roster size at preseason | 53 (kept legal by roster fill, from a thinning pool) | 53 on every team, every year |
| Teams over the cap | 0 | 0 |
| Mean cap space as share of cap | 63% by 2038 | 4-6% throughout |
| Team-overall sd / top-8 minus bottom-8 | n/a | 1.8 to 1.2 / 4.5 to 2.9 |
| Regular-season wins sd | n/a | 2.3-2.8, flat |

Cumulative rookie ids in state plateau near 1,950 only because retired players are pruned; the per-class count above is the supply measure.

The slow drift after 2031 (players 75+ 790 to 747, 85+ 234 to 178, top-8 team overall 82.7 to 81.7) matches the two-human runs
(top-8 82.9 to 80.6 in the contract harness) and reads as the league's equilibrium, not a zero-human effect.

Stress `cpu_only` (single-player store, 4 leagues) is unchanged by the fix, as expected: payroll 238 to 589, mean ovr 73.7 to 71.3,
same invariant mix. That mode flips `isHuman` off on a store that always has a human, which the product never does.

## Unresolved

- Late-season dump probe: free takes of the overpaid-contract probe rise from 2-3 to ~11 of 30 by 2040 in valid leagues, almost all
  at contracts the model values at or above zero (deals it values below zero were taken free 7 times in 1,290). Cause not isolated.
- `cpu_only` stress shows zero recorded free-agent signings, rookies and trades, and a larger cap-space share than the online path;
  the store path may mishandle a human-less state, but it is not reachable in single-player.
- Stress counters `rookies_entering`, `rookies_on_roster` and CPU-to-CPU `trades_completed` read 0 even with a human; roster size is
  sampled at season end, before the offseason, so it is not comparable across stages.

## Follow-up work (none started)

1. Tooling PR for `ui-source/scripts/franchise_stress_test.ts`: practice-squad owner check, `capUsedOf` ledger, signed-then-released
   classification, working rookie/trade counters, and an online-path (not store) cpu-only mode. A draft diff covering the first three was prepared during the audit and is not in the repository.
2. Isolate the dump-probe rise (scale-invariant probe first), then decide whether the model needs a floor on liability value.
3. Make harness league creation call `recomputeTeamRatings`, so metrics stop reading the 72 placeholder.
4. The definitive 20-season audit, after the other workstreams are integrated.
