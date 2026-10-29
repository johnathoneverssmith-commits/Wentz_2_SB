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
