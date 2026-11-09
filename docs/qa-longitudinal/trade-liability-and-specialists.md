# Contract dumping (STRAT-002) and specialist need (COMP-002b / STRAT-010)

Measured on `e44f18d` (includes #109, #110) with the real `judgeWith`/`checkTrade`/deadline path. Six real trade-deadline states
(seeds 9501, 9502, seasons 1-3, played through the store) plus seeded leagues 12-17. Old = master, new = this change.

## What was reproduced
- **Dump: confirmed, but later-season only.** Age-32, 70 OVR on $20M x 3 (release penalty $13.2M), asked for nothing: season 1 0 of 372 offers accepted (no team has the room), **season 2 135/372 offers (135/306 with cap room)**, season 3 21/372 (21/54 with room); pooled 156/360 = 43% of cap-room offers (table below). The reported "32 of 32"
  is not reproduced on current master. Cause: the chart adds the player's full performance price (+19) to a contract term floored at
  0.8 x release penalty (-10.6), so he is worth +8 to a team taking him. At the deadline no cap/roster check applies at all, so only valuation gates it.
- **K/P: mean is already under chart; the best buyer is the exploit.** Shopped to 31 teams (36 cases each): mean over all teams K 0.68x, P 0.74x,
  all 31 buy; **best offer K 1.16x (max 1.83x), P 1.54x (max 2.29x)**, from the 1-2 teams with a hole (`needAt` was position-blind and uncapped).
- **STRAT-010 stacking: not reproduced.** Three 56-64 players at one position: best offer 1.02-1.20x chart, one player 0.99-1.15x. No stacking fix made.

## Change (`tradeModel.ts` only, plus the How It Works text)
1. A CPU team **taking a player on** reads his contract unclamped (shortfall x `RECEIVED_SHORTFALL_COST` 1.25) and takes the better of keeping him and cutting him (-0.8 x penalty). The shedding side is unchanged (`LIABILITY_RELIEF`).
2. A need adds at most `NEED_PREMIUM_SHARE` (25%) of the player's worth to the taking team (the chart price, or its own reading of a bad contract), both gained and lost. A player the taking team reads as a liability fills no hole.

## Before / after
Cohort for the dump rows: 2 seeds (9501, 9502) x 3 seasons x 6 positions (EDGE, CB, OT, WR, ILB, S) = 36 planted players, each offered to the 31 other teams,
so 1,116 offers (372 per season). "Cap room" = the team could absorb the first-year hit. The deadline path ignores cap and roster.

**Reconciliation of the 20x3 free ask (age 32, 70 OVR, penalty $13.2M).** The earlier table gave 36% / 6% by season over a 372-offer denominator while the numerator counted only cap-room acceptances; the correct pairs are below. Old pooled `156/360` = 135 + 21 (cap-room accepts) over 306 + 54 (cap-room offers; season 1 has none).

| Season | All offers, old | All offers, new | Cap-room offers, old | Cap-room offers, new | Real deadline path (first 8 teams per player = 48 asks x 2 seeds = 96), old | new |
|---|---|---|---|---|---|---|
| 1 | 0/372 | 0/372 | 0/0 | 0/0 | 0/96 | 0/96 |
| 2 | 135/372 (36%) | 4/372 (1%) | 135/306 (44%) | 4/306 (1%) | 38/96 (40%) | 0/96 |
| 3 | 21/372 (6%) | 0/372 | 21/54 (39%) | 0/54 | 7/96 (7%) | 0/96 |
| pooled | 156/1116 (14%) | 4/1116 (0.4%) | 156/360 (43%) | 4/360 (1%) | 45/288 (16%) | 0/288 |

Every old acceptance had cap room, so all-offers and cap-room numerators agree. The "deadline path" columns drive `runCpuTurns` (no cap check, so all teams are eligible); an earlier table mislabelled the all-offers valuation count as the deadline path.

**Other cohorts (labelled).** Rows marked *(EDGE only)* use one planted EDGE per state: 6 states x up to 31 teams, cap-room teams only, so n=60 per difficulty level (the five levels are re-runs of the same cohort; the window rows pool them, n=300).

| Case | n | Old | New |
|---|---|---|---|
| 30x4 free, cap-room | 192 | 1% | 0% |
| 20x3 + 7th / 5th / 3rd / 2nd, cap-room | 360 | 43% / 54% / 99% / 100% | 2% / 2% / 17% / 96% |
| 30x4 + 2nd, cap-room | 192 | 100% | 29% |
| 12x2 (penalty $5.3M) free / + 2nd, cap-room | 888 | 81% / 100% | 36% / 100% |
| 20x3 free by difficulty casual..master *(EDGE only)* | 60 each | 57-63% | 0-12% |
| 20x3 free by window contending / middle / rebuilding *(EDGE only, pooled over difficulties)* | 80 / 75 / 145 | 56 / 67 / 58% | 1 / 3 / 13% |
| K best offer / chart (mean); above 1.25x | 12 | 1.19x; 25% | 0.98x; 0% |
| P best offer / chart (mean); above 1.25x | 12 | 1.68x; 75% | 1.04x; 8% (1 of 12) |
| K / P mean over all teams / chart | 12 | 0.71 / 0.72 | 0.70 / 0.69 |
| K / P teams that buy (of 31) | 12 | 31.0 / 30.8 | 31.0 / 30.8 |

## Does a need bonus rescue a liability?
It did, in the original model: the bonus read the chart (+8 for the dumped player), not what the taking team thought of him. Same 20x3 contract, seasons 2-3,
cap-room teams (n=360), the position either emptied (hole) or topped up to an 82 starter (filled):

| | free | + 7th | + 5th |
|---|---|---|---|
| hole, original | 359/360 (99.7%) | 360/360 | 360/360 |
| filled, original | 152/360 (42.2%) | 152/360 | 189/360 (52.5%) |
| hole, first version of this PR | 8/360 (2.2%) | 8/360 | 15/360 (4.2%) |
| filled, first version | 4/360 (1.1%) | 6/360 | 8/360 |
| hole, final | 4/360 (1.1%) | 6/360 (1.7%) | 8/360 (2.2%) |
| filled, final | 4/360 (1.1%) | 6/360 (1.7%) | 8/360 (2.2%) |

The residual gap in the first version came from the bonus being bounded by the chart price. The final version bounds a need by what the taking team makes of the player (`worth`), so a hole and a filled position now give identical answers for a liability.

## Controls (unchanged or near)
- Productive vets taken free by all cap-room teams, old and new: 78/30 $20M x3 (180/180), 85/29 $25M x3 (126/126), 75/27 $10M x3 (447/447), 72/31 $8M x2 (477/477). They pay less in picks when overpaid: 78/30 $20M x3 75% -> 44% of chart; others -1 to -7 points.
- Buying a 72-86 starter with picks at 1.15x price: 371/372 accepted, old and new.
- CPU shedding its worst contract (penalty >= 5) plus its R1/R2/R3 for nothing: 0/186 each, old and new (no pick-and-cut).
- Existing trade, AI-offer, strategy and difficulty suites pass; full UI run 1116 passed, 3 failed in `durableSave.test.ts` (storage quota, unrelated to trades).

## Regression tests
`ui-source/src/state/tradeLiability.test.ts` (11 tests). Against the original `tradeModel.ts` 7 fail: free dump 99% accepted vs <=20%, token and $30M x4, all five difficulties, the real deadline path (100% accepted), K best offer 1.41x, no-kicker team P 1.44x. The compensated-dump, vet, starter and pick-and-cut controls pass on both.

## Remaining risks / related
- Rebuilding teams still take 13% of free 20x3 dumps; compensated R2 deals are deliberately kept (96%).
- Mildly overpaid contracts (penalty < $10M) are also priced harder (81% -> 36% free); a R2 still sells 100%.
- Not shown through the UI; the deadline path was driven via `runCpuTurns`.
- **#37**: the human auto-trim cuts without penalty, so a human can still shed a bad contract free outside trading. **#38**: a CPU team that absorbs a player and trims him in the same window pays dead money, so it is a CPU-side cost, not a loophole. Neither touched here.
- `tradeAssetValue`'s contract clamp lives in `MockSimulationService.ts` (out of scope); the receiver-side reading is applied in `tradeModel.ts` instead.
