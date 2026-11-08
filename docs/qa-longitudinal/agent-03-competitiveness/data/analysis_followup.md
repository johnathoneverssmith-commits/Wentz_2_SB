# Follow-up results (95% CI = 1.96 SE)

## Single-starter +10 (640 pairs each, talent 1.0)

| starter | margin [CI] | win% pts [CI] |
|---|---|---|
| QB slot 0 | +3.91 [+2.76,+5.05] | +10.08 [+5.57,+14.59] |
| S slot 0 | +1.91 [+0.80,+3.02] | +5.39 [+0.90,+9.88] |
| CB slot 0 | +1.69 [+0.57,+2.80] | +5.16 [+0.81,+9.51] |
| WR slot 0 | +1.64 [+0.44,+2.84] | +5.55 [+1.06,+10.04] |
| EDGE slot 0 | +1.40 [+0.28,+2.53] | +4.38 [-0.03,+8.79] |
| EDGE slot 1 | +1.29 [+0.14,+2.44] | +5.39 [+1.00,+9.78] |
| TE slot 0 | +1.04 [+0.07,+2.02] | +0.63 [-3.19,+4.45] |
| ILB slot 0 | +1.04 [-0.11,+2.19] | +4.53 [-0.04,+9.10] |
| DT slot 0 | +0.98 [-0.14,+2.11] | +5.78 [+1.15,+10.41] |
| WR slot 2 | +0.95 [+0.10,+1.81] | +3.83 [+0.48,+7.18] |
| RB slot 0 | +0.91 [-0.30,+2.13] | +1.09 [-3.77,+5.95] |
| C slot 0 | +0.80 [-0.27,+1.86] | +2.27 [-1.85,+6.39] |
| CB slot 2 | +0.71 [-0.22,+1.64] | +1.33 [-2.49,+5.15] |
| OG slot 0 | +0.59 [-0.51,+1.69] | +0.23 [-3.94,+4.40] |
| OT slot 0 | +0.20 [-0.89,+1.30] | -0.70 [-4.91,+3.51] |

## Equal-payroll QB test (640 pairs): QB rating change financed evenly by the other 22 slots at the game's FA price curve

| talent | QB change | others (mean) | margin [CI] | win% pts [CI] |
|---|---|---|---|---|
| 1 | +9.3 | -1.59 | +1.15 [+0.01,+2.29] | +4.38 [-0.03,+8.79] |
| 1 | +4.9 | -0.86 | +0.65 [-0.45,+1.76] | +3.13 [-1.06,+7.32] |
| 1 | -5.0 | +0.72 | -0.82 [-1.99,+0.34] | +0.00 [-4.45,+4.45] |
| 1 | -10.0 | +1.33 | -1.84 [-3.08,-0.60] | -3.13 [-7.74,+1.48] |
| 1.5 | +9.3 | -1.59 | +2.15 [+0.91,+3.38] | +6.41 [+1.94,+10.88] |
| 1.5 | -10.0 | +1.33 | -1.17 [-2.46,+0.12] | -1.80 [-6.23,+2.63] |

## Sign-and-flip (real judgeWith + checkTrade; 4 seeds x ranks {0,4} x contract years {1,4} = 16 cases/position per room setting)

room=true: each CPU team first released its worst player (a free roster slot). Pick value = sum of the game's own chart values of the picks the best-paying CPU team would give.

| pos | cases sold/16 | mean salary $M | mean picks received / player chart value | mean CPU teams willing | mean best pick value |
|---|---|---|---|---|---|
| QB | 0/16 | 52.8 | nan | 0.0 | 0.0 |
| RB | 4/16 | 25.2 | 0.75 | 4.0 | 32.6 |
| WR | 6/16 | 19.5 | 0.86 | 8.0 | 79.5 |
| TE | 16/16 | 11.0 | 0.87 | 28.6 | 54.1 |
| OT | 6/16 | 20.6 | 0.86 | 10.5 | 69.3 |
| OG | 6/16 | 20.1 | 0.85 | 11.6 | 52.1 |
| C | 14/16 | 13.7 | 0.88 | 23.4 | 60.0 |
| EDGE | 0/16 | 31.5 | nan | 0.0 | 0.0 |
| DT | 10/16 | 17.3 | 0.88 | 18.2 | 80.6 |
| ILB | 12/16 | 17.5 | 0.81 | 12.6 | 51.5 |
| CB | 2/16 | 27.0 | 0.82 | 3.9 | 39.2 |
| S | 10/16 | 18.1 | 0.85 | 12.0 | 52.6 |
| K | 16/16 | 9.2 | 1.14 | 31.0 | 30.7 |
| P | 16/16 | 3.5 | 1.80 | 31.0 | 23.0 |

room=false (rosters full at 53): sold in 94/224 cases; the 53-man limit blocks nearly every CPU team.

## CPU management-skill split (real engine; GM skill +2.5 vs -2.5 on alternating teams, 6 leagues x 5 seasons)

Mean (high - low skill) wins/team/season by league: -1.14, -0.54, -0.34, -0.47, +0.50, -1.32; overall -0.55 (SE across leagues 0.26). Titles high/low: 9/21 of 30 seasons.

