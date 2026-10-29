# Realism audit — QB calibration, mature leagues, halftime defect, replay design (read-only)

Third document after `REPORT.md` and `FOLLOWUP.md`. Nothing in the engine, UI, schema, saved data or services was changed; scratch vitest files were deleted after use (copies kept as `*.test.ts.txt`). All figures are local runs, not CI. Engine under test: `master` @ `a115b77` (includes MP-1; does not include PD-1, PBP-1, MP-2 or the cap-growth branch).

## Summary

1. **Realistic 1.0 needs no global team-strength change.** In CPU-only leagues played end to end by the production stage machinery (8 leagues per setting), seasons 1–3 land on the NFL: margin sd 13.7 / 14.3 / 14.5 (NFL 14.3), one-score games 50% (53%), 21+ point games 14.5 / 16.1 / 16.7% (16.5%), true team-strength sd 4.5 / 4.9 / 5.2 (5.0). Starter-quality sd across teams is 0.9 / 1.5 / 1.8 against 1.86 for the real rosters.
2. **Those distributions then diverge, because rosters do.** By season 5 the margin sd is 17.3 and by season 10 it is 20.4 (21+ point games 34%). The cause is the roster pipeline, not the engine: the league's starter mean falls from 78.8 to 65.7 and starter-quality sd rises to 6.6. That belongs to the long-term franchise / player-development work.
3. **The QB finding is confirmed and attributable.** A QB's effect on completion % is 37% rating layer, 37% team-strength, 26% synergy; on interceptions 56 / 33 / 11%. The three overlap (together they add up to 81% of their sum). Talent 1.5 multiplies everything by about 1.4–1.5.
4. **A targeted fix that keeps QB value near your 2.5-point target exists and is measured at team level.** Scaling the QB's own term to 0.5 on completion and 0.45 on interception in all three layers, plus a small QB-arm yards term (0.25 yd/completion per z), keeps margin at 2.7 points per QB standard deviation at 1.0 (today 3.2) while cutting the completion slope 40% and the interception slope 35%. League-level validation of that exact combination, and the recalibration it triggers, are still to do.
5. **`ai-master.test.ts` does omit `fitDraftedPayrolls`**, and the league it builds is stripped of its stars. Its result is within noise either way.
6. **The halftime defect has a deterministic regression test**, written and shown to fail on current `master`.
7. **A replay-persistence design is ready for approval** (§6).

---

## 1. Paired QB sensitivity (Task A)

**Method.** Baseline Seattle (QB 80, otherwise unmodified roster; the backup QBs removed so a weak QB stays the starter). The QB is replaced by copies with every attribute shifted by a fixed amount and `overall` moved with it (54 to 99). Each cell is 310 games (all 31 opponents, home and away, five repetitions). **Seeds depend only on repetition, opponent and venue**, so every QB level, layer setting and candidate plays the identical seed schedule; contrasts between cells are paired. Standard error: ≈ 0.8 margin points per cell, ≈ 0.3 per 10-overall slope.

**Layer isolation** uses an experimental copy of the engine kept outside the repository (`qb_experiment.patch` is the diff against `src/`; all knobs default to 1 and the copy reproduces production bit for bit: same game hash over 60 seeds). A knob scales only the QB's own term in one layer, on the completion and interception channels:

| Knob | What it scales |
|---|---|
| rating layer (R) | `centered("qb_accuracy" / "qb_ball_security", [qb])` in `ratings.ts` |
| team-strength (S) | the QB position's contribution to the completion and interception channel indices in `team-strength.ts` |
| synergy (Y) | the QB z-score in the QB × receiver pair term in `synergy.ts` |
| talent scaling | `talentScale` 1.0 vs 1.5 |

