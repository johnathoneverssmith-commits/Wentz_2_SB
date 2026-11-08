# Top 15 fun & immersion improvements

Ranked by expected player benefit against development complexity. Each item's proposed approach and regression test are in `hooded-figure-analysis.md` §5 or the finding block in the report. Fixes 014/015/016 are small correctness items and should ride along with item 1. These are **proposals**. Mockups below are not existing functionality. Items needing a rule change need approval.

| # | Improvement | TAFI | Type | Complexity | Multiplayer? |
|---|---|---|---|---|---|
| 1 | Fix solo-GM Hooded Figure eligibility (rule D: relative loser must also miss the playoffs) | 001 | Fix (needs approval) | S | n/a |
| 2 | Payer-only "your deal" marker on the reveal, plus a terms line on the offer | 002, 007 | Presentation | S | yes |
| 3 | The Figure's Ledger (season tracker + retrospective) | 006 | New | M | yes, redacted |
| 4 | Make low-tier harm matter (schedule-aware); review whole-roster-out | 003, 018 | Balance (approval) | M | yes |
| 5 | Stakes-scaled game banners | 010 | Presentation | M | yes |
| 6 | On-the-clock overlay scaled by pick and value over slot | 009 | Presentation | M | yes |
| 7 | Legend retirements | 011 | Presentation + data | M | yes |
| 8 | Season-end chronicle line | 012 | Presentation | M | yes |
| 9 | Figure remembers you (escalating dialogue) and an optional one-season cooldown | 008 | Presentation | S | yes |
| 10 | Exclude or weight K/P in position-group boosts | 004 | Fix (approval) | S | yes |
| 11 | Franchise leaders and records panel | 012 | New | M | yes |
| 12 | Rivalry tracker with meeting history | 012 | New | M–L | yes |
| 13 | Training-camp breakout call-outs | — | Presentation | S | yes |
| 14 | Retired numbers / banner wall | 011 | New | M | yes |
| 15 | Reconsider the flat $10M tier-4 certainty | 005 | Balance (approval) | S | yes |
| + | Redact `hoodedFigure.unavailable` until the reveal (small fix, rides with #1) | 014 | Fix | S | yes |

Item 13 is untested by me (camp results screens were not viewed); treat it as an idea, not a finding.

## Storyboard A — The Figure's Ledger (proposal)
1. After paying: card "The deal is sealed." Shows only what you paid and a closed envelope.
2. League Developments: envelope opens; your result and the *kind* of effect are named.
3. Hub, weeks 1–17: small chip "Figure's deal: DET RB/ILB/EDGE out through Wk 1."
4. Season end: one line "The deal cost $3.0M and sidelined 3 starters for 1 game. You faced DET in Wk 6: no effect." Skippable.
Frequency: only when the figure appears. Presentation plus stored data already in `encountersBySeason`. Multiplayer: others see only the public part.

## Storyboard B — Legend retirement (proposal)
Trigger: retiring player with â‰¥6 seasons on your team, or a major award. Screen: portrait, years, titles, franchise rank in a stat, a fan quote, one button "Retire the number" (optional). Ordinary retirements keep the current one-line blurb.
