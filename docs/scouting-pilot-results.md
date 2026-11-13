# Scouting pilot (STRAT-003): measurements

Solo-only, off by default (`config.scouting`). Each CPU GM buys `CPU_POINTS = 12` basic reports when the draft opens; a person has `HUMAN_POINTS = 24`. Online leagues cannot turn it on (`cleanConfigPatch` rejects the key) and the online action stays a stub. Local results, not CI.

## Method
- Harness: `online/test/scouting-budget.test.ts` (skipped unless `SS=1`); summary: `analysis/scouting-pilot/summarize.cjs`. Committed summaries: `analysis/scouting-pilot/results-b12-seeds-9901-9948.json`, `analysis/scouting-pilot/exploratory-b6-b8-seeds-9901-9948.json`.
- 48 fresh matched leagues, seeds 9901-9948 (not the 9801-9824 of #107 / the prototype, and not the 101-124 statistics baseline). Each seed's class is drafted once per arm; every arm is compared with the same seed's **control**, in which nobody scouts (today's draft).
- 11 "scripted human" teams (every third team by sorted code) and 21 CPU teams. Scripted human policies: `skip` (no reports), `need24` (24 reports from `suggestTargets`, the same function as the "Scout my needs" button), `top24` (the 24 best-ranked prospects).
- Rating = team `ratings.exact.overall` after rookies sign. The unit of analysis is the league: each seed's 11 and 21 team differences are averaged first, so the paired standard error is over 48 leagues. 95% interval uses the t distribution. **Rating points, not wins.**

## Result at 12 CPU reports (48 leagues)
| Scripted human | Human vs today's draft (mean ± SE, 95% CI) | CPUs (21) vs today | Human minus CPU |
|---|---|---|---|
| scouts 24 at need | **+0.085 ± 0.019** [+0.046, +0.123] | −0.019 ± 0.015 | +0.104 ± 0.028 |
| skips | **−0.060 ± 0.019** [−0.097, −0.022] | +0.031 ± 0.014 | −0.091 ± 0.028 |
| scouts the top 24 | −0.013 ± 0.020 [−0.053, +0.027] | +0.006 ± 0.013 | −0.020 ± 0.027 |

**Acceptance check as approved (12 reports):**
- Scouting at need ≥ +0.05: **met** on the point estimate (+0.085); the 95% interval's lower end (+0.046) is just below 0.05.
- Skipping within ±0.03 of baseline: **not met** (−0.060; the whole 95% interval, −0.097 to −0.022, is outside ±0.03). **Owner decision: the 12-report budget stays and the −0.060 cost of skipping is accepted.** It exceeds the original ±0.03 band; the trade-off was accepted because scouting should matter: a GM who skips falls behind, and a GM who scouts at positions of need gains **+0.085** (95% CI +0.046 to +0.123) over today's draft.

These numbers are from the corrected build. An earlier run used a need benchmark that averaged every 31st player rather than each team's best (Codex review finding, fixed in this PR): it gave need +0.081 and skip −0.060, so the conclusion did not change.

## Exploratory, same 48 seeds (not part of the approved scope)
| CPU reports | skip | scouts at need | human minus CPU (need) |
|---|---|---|---|
| 6 | −0.042 ± 0.015 | +0.114 ± 0.018 | +0.147 |
| 8 | −0.038 ± 0.018 | +0.103 ± 0.017 | +0.130 |
| 12 | −0.060 ± 0.019 | +0.085 ± 0.019 | +0.104 |

A smaller CPU budget does **not** bring skipping inside ±0.03 on these seeds. An earlier, pre-fix run suggested 8 might; the corrected run does not support that. Hypothesis (untested): part of the skip penalty is not the CPUs' reports but the control comparison itself, because any CPU scouting changes which prospects are left for the human proxy. If so, the ±0.03 skip band may not be reachable with any non-zero CPU budget, and the criterion should be restated (for example, "skipping costs no more than −0.07", or "need beats skip by at least X").

## Report quality and cost (12-report run)
- Report error vs the hidden rating: public projection RMSE 6.9 (CPU-scouted prospects) / 7.5 (human-scouted) → report **5.05 / 5.23**. 80% interval covers the truth **83%** of the time.
- CPU scouting runtime: about **68 ms per league** on average (max 89 ms across the arms) for all 21 CPU GMs; the whole CPU draft is about 69 ms. About 53 distinct prospects are scouted by the CPUs per league.
- Human effort: one "Scout my needs" press, or one click per prospect (24 points).

## Not measured
Wins; free agency, trades and contracts; long-term (the 5-season figures in #107 and the prototype report are theirs, not re-run); fun; online concurrency; mixed budgets by difficulty.

## Reproduce
```bash
git checkout <this PR's head>
npm ci && npm --prefix ui-source ci
SS=1 SS_SEEDS=$(seq -s, 9901 9948) SS_ARMS=B12_skip,B12_need24,B12_top24 SS_OUT=/tmp/pilot.json \
  npx vitest run --root online test/scouting-budget.test.ts        # ~2 min
node analysis/scouting-pilot/summarize.cjs /tmp/pilot.json
# exploratory: SS_ARMS=B6_skip,B6_need24,B8_skip,B8_need24
```
Settings: `createLeague(seed, {...DEFAULT_CONFIG, humanGmCount: 1})`, all GMs CPU, stage `offseasonDraft`, scripted humans every third team by sorted code.

## Flag off
`online/test/scouting-flag-off.test.ts` compares a SHA-256 of the draft results, teams, players, class and rookie outcomes with hashes produced on `origin/master` @ `2f2eeb4` before this code existed (seeds 9901-9903); I also compared six seeds (9901-9906) master vs this branch: identical.

## Browser check (Chromium, solo league saved at the rookie-draft door with scouting on)
At 1440, 390 and 320 px: the strip shows "24 of 24 reports left"; one row button buys one report; "Scout my needs" spends the rest; the report line reads "Scouted: about 78 as a rookie (71-84)"; rows left over read "No reports left"; no horizontal scroll; no console errors; the reports survive a reload. At 390/320 some rows draw as dark cards with dark text, including on current master (an existing mobile style rule in `decisions.css`), so the scouted line is hard to read in those rows.

## Remaining online blockers
1. Report noise is a pure function of `state.seed`, which an online pull carries: a client can subtract it and recover a scouted prospect's hidden rating to about 0.6 points. Needs a server-held salt.
2. `scoutingViewFor` is not applied in `online/src/index.ts`; the ledger would ship every team's reports.
3. The online `scout` action does not exist; the `trueOverall` mask in `index.ts` should move to `privacyView.ts`.
4. Concurrency test for two GMs buying reports; `full-circuit` with scouting on; Postgres-backed CI.
