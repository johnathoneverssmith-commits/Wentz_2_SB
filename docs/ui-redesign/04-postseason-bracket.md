# Group 04: the postseason bracket

Read `00-brief.md` first. Branch `feat/ui-bracket`. Open a draft PR to claim it. One screen, but a big one.

## Screen

**`screens/PostseasonBracket.tsx`** (646 lines), route `/bracket`. It also uses
`components/PostseasonMatchups.tsx`, `GamePlanStrip.tsx`, `GmIdentity.tsx`, `ExpiringContracts.tsx` and
`ReadinessGate`. Specs: `e2e/specs/playoffs.spec.ts`, `regular-season.spec.ts`, `offseason.spec.ts`,
`fixtures.spec.ts` (all four reach `/bracket`).

## Direction

**The bracket is the device. Draw it as a bracket**: rounds as columns on a wide screen, each matchup a ruled
two-team cell with seed numbers, team-colour blocks, and the score as condensed numerals once revealed; your
team's path in ink with the accent; the Super Bowl in the centre or at the end. Connector lines are plain 2px
rules. On a phone the rounds become a vertical stack or a horizontally scrolling strip *inside its own
container* (the page itself never scrolls sideways); a viewer must still be able to find their team in two taps.
Keep the byes visible.

Rules specific to this screen:

- **Spoilers**: three places already read `visibleBracket`/`visibleGames`. A matchup whose game this GM has
  not watched shows teams and seeds only, no score and no winner. A restyle must not make an unrevealed
  result inferable (no highlighted winner, no advanced team slot filled early).
- **League format**: NFL is 14 teams, 7 seeds per conference, 3 rounds plus the Super Bowl. A "humansOnly"
  league has a single bracket sized to a power of two (`isHumansOnly`, `playoffFieldSize`). Use
  `bracketRounds(b)` and `roundLabelFor`, **never `ROUND_ORDER` or `ROUND_LABEL`**. Test your layout with a
  4-team and a 6-team league, not only the 32-team one (`state/leagueFormat.ts`, `humansOnlyLeague.test.ts`
  shows how to build one).
- Eliminated teams, byes, the viewer's team and "still in the hunt" (before the field is set) all need a
  designed state.
- Keep the readiness gate and the continue button exactly where the flow needs them.
- Standings tiebreakers and seeding are engine logic: do not touch.

## Acceptance

All of `00-brief.md` section 8, plus: screenshots of the bracket in four states (before the field is set,
field set and nothing played, mid-playoffs with some results unrevealed, finished) at 1440 and 390, and one
humans-only bracket. The playoff specs pass in CI.
