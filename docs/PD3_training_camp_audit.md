# PD-3: training-camp strategy audit (read-only; nothing implemented)

Run on the PD-2 code. Harness: whole league (3 seeds), neutral head coach and position coaches (72), five camps with each plan, rosters aged and retired between camps with **no refill**, score = team strength in points of margin (`unitValue.ts` weights) against the same league with no focus. In this model gains fade after year 5 as the cohort retires, so read years 1–5; the 90+ count is the exception noted below. One run per plan per seed set: directional, not exact.

## 1. Are the choices meaningful, and does one dominate?
Team gain vs no focus, coordinator 72 / 95 (years 1, 3, 5):
| Plan | 72 | 95 |
|---|---|---|
| DB only | 0.23 / 0.71 / 0.75 | 0.48 / 1.41 / 1.82 |
| OL only | 0.17 / 0.50 / 0.73 | 0.44 / 1.11 / 1.55 |
| DL only | 0.11 / 0.33 / 0.62 | 0.28 / 0.88 / 1.36 |
| WR only | 0.12 / 0.31 / 0.51 | 0.27 / 0.69 / 1.09 |
| QB only | 0.12 / 0.27 / 0.49 | 0.27 / 0.61 / 0.95 |
| LB only | 0.06 / 0.16 / 0.24 | 0.14 / 0.42 / 0.55 |
| RB only | 0.06 / 0.17 / 0.09 | 0.11 / 0.30 / 0.40 |
| **OL + DB every year** | 0.40 / 1.19 / 1.36 | **0.93 / 2.45 / 3.52** |
| QB + DL | 0.24 / 0.61 / 1.04 | 0.61 / 1.53 / 2.38 |
| RB + LB | 0.11 / 0.33 / 0.46 | 0.26 / 0.71 / 1.20 |
| CPU rule (weakest group) | 0.20 / 0.59 / 0.81 | 0.52 / 1.38 / 1.93 |
- **Yes there is a dominant plan:** OL on offence and DB on defence, every year. It beats the CPU's rule by ~1.6 points of margin at year 5 with an elite coordinator, and beats the worst plan (RB+LB) roughly threefold. Focus value follows the unit weights in `unitValue.ts`, so RB and LB are almost never the right call and the choice is mostly not a choice.
- A team's own weakness matters little: the per-team best focus beat the best single fixed focus by only ~0.1–0.2 per camp (PD-1 measurement).

## 2. Coaching interactions
Coordinator rating sets the strength (floored 5%, capped 45%), position coaches scale the same player, the head coach adds a program (PD-1), and the three multiply. With 95s across the board, OL+DB every year leaves the team +2.9 above where it started at year 5, while a neutral staff with no focus is 4.5 below its start: an elite staff plus the right focus roughly **offsets the whole cohort's aging for five years**. The coordinator is now the largest single coaching lever (+3.5 at 95) and sits outside PD-1's calibration.

## 3. Compounding across seasons
- Gains accumulate year over year (the OL+DB line roughly triples from year 1 to 5 at 95) because a rating gained is kept and the next year's growth builds on it. No diminishing returns for repeating the same focus.
- Player-level retention: in the no-refill cohort after 10 camps, the league holds **60.7 players rated 90+ with an elite staff and OL+DB** against **22.0 with a neutral staff and no focus** (33.3 elite staff alone, 29.0 focus alone). This depends on the cohort not being refilled, so the absolute numbers overstate a live league; the direction (stars last far longer under elite staff + focus) is the finding.

## 4. Exploits
- **Repetitive optimal selection** (always OL+DB) is the exploit; a human finds it in two seasons and the screen gives no reason to do anything else.
- Neither the 99 rating cap nor the sign rule (a focus never turns a decline into growth) is violated; no unbounded ratings.
- The CPU rule is weak (weakest group by best-player deficit, not unit value), so the human advantage of knowing the unit weights is large.

## 5. Prioritised recommendations (all need approval and a test plan)
1. **Give repeated focus a cost or a decay** (e.g. the same focus two years running is worth 75% then 50%, or a fatigue on the group), so rotation and weakness-targeting win over a fixed OL+DB. Smallest change; testable by re-running the table above.
2. **Make the CPU rule value-weighted** (deficit × unit weight) so CPU teams stop leaving 1–2 points on the table; this is CPU behaviour, not human balance.
3. **Cap the coordinator's focus strength** (45% → ~30%) or scale it by the unit's weight, if the full-elite stack (+2.9 at year 5 ≈ offsetting aging) is judged too strong. PD-1 deliberately left this alone.
4. Surface the unit weights or "what this focus is worth" in the camp screen so the choice is informed; that is a UI change.
Do not change the focus constants without re-measuring the table: the pinned tests in `trainingCamp.test.ts` and `online/test/training-camp.test.ts` encode 20% / 5% / 45%.

