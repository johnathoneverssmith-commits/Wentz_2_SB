# Agent 5 — Special Features, Immersion & Replayability (v2)

Branch `qa/agent-05-special-features`, base `3abcfff` merged with PR #93. **Documentation and test harnesses only.** No production code, fixtures, probabilities, balance or Arcade code were touched. Nothing was merged or deployed.

## Where things are
| Deliverable | File |
|---|---|
| Formal submission (session header, all findings, positives, follow-ups) | `../agents/agent-05-special-features/report-2026-11-07.md` |
| Hooded Figure eligibility, targeting, payment value, persistence & multiplayer, regression tests | `hooded-figure-analysis.md` |
| Prioritised register (FUN-TAFI-001…018) | `tafi-register.md` |
| Top 15 improvements + two storyboards | `top-15-improvements.md` |
| Commands, seeds, sample sizes | `REPRODUCE.md` |
| Raw data, screenshots | `evidence/` · harnesses `harness/` (`.txt`) |

## What was done, honestly
| Item | Status |
|---|---|
| Five consecutive seasons | **Done, headless, real engine** (2027–2031, seed 21, GB, autopilot GM). The first attempt silently used the mock simulator and is kept only as `…-MOCK-SIM-superseded.json`. |
| Played by a human in the UI | **No.** Seen in the browser: the figure offer and paid screen, the League Developments reveal, the fantasy-draft on-the-clock overlay and pick confirm. Everything else is code reading. |
| Enjoyment scores 1–5 | **Not given.** I did not play as a person would, and static screenshots cannot show pacing or emotion. |
| Hooded Figure, natural | 3 offers in the 5 real-engine seasons (2028, 2029, 2030 offseasons), all negative outcomes on CPU teams. |
| Hooded Figure, controlled | 1,800 + 3,000 fixture resolutions; synthetic eligibility study (4,000 seasons per cell). None of these count as natural encounters. |
| Multiplayer | State-level two-human fixtures and existing tests. **No live server session.** |

## Season summary (real engine, objective only)
| Season | Record | Playoffs | Point diff | Figure after |
|---|---|---|---|---|
| 2027 | 13-4 | #3 seed, **Super Bowl champions** | +127 | no (streak 1) |
| 2028 | 5-12 | missed | −87 | $3M: CHI ILB 80 out for the season |
| 2029 | 3-14 | missed | −105 | $3M: DET punter, 1 game |
| 2030 | 4-13 | missed | −99 | $3M: MIN QB 92 / S 72 / CB 88, 1 game |
| 2031 | 4-13 | missed | −139 | not reached |
The roster decayed under the autopilot (passes every free-agency turn, auto-picks, no re-signing). The run shows the figure rule and a title-then-collapse arc; it is not evidence about how a human would build a team.

## Remaining untested scenarios (need a browser plus a live league server)
1. Two humans connected at once, both eligible: pacing while one waits for the other.
2. Reload or disconnect mid-encounter in a live online league.
3. Commissioner and non-commissioner screens during the encounter and the reveal; other endpoints that return the league document.
4. Whether positive rating boosts are visible to rivals before the reveal.
5. Long-run: a human playing 10+ seasons through repeated offers; animation, sound and timing of every screen; gamecast key moments, retirement, end-of-season and history screens as experienced.
6. How long the figure's dead money stays on the cap (Agent 7).
7. Rookie rapid-development outcomes (the fixture had no rookies).
8. Defending-champion and dynasty states under human play (the run won one title only).

## Cross-references
Agent 3: A5-003/005/018 · Agent 8: A5-013/014 · Agent 7: dead money · Agent 2: A5-017 · Agents 1 and 9: A5-007/009 · Agent 4: nothing inaccessible found in the special-event screens I opened.
