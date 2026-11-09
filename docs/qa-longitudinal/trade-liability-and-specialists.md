# Contract dumping (STRAT-002) and specialist need (COMP-002b / STRAT-010)

Measured on `e44f18d` (includes #109, #110) with the real `judgeWith`/`checkTrade`/deadline path. Six real trade-deadline states
(seeds 9501, 9502, seasons 1-3, played through the store) plus seeded leagues 12-17. Old = master, new = this change.

## What was reproduced
- **Dump: confirmed, but later-season only.** Age-32, 70 OVR on $20M x 3 (release penalty $13.2M), asked for nothing: year 1 0/372 teams with room
  (fresh caps leave no room; the legal-roster check also blocks most), **year 2 36%**, year 3 6%, pooled 43% of cap-room teams (156/360). The reported "32 of 32"
  is not reproduced on current master. Cause: the chart adds the player's full performance price (+19) to a contract term floored at
  0.8 x release penalty (-10.6), so he is worth +8 to a team taking him. At the deadline no cap/roster check applies at all, so only valuation gates it.
- **K/P: mean is already under chart; the best buyer is the exploit.** Shopped to 31 teams (36 cases each): mean over all teams K 0.68x, P 0.74x,
  all 31 buy; **best offer K 1.16x (max 1.83x), P 1.54x (max 2.29x)**, from the 1-2 teams with a hole (`needAt` was position-blind and uncapped).
- **STRAT-010 stacking: not reproduced.** Three 56-64 players at one position: best offer 1.02-1.20x chart, one player 0.99-1.15x. No stacking fix made.

## Change (`tradeModel.ts` only, plus the How It Works text)
1. A CPU team **taking a player on** reads his contract unclamped (shortfall x `RECEIVED_SHORTFALL_COST` 1.25) and takes the better of keeping him and cutting him (-0.8 x penalty). The shedding side is unchanged (`LIABILITY_RELIEF`).
2. A need adds at most `NEED_PREMIUM_SHARE` (25%) of the player's chart price, both gained and lost.

## Before / after (cap-room teams unless noted)
| Case | n | old | new |
|---|---|---|---|
| 20x3 free, rel >= $10M | 360 | 43% | **1%** |
| 20x3 free by year (y1/y2/y3) | 372 each | 0 / 36 / 6% | 0 / 1 / 0% |
| 20x3 free, EDGE only, by difficulty (casual..master) | 60 each | 57-63% | 0-12% |
| 20x3 free by window (contending / middle / rebuilding) | 80/75/145 | 56/67/58% | 1/3/13% |
| 20x3 + R7 token | 360 | 43% | not re-tabulated at 1.25 (5% at 1.0); test asserts <= 10% |
| 20x3 + R3 | 360 | 99% | 21% |
| 20x3 + R2 (meaningful) | 360 | 100% | 96% |
| 30x4 + R2 / R3 | 192 | 100% / 36% | 30% / 1% |
| 20x3 free, deadline path (all 31, no cap check) | 1116 | 14% | 0% |
| 12x2 (penalty $5.3M) free / +R2 | 888 | 81% / 100% | 36% / 100% |
| K: best offer / chart (mean), > 1.25x | 12 | 1.19x, 25% | **0.98x, 0%** |
| P: best offer / chart (mean), > 1.25x | 12 | 1.68x, 75% | **1.04x, 8% (1 of 12)** |
| K / P mean over all teams / chart | 12 | 0.71 / 0.72 | 0.70 / 0.69 |
| K / P teams that buy (of 31) | 12 | 31.0 / 30.8 | 31.0 / 30.8 |

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