Slopes per **+10 overall**, fitted over QB 66–94 (the pool's range is 70–96); one layer left on at a time. "none" leaves the QB in no layer on those two channels; what remains is his effect on sacks and the run channel.

| Talent 1.0 | cmp % | Y/A | pass TD % | INT % | sack % | margin | win % |
|---|---:|---:|---:|---:|---:|---:|---:|
| **All layers** | **+7.95** | +0.99 | +1.26 | **−1.30** | −0.81 | **+4.69** | +13.3 |
| rating only | +3.64 | +0.50 | +0.55 | −1.00 | −0.70 | +2.81 | +8.8 |
| team-strength only | +3.61 | +0.52 | +0.63 | −0.58 | −0.83 | +2.40 | +7.9 |
| synergy only | +2.61 | +0.36 | +0.33 | −0.20 | −0.50 | +1.23 | +4.6 |
| none (sacks, run channel only) | +0.22 | −0.01 | −0.13 | −0.09 | −0.72 | +0.19 | +2.9 |
| Talent 1.5, all layers | +11.64 | +1.52 | +2.09 | −1.80 | −1.01 | +7.03 | +18.8 |

- **Shares** (of the three single-layer slopes): completion R 37 / S 37 / Y 26%; interception R 56 / S 33 / Y 11%; margin R 44 / S 37 / Y 19%.
- **They overlap.** The three single-layer completion slopes sum to 9.86; all together give 7.95 (81%). Margin: 6.44 vs 4.69 (73%). That is the soft cap acting on the sum, so no single layer can be turned down by a fixed amount and give a proportional result.
- **Talent scaling** is a plain multiplier on the whole bundle: completion ×1.46, interception ×1.38, margin ×1.50 at 1.5.
- **Extremes are set by the caps, not by the QB term.** The combined completion/interception shift is capped at ±0.55 logit before talent scaling (×1.5 at Amplified). A 54-rated QB completes 56.5% at 1.0 and 51.5% at 1.5 whatever the layer weights (both are the cap). Within the pool's range (70–96) at 1.0 the QB moves completion from 59.3% to 77.8% and interceptions from 3.8% to 0.7%.
- **QB value today:** 4.69 margin points per +10 overall, i.e. **3.2 points per QB standard deviation (6.8 overall) at 1.0 and 4.8 at 1.5** over the pool's range. The 2.3 quoted in `FOLLOWUP.md` was the slope across the whole 54–96 test range, which includes the capped tails.

### Candidate calibrations (team level, same paired cells)

Scaling the QB's own term, by layer-wide factors (completion / interception); "+yards" adds a QB-arm yards-per-completion term (throw power and deep accuracy, mean zero, in yards per z):

| Talent 1.0, slope per +10 overall | cmp % | Y/A | TD % | INT % | sack % | margin | margin per QB sd | cmp % at QB 70 → 95 | INT % at 70 → 95 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Today | 7.95 | 0.99 | 1.26 | −1.30 | −0.81 | 4.69 | 3.19 | 59.3 → 77.8 | 3.77 → 0.69 |
| 0.6 / 0.55 | 5.83 | 0.75 | 0.84 | −1.02 | −0.71 | 3.61 | **2.46** | 62.6 → 76.0 | 3.27 → 0.84 |
| 0.5 / 0.45 | 4.93 | 0.66 | 0.76 | −0.91 | −0.82 | 2.99 | 2.03 | 64.1 → 75.7 | 3.09 → 0.89 |
| **0.5 / 0.45 + yards 0.25** | **4.78** | **0.93** | **1.40** | **−0.84** | −0.80 | **4.02** | **2.74** | 64.2 → 75.7 | 2.89 → 0.91 |
| 0.6 / 0.55 + yards 0.5 | 5.68 | 1.39 | 2.27 | −0.93 | −1.00 | 6.46 | 4.40 | | |
| 0.6 / 0.55 + yards 0.8 | 5.95 | 1.78 | 2.68 | −1.05 | −0.97 | 7.21 | 4.91 | | |

At **Amplified 1.5** (same candidates): today 7.03 points per 10 overall, i.e. 4.78 per QB sd; 0.6 / 0.55 → 3.70; 0.5 / 0.45 → 3.00; 0.5 / 0.45 + yards 0.25 → 3.75. Completion slope 11.6 → 7.1 (0.5 / 0.45), interception −1.80 → −1.09.

Yards terms above 0.3 over-restore (Y/A and TD slopes double). 0.25 is where Y/A, TD% and margin match the current behaviour.

### League-level envelope (starters with 300+ attempts, two seasons per cell, same seeds)

Real NFL 2023–25 (n=81): completion sd 3.09 (range 58.1–72.9), INT sd 0.71 (0.6–4.0%), Y/A sd 0.76, max 21 INT. Sampling noise at ~550 attempts is ≈ 2.0 completion points and 0.61 INT points (the same in the sim).

| Roster set, talent 1.0 | Config (cmp / INT) | cmp sd (min–max) | INT sd (min–max) | Y/A sd | max INT per 550 att | League cmp / INT % | Points | Margin sd |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed pool | today | 5.62 (53.2–77.0) | 1.14 (0.4–5.3) | 0.83 | 29.5 | 66.5 / 2.15 | 22.6 | 15.3 |
| | 0.6 / 0.55 | 4.20 (59.2–77.0) | 0.91 (0.6–4.7) | 0.67 | 26.1 | 67.5 / 1.92 | 22.7 | 14.4 |
| | 0.5 / 0.45 | 4.10 (57.9–76.6) | 0.80 (0.6–4.5) | 0.65 | 25.1 | 67.5 / 1.83 | 22.9 | 14.3 |
| | 0.4 / 0.35 | 3.85 (60.6–77.6) | 0.71 (0.6–4.1) | 0.64 | 22.8 | 67.6 / 1.80 | 22.9 | 14.4 |
| Mature league, season 1 | today | 4.67 (60.1–80.3) | 0.81 | 0.65 | 20.8 | 69.7 / 1.76 | 21.8 | 14.4 |
| | 0.5 / 0.45 | 3.72 (62.1–78.6) | 0.66 | 0.61 | 19.9 | 69.8 / 1.64 | 21.9 | 14.5 |
| Mature league, season 3 | today | 4.72 (60.4–80.3) | 1.00 (0.2–4.9) | 0.68 | 27.5 | 68.9 / 1.92 | 22.3 | 12.7 |
| | 0.5 / 0.45 | 3.90 (62.5–79.4) | 0.74 (0.4–3.6) | 0.58 | 20.3 | 69.1 / 1.81 | 22.1 | 12.4 |
| Fixed pool, talent 1.5 | today | 7.64 (51.2–82.4) | 1.24 | 1.21 | 33.0 | 68.0 / 2.00 | 22.9 | 17.1 |
| | 0.5 / 0.45 | 4.72 (54.5–78.1) | 0.86 | 0.83 | 24.4 | 68.7 / 1.68 | 22.9 | 16.4 |

What it shows:
- **0.5 / 0.45 brings the starter completion sd from 4.7–5.6 to 3.7–4.1 and the interception sd from 0.8–1.1 to 0.66–0.80,** within about 20% of the NFL's 3.09 and 0.71 once noise is considered. The maximum single-season interception total falls from 27–30 to 20–25 (NFL max 21 across 81 starters).
- **Going below 0.4 buys little:** team context (receivers, protection, coverage) supplies the remainder.
- **Competitive balance is not affected:** margin sd moves 15.3 → 14.3 on the fixed pool (NFL 14.3) and is unchanged on the mature rosters. The QB compression is not a team-spread lever.
- **League means drift and must be refit:** completion +1.0 pt, interception −0.3 pt (−15%), points flat. First-order offsets: completion ≈ −0.05 logit, interception ≈ +0.15 logit on `CALIB_BY_TALENT`.
- **League completion 69–70% on drafted and mature rosters** (vs 66.5% on the real rosters and 64.7% NFL) is a separate effect: the calibration offsets were fitted on real-roster dispersion, and a league with no weak links completes more. Worth a re-fit of the level on a mature league at the same time.

## 2. Recommended per-channel calibration (not implemented)

| Parameter | Value | Where | Expected effect at 1.0 |
|---|---|---|---|
| `QB_EFFECT.complete` | **0.5** (range 0.5–0.6) | multiplies the QB's own term in `ratings.ts` (`qb_accuracy`), `team-strength.ts` (QB share of the completion index), `synergy.ts` (QB × receivers) | completion slope −40%; completion sd 3.7–4.1 |
| `QB_EFFECT.interception` | **0.45** (0.45–0.55) | same three places, interception channel | interception slope −35%; sd 0.66–0.80 |
| `QB_EFFECT.sack` | 1 (unchanged) | — | sack behaviour preserved |
| QB arm term | **0.25 yd per completion per z** (throw power, deep accuracy; unused by any layer today) | `sim.ts` yards on completion | Y/A and TD slopes ≈ today; QB margin ≈ 2.7 per sd (target 2.5) |
| `CALIB_BY_TALENT.complete` / `.interception` | refit (≈ −0.05 / +0.15 logit first guess) | `sim.ts`, `analysis/40_channel_calibration.ts` | league completion ≈ 66.8, INT ≈ 2.2, points ≈ 22.6 |
| Everything else (`TEAM_STRENGTH_SCALE`, `PER_POINT`, soft limits, talent mapping, unit values, AI) | unchanged | — | — |

At 1.5 the same factors give 3.0–3.75 points per QB sd, i.e. Amplified stays more exaggerated, as intended.

**Open points.** (a) The "+yards" combination was measured at team level only, not league level. (b) The synergy term here scales the QB × receiver pair; the QB also feeds the pressure and blitz terms, which I left alone. (c) The QB arm term is new behaviour and is the part most worth a second look: the alternative is to accept a ~2.0 points-per-sd QB and drop it. (d) Because the soft caps sit on the *combined* shift, bounding the QB's own term inside the cap would also lower the weak-end extremes (54–62-rated QBs); that matters little for a pool that starts at 70, but it shapes the tails of a deflating league (§3).

## 3. Mature-league balance (Task B)

> **Correction (see `PHASE4.md` §C).** The polarisation from season 4 reported below was caused by a defect that the harness shared with every zero-human league: the draft class was never signed (about 320 rookies a season). With `fix/zero-human-rookie-signing` applied the same harness gives stable talent and NFL-like distributions for all ten seasons. The tables below are correct for what was measured; the explanation and the "roster pipeline" conclusions are not.

**Source.** The long-term franchise agent had no snapshot on `origin` (the only multi-season tool is `ui-source/scripts/franchise_stress_test.ts`, a mock simulator whose win distributions are not engine evidence and were **not used**). I therefore generated the leagues myself with the production machinery: `createLeague` → fantasy draft → `readyUpLocal` / `advanceStage` through every stage (coaching draft, training camp, preseason, regular season, trade deadline, mid-season FA, playoffs, hot seat, retirement, offseason draft, free agency, depth chart, progression) with all 32 GMs CPU-controlled. Every game is the real engine through `simulateBlock`. 8 leagues per setting (seeds 1–8; Realistic 1.0 and Amplified 1.5), 10 seasons each; one regular season per league per index. Roster snapshots at seasons 1, 3, 5, 10 are in the generated files. A full year takes about 25 s. **Reuse:** `mature_league.test.ts.txt` and `mature_leagues.py` are the harness; please point the long-term agent at them rather than re-running separately. Results below are `master` @ `a115b77` and must be re-measured once PD-1 and cap-growth land.

Season 1 is the first played season, after the fantasy draft, coaching draft and training camp (no year-one free agency).

| Season | Margin sd | One-score % | ≥ 21 % | ≥ 28 % | 14+ win teams | Perfect / winless (of 256) | True sd | Best / worst pd | Starter-quality sd |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| NFL | 14.3 | 53.3 | 16.5 | 6.8 | 1.4 | ≈ 0.2% | 5.0 | +11.7 / −11.5 | 1.86 |
| **Realistic 1.0** | | | | | | | | | |
| 1 | 13.7 | 50.1 | 14.5 | 4.6 | 1.25 | 0 / 0 | 4.5 | +10.7 / −12.5 | 0.92 |
| 2 | 14.3 | 49.4 | 16.1 | 5.7 | 1.75 | 0 / 0 | 4.9 | +11.2 / −11.6 | 1.46 |
| 3 | 14.5 | 50.0 | 16.7 | 6.6 | 2.1 | 0 / 1 | 5.2 | +13.1 / −13.8 | 1.79 |
| 5 | 17.3 | 41.5 | 25.1 | 12.2 | 3.0 | 2 / 0 | 7.6 | +18.4 / −17.4 | 4.30 |
| 10 | 20.4 | 34.0 | 34.4 | 18.4 | 4.5 | 4 / 0 | 9.8 | +23.1 / −17.8 | 6.62 |
| **Amplified 1.5** | | | | | | | | | |
| 1 | 14.6 | 48.4 | 16.6 | 5.8 | 1.9 | 0 / 0 | 5.8 | +12.6 / −16.6 | 0.91 |
| 3 | 16.7 | 41.1 | 22.5 | 10.3 | 3.1 | 1 / 2 | 7.6 | +15.2 / −22.5 | 2.03 |
| 5 | 21.0 | 33.6 | 35.2 | 20.9 | 4.5 | 2 / 3 | 10.7 | +22.6 / −22.0 | 4.34 |
| 10 | 25.8 | 29.6 | 42.0 | 30.5 | 4.1 | 0 / 1 | 13.6 | +32.4 / −21.6 | 6.74 |

Points per team-game stay at 22–23 in every season and both settings (points sd climbs from 9.4 to 12.2 at 1.0).

**Reading.**
- **At Realistic 1.0 the engine is on the NFL while roster quality is spread like the NFL's** (seasons 1–3, starter-quality sd 0.9–1.8). That answers the "validate with mature drafted rosters before adjusting global team-strength effects" question: **no global change is indicated.** Season 1 sits slightly tight (margin sd 13.7, 4.5 true sd), consistent with `FOLLOWUP.md`, and relaxes by season 2.
- **Amplified is already above the NFL in season 1 on true sd (5.8) and clearly by season 3** (22.5% blowouts).
- **From season 4 the league polarises regardless of setting.** Starter mean overall falls 78.8 → 65.7 over ten years, starter-quality sd rises to 6.6, QB1 sd to 13.8. That is the roster pipeline (aging, draft-class quality, free agency, development) producing a league with very good and very bad teams; the engine is faithfully converting it into blowouts and 0-17 seasons (Amplified: 56 perfect or winless team-seasons across 10 seasons × 8 leagues).
- **Caveat on the QB tails:** in later seasons the QB spread is also driven by the deflating league, so the QB-envelope calibration should be validated on seasons 1–3 rosters, which is what the table in §1 uses.

## 4. Additional correctness checks (Task C)

### 4a. Second-half opening possession (PBP-1 defect)

`docs/SIM_DEFECT_SECOND_HALF_KICKOFF.md` (on the PBP-1 branch) describes the bug. I reproduced it without touching `sim.ts` and without relying on the trace or PBP-1's event log. **Test: `half_kickoff_regression.test.ts.txt`** (to become `test/engine-half-kickoff.test.ts` once the fix is in).

*Design.* Build a pool-free `Game` in the exact state "the next snap spends the second quarter" (`qtr 2`, quarter and half seconds 1–4, `receivedOpening` set, a chosen spot/down/distance, either team on offence), call the real `scrimmage()`, then inspect the engine state. Four situations × 300 seeds × both openers × both offences: 3rd-and-8 at the 34, 4th-and-3 at midfield (turnover on downs possible), 1st-and-10 at the 25, 2nd-and-goal at the 4 (touchdown possible). Assertions after the snap, only for runs where the quarter did spend (`qtr === 3`):
1. the second-half receiver (`1 − receivedOpening`) has the ball (a kicking-team recovery of a fumbled kickoff return is the only exempt case);
2. it is 1st down at a kickoff spot (yard line ≥ 45), not the previous play's down and spot.

*Result on `master`* (the test fails as designed):

| Situation | Runs | Wrong team | Off a kickoff spot or down |
|---|---:|---:|---:|
| 3rd & 8, opp. 34 | 1,178 | 0 | **1,026 (87%)** |
| 4th & 3 at midfield | 1,074 | 0 | **908 (85%)** |
| 1st & 10, own 25 | 1,186 | 6 (0.5%) | **828 (70%)** |
| 2nd & goal, the 4 | 1,184 | 4 (0.3%) | **774 (65%)** |

This is stricter than PBP-1's trace measurement (381 of 448 mid-play kickoffs disagreed; 12 of 305 comparable games flipped possession), because it forces the situation instead of waiting for it; it does not replace their number as the frequency in play. A trace-based variant (first Q3 snap's team vs `receivedOpening`) over 600 games flags 12% of games, but that over-counts legitimate cases (a fumbled kickoff return) and should not be used as an assertion.

