# PD-1: coaching balance and retirement determinism

Branch `claude/modest-volta-kkmmx3`. Not merged, not deployed, no PR. Supersedes nothing in `AUDIT_player_development_coaching.md`; builds on it.
All "margin" figures are points of scoring margin per game, from `unitValue.ts` weights (the same units the CPU's Master evaluator uses). League talent sd on that scale is about 6.5 (3 leagues, staffs all neutral).

## Task 1 — retirement order (done, isolated)
**Root cause.** `retirementOutcomes` used one `Rng(seed ^ 0x5555)` consumed in list order, and only for *eligible* players. A player's fate therefore depended on his position in the array and on how many eligible players sat ahead of him. Measured on a fresh league: reversing the array flipped **72 of 284** eligible decisions.
**Fix.** Each player gets his own draw, `retirementDraw(season, id)`: a hash of the season and his id, one uniform per player, compared with the same `retirementChance` probability. Probabilities, eligibility and reasons are untouched.
**Tests.** `ui-source/src/sim/retirement.test.ts` (reordered arrays, subset membership, JSON save/reload, variation across seasons) and `online/test/retirement-order.test.ts` (the shared `commitRetirements` the store and `online/src/phases.ts` both call, with the players map reversed, round-tripped through JSON, and in another season). Negative control: with the fix stashed, the order tests fail and the round-trip test passes, as expected.
**Compatibility.** Nothing stores a retirement decision except `p.retired`, so existing saves and past seasons are untouched. A save sitting *inside* a retirement review gets a different (equally valid) set when the review is next computed, because preview and commit recompute from the same function. `contractValue.test.ts` (which Monte-Carlos retirement over seeds) is unchanged and green. Not done, needs a decision: the seed is `s.season` alone, so two leagues in the same season share draws for the same player ids (the shipped pool has identical ids in every league). Adding the league seed means changing the caller in `screens/RetirementReview.tsx`, a UI file, so I left it.

## Task 2 — coaching calibration

### Pathways (what each role touches)
| Role | Games | Development | Injuries/recovery | Roster strength over seasons |
|---|---|---|---|---|
| HC | engine: penalty rate ±8%·norm, 4th-down logit | **none before PD-1** | none | none before; now a program multiplier on every group |
| OC / DC | engine: completion, rush, sack logits, scheme fit | camp focus strength (`focusStrength`) | none | via focus |
| 8 position coaches | none | ×(1±slope·points) on their group | none | compounding |
| MED | none | none | recovery duration only | none |

### Why the head coach was near zero
1. **No development pathway at all.** Only position coaches fed `coachModifiersFor`.
2. **Compressed in-game range.** The franchise maps UI 55–95 onto engine 44–66, so `ratingNorm` only reaches −0.15…+0.40 of the engine's ±1 coefficient range, and the HC's coefficients are small to begin with (penalty swing 0.08, go-for-it 0.08/0.38). Measured in 1,500 paired games per side: elite vs poor HC **+0.02** margin (OC +0.69, DC +0.72). I did **not** change this; it lives in `src/engine/staff-shift.ts`, which is the game-realism agent's.
3. **Integer rounding hid small effects.** Camp multiplied an integer delta by a multiplier and rounded (`applyCoachToDelta`), then forced a minimum of ±1. A 7% edge on a +2 became nothing; a 30% one a flat +1. That is why the old position-coach effect came in steps, and why any small HC term would have vanished.

### Why position coaches dominated
Eight uncapped linear terms of 1.5%/point (±34–48% at 95/40), compounding over a roster, with no limit, at identical (and rating-independent) cost. Old measurements (shipped code): all eight at 95 vs 72 **+4.46**, at 40 **−4.82** by year 5; elite-vs-average single roles +0.4…+1.0.

### What changed (franchise layer only; no engine file touched)
- `coachEffects.ts`: position-coach curve is **1.2%/point within 12 points of neutral, 0.4%/point beyond** (a 95 coach is +19.2% instead of +34.5%); the **head coach adds a 0.6%/point program** to every group; combined multipliers are limited to **regression ≥ 0.55, development ≤ 1.4**. Constants live in `COACH_TUNING`.
- `applyCoachToDelta(delta, mods, roll?)` plus `roundBy`: with a seeded roll the result is **unbiased** (expected value = delta × multiplier; whole numbers never move; sign never flips). Camp, the coordinator focus step and the rollover path pass the player's own seeded draw, so retries and replays are identical. Without a roll the old rule is unchanged (existing tests untouched).
- `staffRatings.ts`: `ST 0.7→0.3`, `MED 1.0→0.6`, `RB/LB 0.9→0.7` to match what the jobs measure. HC/OC/DC weights unchanged (pinned by tests).
- `howItWorks.ts` text now reads the constants.

### Measured effect (team unit score, margin pts vs an all-72 staff; 3 leagues × paired draws; year 5)
| Scenario | Shipped before | After |
|---|---|---|
| HC 86 (best in market) | 0.00 | **+1.28** |
| HC 61 (worst) | 0.00 | **−1.09** |
| DB coach 95 | +1.01 | +0.67 |
| OL coach 95 | +0.83 | +0.60 |
| LB coach 95 | +0.36 | +0.33 |
| All 8 position coaches 95 | +4.46 | **+3.08** |
| All 8 position coaches 40 | −4.82 | −3.63 |
| Coordinators 95 + focus OL/DB (unchanged mechanic) | +1.86 | +2.81* |
| Full elite staff + focus | +6.1 | +7.4* |
| Full poor staff | −4.8 | −4.4 |
| Natural market staffs, sd across teams | not measured | 1.43 (talent sd 6.5; best/worst team +3.2/−5.1) |
| Negative control (all neutral, vs unmodified) | 0.00 | 0.00 |
\* Rises because the old rounding was also eating part of the focus effect; the focus constants are unchanged. Compare against the "linear 1.5% with unbiased rounding" row I measured, which would have been +5.5 / −7.8 for the eight coaches — the soft cap removes about 45% of that.

**Hierarchy now:** HC (~1.2) > one position coach (0.3–0.7), all eight (3.1) < roster talent, with HC-only and positions-only staffs both viable (+1.3 vs +1.9) and a coordinator-plus-focus route on top.

### Decision needed before a PR
- The focus mechanic (coordinators, up to 45%) is now the single largest coaching lever (+2.8) and sits outside this task's constants. Leaving it makes a full elite staff ≈ 1.1 talent sd. Options: cap `FOCUS_MAX` (pinned by two tests) or leave.
- HC in-game effect stays ~0. Making it matter in games needs `staff-shift.ts` coefficients or the band map changed: **for the game-realism agent**. The development pathway above is the independent route.
- Stochastic rounding changes every non-neutral camp outcome (neutral staffs are byte-identical). Old saves only differ at their next camp.

## Task 3 — coaching economics
- **Finding:** salaries bind nothing today. There is no staff budget or cap charge; a coach's price is his draft slot, and the CPU picks the highest rating regardless of role. So pay is cosmetic unless a budget is added (not done: changes the coaching draft structure).
- **Fix kept small:** `priorities.ts` now prices position and medical coaches by `overall` (they were all priced as a 70) with a per-role scale (QB/OL/DL/DB 0.5, WR 0.45, LB/RB/MED 0.35, ST 0.2). Market correlation of rating and asking price went from about 0.0 to 0.86–0.95; a top-5 OL coach asks about $5.3M, a top HC about $18M, ST about $1.7M.
- Open: a coaching budget would make hiring a real trade-off. Needs approval.

## Verification
See the report in the session for suite results. Harness: `scratchpad/audit_data/pd1.ts` (clone the league once per seed, run camps for five seasons, rosters aged and retired between).
