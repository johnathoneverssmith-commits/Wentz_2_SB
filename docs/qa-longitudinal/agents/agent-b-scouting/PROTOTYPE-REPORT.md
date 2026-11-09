# Scouting slice 1: prototype and validation (Agent B)

Branch from `origin/master` @ `e44f18d` (contains #109 and #110). Local results, not CI. **No production behaviour changes:** the feature is behind `config.scouting` (absent = today's draft exactly). `draftBoard.ts` is untouched (its tests pass), so Agent C's trade-model window behaviour is preserved. The online action is a stub; nothing here is approved for production (backlog: "pending approval").

Reproduce: `harness/` (copy a `.ts` into `online/test/` as `_name.test.ts`, run with `SS=1 SS_SEEDS=9801,...,9824 SS_ARMS=... SS_OUT=out.json npx vitest run --root online test/_name.test.ts`; `SS_YEARS=1` adds 1/3/5-season aging). Rating = team `ratings.exact.overall`; paired by seed and team against a matched control draft (same seed, same class); mean ± SE over 24 leagues (seeds 9801–9824, the same seeds #107 used). **Rating points after the draft, not wins.**

## 1. Where prospect information comes from today

| | Human | CPU |
|---|---|---|
| Reads | Headline **college grade** (`DraftRoom.tsx:160-166`, sorted by it), "projects lo–hi" (`projectedRookieRange`), projected range, measurements, a deliberately ambiguous note, the "AI would take" suggestion (`bestAvailable`) | `readRookieBoard` → `expectedRatings(draftClass, scoutingAccuracy)` = the public projection, never `trueOverall` (`draftBoard.ts:4`) |
| Hidden rating exposed? | Not rendered. `RookieSignings.tsx` shows `trueOverall` only after the signing outcome. **Solo:** the whole `draftClass` including `trueOverall` is in the browser state and save (devtools can read it). **Online:** masked to `0` in the pull until signed/released (`online/src/index.ts:466`). The `server/` adapter payload carries no draft class. | No: the only `trueOverall` reads in code are class generation, rookie signing, `leagueDna/classProfile.ts` (a class-level aggregate, public by design) and the three guarded UI spots |

So today both sides see the same public number; the human has no way to learn more.

## 2. Evidence on current master (before any prototype code)

Re-run of #107's Experiment C harness, 24 seeds, 11 treated teams per seed, 24 reports, treated vs the same teams with the same drafting policy and no reports:

| Arm | Immediate rating change |
|---|---|
| 24 reports at positions of need | **+0.107 ± 0.028** (#107: +0.10) |
| 24 reports, top of the board | +0.028 ± 0.030 (#107: 0.00) |
| 24 reports, random | +0.012 ± 0.033 |
| perfect information (upper bound) | +0.253 ± 0.034 (#107: +0.20) |

#107's headline reproduces: need-targeted beats top-of-board at equal budget; top-of-board is indistinguishable from zero here.

## 3. The prototype (all in `ui-source/`)

- `state/scouting.ts`: pure. One report type (`{estimate, lo, hi}`), 1 point each, `HUMAN_POINTS = 24`; CPU budget 12/18/24 by difficulty (Expert = Master = human, never more). Report = `projection + k·(ε + N(0,7²))`, `k = τ²/(τ²+49)`, τ by public rank (PR #107's measured 6.6–11.2); noise seeded by (league seed, year, prospect), so no re-roll and two teams read the same number. `makeReport` is the only function that reads `trueOverall`.
- CPU and human use the same `spendReport` and the same `suggestTargets` (public data only: weakest 4 positions, prospects from 8 above to 40 below the team's first five picks). A person gets it as a "Scout my needs" button or one prospect at a time.
- Seam: `readRookieBoard` swaps in a team's own report estimates for scouted prospects (`rules.ts`). So `bestAvailable` (human suggestion) and `planAutopicks` (CPU, Autopick) use them with no new path. CPU teams buy reports in `beginDraft`.
- Draft Room: budget strip, per-row "Scout (1 of N)", and "Scouted: about 74 as a rookie (69–79)" beside the public projection. Not browser-verified (see §7).
- State: optional `LeagueState.scouting` and `LeagueConfig.scouting`.

Flow demonstrated in `scouting.test.ts` (10 tests): spend → refusal at point 25 and on repeat → stored ledger holds only `{estimate, hi, lo}` → the team's board changes only for the team that bought → pick via `bestAvailable`/`applyPick`; CPU parity; off-by-default; client-payload check.

## 4. What a report adds beyond the public grade

All 7,680 prospects (24 classes): corr(true, college grade) 0.57, corr(true, public projection) 0.61, mean grade − true **+8.6**. For the 6,336 prospects scouted at need (a restricted range, so lower baselines): corr(true, projection) **0.39 → 0.82** with the report; RMSE **8.0 → 5.0**; by public rank 1–32: 6.9 → 4.6, 33–96: 8.2 → 5.1, 97+: 9.6 → 5.3. The 80% range covers the truth **85%** of the time (slightly wide; calibrated by rank bucket in the report ε-model, not refitted). The report is never exact: no prospect's estimate equals the truth for more than a minority, and a test asserts it.

It changes decisions a lot: a scouting team's first pick differs from the unscouted run for **90%** of teams (top-of-board arm: 75%) and 72% of all its picks differ (includes knock-on effects of one changed pick on availability and need). That is a lot of movement for +0.14 rating, because each swap is worth little.

## 5. Outcomes

### Immediate (rating after the draft), through the real CPU draft path, 24 leagues

| Scenario | Treated 11 teams | The other 21 CPU teams |
|---|---|---|
| Only the 11 scout, 24 reports at need; others do not (an unfair world) | **+0.144 ± 0.029** | n/a |
| Same, top-of-board | +0.055 ± 0.027 | n/a |
| **Parity:** the 21 CPUs scout (12/18/24 points) and the 11 scout at need | −0.005 ± 0.030 | −0.001 ± 0.024 |
| Parity, the 11 scout the top of the board | −0.046 ± 0.035 | +0.038 ± 0.022 |
| **Parity, the 11 do not scout** | **−0.090 ± 0.029** | +0.062 ± 0.020 |
| All 32 scout | −0.002 ± 0.014 (mean over teams) | |

Human minus CPU under parity: **−0.005 ± 0.047** (no edge either way). Meaning, in plain words: scouting is a **rivalrous** gain. Once the CPUs also scout, doing it well only keeps you level, and skipping it costs about 0.09 rating (3σ). The spread between a good spend and skipping is ≈ 0.09–0.14 rating. The need-versus-top difference under parity (≈ 0.04) is about 1σ and **not significant**; the unfair-world gap (0.144 vs 0.055) is.

### Long-term (teams otherwise static, aging only: no free agency, no retirement-driven roster churn)

| Scenario | y1 | y3 | y5 |
|---|---|---|---|
| Only the 11 scout, need | +0.178 ± 0.029 | +0.181 ± 0.043 | +0.177 ± 0.056 |
| Parity, the 11 skip | −0.098 ± 0.032 | −0.119 ± 0.041 | **−0.158 ± 0.044** |
| Parity, the 11 scout at need | +0.011 ± 0.035 | +0.002 ± 0.042 | −0.052 ± 0.058 |

Consistent with #107's long-term +0.19 ± 0.06. Not tested: wins, free agency, contracts, the trade market.

## 6. Does it give both human and CPU a meaningful draft decision?

- **Human: yes, a real decision with a price.** What to scout matters (need ≈ 2.5× top-of-board in the unfair world) and not scouting is punished once CPUs scout. But it is a **catch-up decision**, not an edge: with parity the best-case result is level with a world where nobody scouts.
- **CPU: yes, with equal information terms.** The CPU's targets come from public data, its budget never exceeds a person's, and Master has Expert's information. Nothing the CPU does reads a hidden rating (a test asserts the one allowed read).
- **Design question for the owner (needs a decision):** #107 REFINEMENT D4 assumed a human edge of "≈ +0.1 per draft" under CPU parity. Measured here, that edge exists only if the CPUs scout less than the human. Options: (a) full parity (honest, no edge; skipping is the mistake); (b) CPUs get a smaller budget at lower difficulties (already so: 12/18/24), which restores a small edge only against Casual/Standard; (c) human-only (the CPU stays blind; the human beats the CPU by 0.14, which the backlog says the human "currently cannot" do).

## 7. Client payload and what was not verified

- A stored report is `{estimate, lo, hi}`; the true rating and ε are never stored (test: serialised ledger names no hidden field; every report has exactly those keys).
- **Finding:** the ledger holds all 32 teams' reports. Because two teams read the same number, shipping another team's ledger to a GM is **free scouting on every prospect it covers** and shows what the CPU is targeting. `scoutingViewFor(scouting, team)` returns only the viewer's team. A test builds the online view (hidden rating masked as `index.ts:466` does, plus `scoutingViewFor`), and asserts that no prospect the viewer did not scout carries an estimate. **`online/src/index.ts` must apply it; I did not edit that shared file.** The `trueOverall = 0` mask there is inline in a route handler (not unit-testable); the production PR should move it into `privacyView.ts` next to `stripPrivatePlayerFields`.
- Solo: the ledger stays in the save, and the browser state still holds `trueOverall` (unchanged from today).
- **Not verified:** the Draft Room UI was typechecked but not rendered in a browser; the online action is a stub; the how-it-works text is not updated (the mechanic is off by default; the production PR must change it with the mechanic); no CI run; wins not simulated.

## 8. Draft Room disclosure (Agent D / QA register PA-003)

"Roster needs & unit grades" in `components/decisions/DraftContext.tsx` (used by the Draft Room only) inherits `.decision-workspace details > summary { color: #c9dcf0 }` on a light page: 1.25:1 (computed from the register's sampled colours). Fix: a class on that one `<details>` and a rule in a new `draft-context.css` using `--gd-ink` (`#0b1b2e`, ≈ 16:1 on `rgb(239,242,245)` by calculation). Draft-Room-scoped on purpose; the shared root rule (`decisions.css:19`, which also affects trade and free agency) is untouched. Not pixel-verified in a browser. It can ship separately from scouting.

## 9. Proposed production scope, files, test plan

Needs the owner's approval (production code, simulation-adjacent balance, save and multiplayer payload).

**Files:** `ui-source/src/state/scouting.ts`, `rules.ts` (board seam, `beginDraft`), `domain/league.ts` (the two optional fields), `store.ts`, `useLeagueActions.ts`, `screens/DraftRoom.tsx`, `state/howItWorks.ts` (+ its test), `OnlineLeagueClient.ts` and `online/src/actions.ts` (a `scout` action), `online/src/index.ts` and `privacyView.ts` (the viewer filter; **shared, coordinate first**), `state/saveCompaction.ts` (drop the ledger after the draft), `online/test/` (a scouting suite plus `full-circuit` re-run).

**Save/multiplayer changes:** optional `scouting` on the state and optional `config.scouting` (older saves load unchanged; absent = no ledger and the same draft); per-viewer filter on every pull; a server action to buy a report (the server computes it, the client never holds `trueOverall` online); the ledger resets each draft year. Size ≈ 32 × 24 small objects.

**Test plan:** `scouting.test.ts` (here); byte-identical draft with the flag off (golden draft on a fixed seed, plus `draftBoard`, `aiDifficulty`, `aiStrategy`, `ai-master.test.ts`); `passing-volume`/realism untouched (no engine change); an online concurrency test for two GMs buying reports; the payload test against the real route; `full-circuit.test.ts`; `STATS_SEEDS=12` check of the effect sizes above in the real online path; a browser pass of the Draft Room at 1440/390/320 with `audit:visual`; CI on the final head.

**Decision needed from the owner:** (1) approve slice 1 as scoped; (2) choose the parity policy in §6 (a / b / c); (3) whether the grade-label demotion (backlog rank 7, STRAT-003 display half) ships first or with it, because the report is shown beside a number that overstates by ≈ 9–15.