*Suggested fix direction* (not applied): pass `deferRoll` for every play that can end Q2 and roll after the play resolves, as touchdowns and safeties already do. The same mid-play roll exists at Q1→Q2 and Q3→Q4; it only mislabels the quarter on the trace, so it is harmless today but would be fixed by the same change. **Expected effect:** the half-opening drive gets a proper kickoff start (≈ 25-yard-line) instead of the spot of the previous play; points per team-game and the second-half receiver's win rate will move, so §22/§23 and `CALIB_BY_TALENT` need re-measuring after it, and it changes every game's RNG stream from that point (so it must follow the replay-persistence step, §6).

*Conflict handling.* PBP-1 is changing `sim.ts` (+262 lines, event log, `scorePts`). Do not fix until PBP-1 merges; the test file is new and conflicts with nothing.

### 4b. `ai-master.test.ts` and `fitDraftedPayrolls`

**Confirmed.** The test's `drafted()` runs: draft → `openStandingMarketFromUndrafted` → `fillRosterGaps`, and never calls `fitDraftedPayrolls` (which `online/src/phases.ts:631` runs between the first two). Without it `fillRosterGaps` cuts down to the cap and removes the stars. Measured on the test's own league (seed 777), standard vs Master CPUs:

| | Rostered mean overall | Players ≥ 90 on rosters |
|---|---:|---:|
| Test as written | 61.9 / 61.8 | 3 / 4 |
| With `fitDraftedPayrolls` | 73.7 / 73.7 | 55 / 55 |

