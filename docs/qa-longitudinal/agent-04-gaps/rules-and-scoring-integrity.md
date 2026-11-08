# Scoring and rules-integrity report

Harness: `harness/qa_longitudinal.test.ts.txt` (drops into `ui-source/src/state/` as `_qa_*.test.ts`; never committed there). It plays the real store/stage machine and checks every finished game and every season boundary. Seed 4001, default config.

## Checks and results

| Check | Real engine (2 seasons headless + 3 UI seasons) | Mock fallback (3 completed seasons headless, 960 games) |
|---|---|---|
| Final score = sum of quarter points = last scoring-play running score | pass | pass (Mock builds plays from the score) |
| Scoring-play increments legal (2,3,6,7,8 or an XP 1 after a TD) | pass | **fail**: 307 of 640 games (2 seasons re-counted) contain a "Safety" worth **1** point; the same number contain a "Safety" worth 2 |
| No one-point final score | pass (0 in the 245 + 241 games kept in the two UI saves, plus 2 headless engine seasons) | **fail**: 8 games in 3 seasons (960) (e.g. `2027-REG-4-ATL-CAR 1-23`, `2027-REG-1-ATL-NO 1-4`) |
| Player lines imply ≤ team points (6/TD, 3/FG, 1/XP) | pass | **fail** (e.g. lines imply 20 pts on a 17-pt score; 27 on 22) |
| Passing TDs = receiving TDs per team | pass | **fail** (e.g. 4 pass TDs, 1 receiving TD) |
| Playoff games never tied | pass | n/a (Mock playoffs have no OT, scores 20–34 vs 10–33) |
| 17 regular-season games per team, no duplicate game id, no team twice in a week, no team vs itself | pass | pass |
| W-L-T, PF, PA recount from games equals stored | pass | pass |
| League wins == league losses | pass | pass |
| Playoff games present in `state.games` | pass (333 games/season) | **fail** (320: playoff box scores are never produced) |
| Cap never exceeded; every rostered player has a contract; no negative cap hit | pass (every preseason) | pass |
| Champions / history / teamSeasons / awards grow once per season | pass | pass |
| Draft-pick horizon rolls (2028-29 → 2031-32) and no pick owned by an unknown team | pass | pass |
| Player yards in lines vs team totals | rush: lines exceed team by **+12 yd on average (max +55)**; pass: **−10…+12 yd, mean −1.4** (38 games) | far larger, unrelated |

## Was a one-point score a legal rule outcome? (the brief's example)
No. NFL scoring has no one-point safety; a lone point exists only as a try after a touchdown (the engine's `XP_RATE`, `scorePts(1, …, "extra_point")`). The engine's own box scores never produced one. In the Mock, `MockSimulationService.scoringPlays()` splits any score into 7s and 3s and labels the remainder "Safety", so a remainder of 1 becomes a one-point "Safety". Root cause **confirmed** by reading the code and by 307/640 games showing it.

## Retired players on a roster (observation, not a finding)
~100 players a season have `retired: true` with `nfl_team` still set. Every roster/cap filter excludes `retired`, and the rosters, cap and roster-size checks all passed, so this looks intentional. Not verified: whether any screen lists them (League Rosters was not exercised).

## Rush yards (GAP-003) resolution
Engine `rush_yards` is recorded only in the designed-run branch (`src/engine/sim.ts` ~1898); scrambles are a separate family that does not increment it, while `server/boxscore-map.ts` `playerLinesFrom` counts `call === "scramble"` as `rushAtt/rushYds` for the QB. So the rush surplus (+12 yd avg) is **a legitimate accounting-convention difference** (QB scramble yards appear in player lines, not team rush) — **confirmed by code, not by instrumenting plays**. The pass difference is **not** explained by sack netting (team `pass_yards` is gross completions; differences are symmetric −10…+12). **Unresolved**; suspect per-play rounding/TD-yard clipping between the trace and the team stat. Hand to Agent 2 with `evidence/engine-2season-findings.txt`.
