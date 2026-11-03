# Group 02: game days, results and the playbook

Read `00-brief.md` first. Branch `feat/ui-game-days`. Open a draft PR to claim it. Strongly consider two PRs:
(a) Game Day, Game Plan, Box Score; (b) Game History, Season Results, Playoff Round Results, Recap panel.

**Spoilers are the whole risk here.** Every screen below shows scores or outcomes. Read from `visibleGames`
and `visibleBracket` (`state/reveal.ts`), never `state.games` or `state.bracket`. Reveals do not move
`state.week`; ask `currentBlock` (`state/revealBlocks.ts`). A restyle must not change which results a GM sees.

## Screens

| Screen | File | Route | Lines |
|---|---|---|---|
| Game Day | `screens/GameDay.tsx` | `/game-day` | 298 |
| Game plan (full playbook) | `screens/GamePlanScreen.tsx` (+ `components/gamePlanning/*`) | `/game-plan` | 445 |
| Full box score | `screens/FullBoxScore.tsx` | `/box/:gameId` | 369 |
| Game history | `screens/GameHistory.tsx` | `/games` | 87 |
| Season results | `screens/SeasonResults.tsx` (+ `WeekResults`) | `/results/:phase/:from/:to[/:week]` | 343 |
| Playoff round results | `screens/PlayoffRoundResults.tsx` | `/results/round/:round` | 153 |
| Recap panel | `screens/RecapPanel.tsx` | component | 71 |

Already done: the hub's `CommandCenterGamePlan` card is styled on the hub; the full Game Plan screen is not.

## Per-screen notes

- **Game Day**: the post-simulation screen: it shows the week or round was played and its Continue button
  is what actually advances the week or stage. Uses `ScoreMoment` (motion) for score reveals: keep the
  reveal order and the reduced-motion and motion-off behaviour. Device suggestion: a scoreboard strip, one cell
  per game, your game first and in ink. Specs: `regular-season`, `playoffs`, `offseason`, `play-by-play`.
- **Game plan**: offense and defense strategy sliders (range inputs), saved-plan state, previews from the
  engine, "Save game plan", "Discard changes", preview truthfulness (an unavailable engine must not invent a
  probability; a refusal must never read as saved). `e2e/specs/game-planning.spec.ts` reads names, regions and
  states exactly; the whole spec must still pass at 1440 and 390. Style range inputs with an accent thumb.
- **Box score**: tables of passing, rushing, receiving, defence and team stats for a played game. Device
  suggestion: a scoreboard header (team colours, quarter-by-quarter line score) then ruled tables. Tables
  may scroll horizontally inside their own container on a phone; the page must not.
- **Game history**: every game your team has played, newest first, each with box score and play-by-play
  links; online it lists only games this GM watched.
- **Season results and playoff round results**: week-by-week and round results for the viewer's revealed
  games only. Keep the "no results yet" states. Use `roundLabelFor` and `bracketRounds`, never `ROUND_ORDER`.
- **Recap panel**: small shared component; keep its props.

## Acceptance

All of `00-brief.md` section 8, plus: a spoiler check. With a league where only some weeks are revealed to this
GM, compare the list of scores your converted screens show before and after: it must be identical. State how
you checked. Specs `regular-season`, `playoffs`, `game-planning`, `play-by-play` pass in CI.