Master vs Expert, 320 games (SE ≈ 0.8): as written 161–156 (+0.75) at 1.0 and 174–142 (+2.03) at 1.5; with the missing step 167–146 (+1.02) and 157–154 (+0.39). All within noise: **the comparison is made on a league the product never produces, so it validates nothing about roster-strength evaluation either way.** One-line fix in the test; belongs to the CPU agent. `ai_master_flow.test.ts.txt` reproduces both flows.

## 5. Replay persistence design (Task D) — for later approval, nothing implemented

### 5.1 What is authoritative

The engine's output for a game is a **`GameRecord`**, captured at block-simulation time from objects the simulation already has when `trace: true` and `injuries: true` (as every franchise game runs):

| Part | Source | Why |
|---|---|---|
| `schema` (integer) | constant | lets the reader reject or adapt a record shape it does not know |
| `engineRevision` | build-time hash (§5.4) | which engine produced it |
| `home`, `away`, `week`, `phase`, `seed`, `finalScore` | game result | identity and the number to validate against |
| `plays` | `PlayRec[]` (`playTrace`), including the cosmetic attribution (passer, target, tackler, defender) as it was shown | the plays themselves |
| `events` | **PBP-1's `GameEvent[]`** (`ScoreEvent` with `playIndex`, `scoreAfter`, kind, scorer; `PenaltyEvent` with before/after ball state; `ClockPlayEvent` spike/kneel; `OvertimeStartEvent`) | scoring, penalties and overtime that the trace alone cannot express; this is exactly what PBP-1 added |
| `drives` | `drivesLog` | possession boundaries |
| `injuries` | `injuryLog` with `playIndex` | injury interstitials |
| `weather`, `plans` | already on the `GameResult` | context (not needed to display, kept for completeness) |