---

# PD-3 implementation (approved design) and results

## What was built
- **Repeat history inside the camp state, no table or migration.** `TrainingCampState.prior` (by team) is copied from last season's camp at the moment the new camp opens (`beginTrainingCamp`, which used to be preceded by `s.trainingCamp = null`), only if that camp was the immediately preceding season. Each plan records `offensiveStreak` / `defensiveStreak` when it runs. Streak = 0 for a first choice, a switch, a skipped season or an old save; otherwise the previous streak + 1. Sides are independent. It is keyed by team, so it survives a change of GM, a reload and an online reconnection. A retry of the same plan gives the same camp because the streak is read from last season's record, not from the plan being rerun.
- **Strength × 0.8 per consecutive repeat** (`REPEAT_DECAY`). Coordinator multipliers (20%, 5% floor, 45% cap) are unchanged.
- **Online view:** `redactTrainingCamp` (`online/src/campView.ts`) shows a GM only their own team's plan, results and `prior`; commissioners and unseated viewers get none. The only place the camp leaves the server is that view.
- **CPU rule:** a group is worth `Σ over its starters (unit weight / slots in unit × |expected movement this year|)`, with expected movement by the player's own career shape (PD-2); scaled 0-10 against the best group on that side, cut by 0.8^streak, then the existing difficulty noise, strategy bonus and high-floor multiplier are applied as before. The old "expert developing-share" nudge is gone (the value already contains development). A group with nobody to develop is worth zero, so the old test that forced an RB focus onto a team with no running backs was replaced.
- "How it works" text updated.

## Results on the real implementation
Same harness and seeds as the audit above (3 leagues, 6 consecutive camps, no refill). Gain vs no focus in team strength (points of margin) at camp 6; "before" is the audit's no-decay run on master.
| Strategy | Before 72 / 95 | After 72 / 95 |
|---|---|---|
| Fixed OL+DB | 1.68 / 3.84 | 1.27 / 2.53 |
| Fixed QB+DL | 1.43 / 2.99 | 0.89 / 2.02 |
| Fixed WR+DB | 1.40 / 3.33 | 0.82 / 2.00 |
| Fixed RB+LB | 0.57 / 1.15 | 0.28 / 0.53 |
| Rotating (OL,QB,WR,RB / DB,DL,LB) | 1.23 / 2.85 | 1.23 / 2.85 |
| Old CPU rule | 0.88 / 2.02 | 0.66 / 1.61 |
| **New CPU rule** | n/a | **1.42 / 2.82** |
| Informed best per team, each year | 2.05 / 4.38 | 1.83 / 4.03 |
| Rated 90+ after 6 camps (fixed OL+DB, coordinator 95) | 84.7 | 78.7 |
- No strategy is best for every roster: the best fixed plan is OL+DB for 44-51% of teams, QB+DL 28-30%, WR+DB 15-21%, RB+LB 4-7%, and the informed per-team choice beats every fixed plan by 0.6-1.5.
- Repeating stays useful (OL+DB 2.53 at a 95 coordinator against 0.53 for the worst plan) but no longer wins: it trails rotating (2.85) with an elite coordinator and ties it (1.27 vs 1.23) with an average one.
- The new CPU rule roughly doubles the old rule's gain (1.42 vs 0.66; 2.82 vs 1.61) and reaches 70-78% of the informed best without exceeding it, and it is level with rotating rather than a new dominant plan.
- Elite coordinators: the 95/72 ratio of gains is 2.0 (OL+DB) and 2.2 (informed), essentially the strength ratio 0.43/0.20 = 2.15, so there is no disproportionate amplification and no reason to change the multipliers.
- Rating inflation: elite 90+ counts fall with the decay (84.7 → 78.7 for the strongest repeater), nothing rises, and the PD-2 aging code is untouched.

## Limitations
- The harness has no roster refill, so absolute gains fade after year 5; read the comparisons, not the levels. Single run per plan per seed set.
- The human camp screen does not yet say what repeating costs (only the how-it-works text does); showing the streak is a UI follow-up.
- Coordinators' 45% cap, the unit weights' own uncertainty, and the CPU's difficulty noise (casual teams read value with ±4 of 10) are unchanged.
