# Group 05: the end of the season and the offseason review

Read `00-brief.md` first. Branch `feat/ui-season-end`. Open a draft PR to claim it. One PR is fine (the screens
are small); two is fine (a) end of season and hot seat, (b) retirements and rookies.

## Screens

| Screen | File | Route | Lines |
|---|---|---|---|
| End of season announce / season complete | `screens/EndOfSeason.tsx` (`EndOfSeasonAnnounce`, `SeasonComplete`) | `/end-of-season`, `/season-complete` | 272 |
| Hot seat | `screens/HotSeat.tsx` | `/hot-seat` | 334 |
| Retirement review | `screens/RetirementReview.tsx` | `/retirement` (also `/draft-preview` redirects here) | 238 |
| Rookie draft summary | `screens/RookieDraftSummary.tsx` | `/rookie-draft-summary` | 32 |
| Rookie signings | `screens/RookieSignings.tsx` | `/rookie-signings` | 325 |

Related components they use: `LeagueMemory`, `OffseasonRounds`, `ScoreTrackerTable`, `GmIdentity`,
`ExpandableRow`, `ListFilter`, `ReadinessGate`. Specs: `offseason.spec.ts` (walks all of these in order),
`playoffs.spec.ts`, `fixtures.spec.ts`, `journey-usability.spec.ts` (rookie signings), `free-agency-skip.spec.ts`.

Already done, do not touch: `FantasyDraftSummary` (the rookie draft summary reuses the same summary frame,
so check the `DecisionFrame` summary and reuse it rather than building a second one).

## Notes

- **End of season** is a big "END OF {year} SEASON" card that any GM clicks past on their own. This is the
  emotional beat of the year: the champion, your result, the year. Use the team masthead with the champion's
  colours, giant numerals, and the Continue button. Device: the final standings or the title game as a
  single big scoreboard cell. Keep the win, consolation and "season complete" variants (`endOfSeasonWin`,
  `endOfSeasonConsolation`); each has its own copy.
- **Hot seat**: the owners' review: which CPU GMs were let go, who they hired and what that GM builds, and
  who is on the hot seat for next year. It uses motion heavily (ten hits): keep the sequence and respect
  motion-off. Strategies and skills belong to the GM, not the team (`state/aiGms.ts`); show them the same.
- **Retirement review and rookie signings**: long lists with `ExpandableRow` and `ListFilter`. Rows reflow
  by container width; filters and expanders need 44px targets and keyboard operation; expanded rows must not
  push the page wider.
- **Rookie draft summary** is not a checkpoint: it steps this GM into rookie signings alone. Keep that.
- Reconciliation rules here are deliberately allowed to be illegal until enforced (cap, roster limit,
  positional minimums): keep every warning and notice visible and readable.

## Acceptance

All of `00-brief.md` section 8, plus: `offseason.spec.ts` passes in CI; the year labels (stored year versus the
year being prepared for) are unchanged; a screenshot of each variant of the end-of-season card.