What is **not** saved: rosters, ratings, depth charts, staffs, talent scale. A replay becomes a pure read of recorded events; it no longer depends on any input that changes after the block (the point of the 4-of-6 and 40-of-48 failures measured in `FOLLOWUP.md`).

Two storage forms are possible and I recommend the second: **(1)** the rendered `GameBroadcast` (≈ 4 KB gzipped, the UI's own contract, already a function of the record); **(2)** the record above, rendered on read by the same pure function that builds the broadcast from a finished game (`broadcast.ts` today calls `simulateGame` inside `broadcastGame`; the render half, `toDrives` + play descriptions, should be exposed as a function of the record). (2) costs about the same size (measured trace 3.9 KB gz + events) and lets a later renderer fix (like PBP-1's scoring-summary corrections) apply to saved games without re-simulating.

### 5.2 How historical scores are validated

At **write**, in the block transaction, before the blob is stored, for every game: `finalScore` equals the game result's score; the scoring events sum to the score per side and the last `scoreAfter` equals the final score; every `playIndex` and `beforePlayIndex` is within `plays`; the concatenation of drive plays equals `plays` (the existing broadcast invariant). A failing game is stored without a blob and flagged, not silently stored wrong.
At **read**: re-check the same cheap invariants plus a SHA-256 stored beside the blob; on any failure fall back (§5.3).
Existing PBP-1 tests (`pbp-scoring-events`, `pbp-box-score-consistency`) already assert the first three invariants over simulated games and can be reused as the write-time validator.

### 5.3 How older games without event data are displayed

Three tiers, decided per game, never mixed silently:
1. **Stored record present and valid** → render it. Authoritative.
2. **No record, game's `engineRevision` equals the running revision, and the rebuilt final score and drive count equal the saved result** → show the regenerated replay, labelled "reconstructed". Cheap to test (a re-simulation) and only ever shows a game that provably reproduces its saved score. Covers every game from before persistence exists, until the engine next changes.
3. **Anything else** (revision differs, rebuilt score differs, record failed validation) → box score and scoring summary only, with "Play-by-play was not saved for this game." Never show a different game under the saved score.

Tier 2 is the safety net step recommended in `FOLLOWUP.md` and can ship alone, before persistence.

### 5.4 Relation to engine revision identifiers

`engineRevision` = a short content hash computed at build time over `src/engine/**` (excluding tests), `artifacts/models/portable/**` and `artifacts/ratings/**`; not the git commit, which changes on UI-only deploys and would flag every game stale. It is written in two places: on every `GameResult` (a few bytes, in the league document) and on the stored record. Uses: (a) tier 2 above; (b) after a known engine defect is fixed (e.g. the halftime kickoff), a query for "games simulated by a revision older than the fix" says which saved games contain the old behaviour; (c) change control: the post-calibration check `engine-revision.test` asserts the hash changes when `sim.ts` or an artifact changes, so a calibration cannot ship without a new revision.
The revision is informational for stored records (they replay regardless of it) and decisive only for regenerated ones.

### 5.5 Storage inside the existing save transaction

Today: `withLeague` (online/src/db.ts) opens a transaction, locks the `league_state` row (`FOR UPDATE`), runs the action, plays any queued block jobs off-thread (`runBlockJobs`) **before** writing, serialises the whole league and does a version-checked `UPDATE`, then inserts `events` rows, all in one `COMMIT`.
Proposal, same shape as `takeNotes` and `events`:
- The block worker returns, next to the updated state, the encoded records (gzip in the worker, so nothing large crosses the thread boundary uncompressed): `takeGameRecords(state)` after `runBlockJobs`.
- After the successful `UPDATE … WHERE version = $n`, `withLeague` inserts them in the same transaction. A version conflict or rollback discards them with the state; a retried block is idempotent because `simulateBlock` skips game ids already played and the table key is `(league_id, season, game_id)` with `ON CONFLICT DO NOTHING`.
- Never in the league document (it travels whole on every request).
- Proposed table (**needs your approval; not created**): `game_events(league_id, season, game_id, schema smallint, engine_rev text, final_home smallint, final_away smallint, sha256 bytea, body bytea, created_at)`, primary key `(league_id, season, game_id)`, `ON DELETE CASCADE` from `leagues`. Rows for a season are deleted when the season rolls over (`rollOverSeason` already clears `state.games`), so the table is bounded: ≈ 1.2 MB gzipped per league-season for every game, ≈ 0.4 MB if limited to games a human played.
- Read path: `GET /leagues/:id/game/:gameId` keeps its visibility check (`visibleGames`) and reads the row; falls back through §5.3.
- Single-player: the local flow already stores `GameResult.broadcast` for the viewer's game; the same record replaces it, written alongside the result in the local save. No server table.
- Multiplayer-reliability interaction: the writes ride the per-league writer queue and the expected-stage guards that MP-2 adds in `online/src/db.ts` and `phases.ts`; nothing here opens a second transaction or a second lock.

### 5.6 Coordination needed with PBP-1

1. Their event log and `GameBroadcast` shape are optional-field additions; the record's `schema` integer should be bumped only for incompatible changes.
2. Ask them to expose the render step as a pure function of the record (today `broadcastGame` simulates).
3. `PlayRec` additions (they are logging-only) flow into the record automatically.
4. I could not message them (no reachable agent sessions; coordination by this document). **Please relay §5.1 and §5.6.**

## 6. File conflicts and sequencing

| Work | Files | Overlap with active branches |
|---|---|---|
| Halftime regression test | new test file only | none |
| Halftime fix | `src/engine/sim.ts` (`advanceClock`, `scrimmage`, `rollQuarter`) | **PBP-1** (+262 lines in `sim.ts`, `broadcast.ts`, `server/boxscore-map.ts`): hold until it merges |
| QB multipliers, arm term, calibration refit | `src/engine/{ratings,team-strength,synergy,sim}.ts`, `analysis/40_channel_calibration.ts`, `test/engine-{realism,talent,synergy}.test.ts`, `ui-source/src/state/howItWorks.ts` | `sim.ts` again with PBP-1; `howItWorks.ts` with PD-1 (it edits it); CPU agent's `unitValue.ts` / `analysis/38` depend on QB value (2.5 vs 3.2 per sd) |
| Replay: verify, stamp, persist | `online/src/{blocks,db,index}.ts`, `online/schema.sql` + migration, `ui-source/src/domain/game.ts`, `src/engine/broadcast.ts` | `db.ts` / `phases.ts` with **MP-2**; `broadcast.ts` with **PBP-1** |
| `ai-master.test.ts` fix | that file | CPU agent |
| Mature-league re-measurement | harness only | needs PD-1 and cap-growth merged |

**Recommended order:**
1. Replay safety net: tier-2/3 verification and fallback, plus `engineRevision` stamp (small; no schema). Land before any change to engine behaviour.
2. PBP-1 merges; add the halftime regression test as a known-failing test.
3. Replay persistence (needs your schema approval), after MP-2 lands and PBP-1 exposes the pure render function.
4. QB calibration on a branch: multipliers, arm term, then the `CALIB_BY_TALENT` refit with `analysis/40`; validate at the league level on seasons 1–3 rosters of mature leagues at 1.0 and 1.5.
5. Halftime fix; re-run §22/§23 and the refit once, together with step 4's constants, to avoid two recalibrations.
6. Re-run the mature-league harness once PD-1 and cap-growth are in; only then decide whether anything beyond roster dynamics is needed for seasons 4–10.
7. Flip the new-league default to Realistic 1.0 (setup UI) last, new leagues only.

**Targets and tests for step 4:** starter completion sd 3.0–3.9 and interception sd 0.6–0.85 over ≥ 300 traced starter-seasons at 1.0; maximum interceptions per 17 games ≤ 22; QB margin value 2.2–3.0 points per sd at 1.0 (and ≤ 4.0 at 1.5); league completion 64.7–67.5%, interception 2.0–2.4%, points 22.6 ± 0.5 on both fixed and mature rosters; pool-free path byte-identical (`engine-parity`, `engine-talent`). **For the mature-league gate:** margin sd 14.3 ± 0.8, one-score 53 ± 3%, ≥ 21 points 16.5 ± 3%, 14+ win teams 1.4 ± 0.6 per season, perfect or winless < 0.5% of team-seasons, true sd 5.0 ± 0.7, in seasons 1–10 of CPU-only leagues.

**Stop point.** Nothing above is implemented; awaiting approval for each step, and for the `game_events` table.
