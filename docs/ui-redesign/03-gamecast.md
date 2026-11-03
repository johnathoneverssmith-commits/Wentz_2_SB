# Group 03: Watch a game (the gamecast and play-by-play)

Read `00-brief.md` first. Branch `feat/ui-gamecast`. Open a draft PR to claim it. This is the live-game stage
and it has its own CSS, audio and tests, so it is its own group.

## Screens and files

| Piece | File | Notes |
|---|---|---|
| Watch game screen | `screens/WatchGame.tsx` (151) | route `/watch/:gameId`; fetches the broadcast online, reads it from the game offline |
| Gamecast | `screens/gamecast/Gamecast.tsx` | the field, score, clock, the play being shown |
| Key moments | `screens/gamecast/KeyMoments.tsx` | highlights |
| Narrated | `screens/gamecast/Narrated.tsx` | the written call of the game |
| Play-by-play log | `screens/gamecast/PlayByPlayLog.tsx` | the full log; has a unit test |
| Styles | `screens/gamecast/gamecast.css`, `highlights.css` | existing, dark |
| Audio | `audio/useGameAudio.ts`, `chants.ts`, `score.ts` | do not change behaviour |

Tests that must keep passing: `screens/gamecast/PlayByPlayLog.test.ts`, `narrated.test.ts`, and
`e2e/specs/play-by-play.spec.ts` (it walks every game's play-by-play from the schedule and history and checks
there are no portraits on the roster page).

## Direction

This is the one screen family where a **broadcast look** is natural: a scoreboard, a field, a ticker. Your
default is to convert it to the system (light page, team masthead, ruled panels, Big Shoulders scoreboard
numerals, accent for the live play). If you decide a dark "broadcast stage" panel for the field or the log
is better, you may keep **that one panel** dark, provided the page chrome (masthead, tabs, buttons, selects,
footers) is the system's, the dark panel is square-cornered and ruled, and you explain the choice with
screenshots in the PR. Do not leave the old rounded glass styling anywhere.

- Device: the **scoreboard**: team blocks in team colours, the score as huge condensed numerals, quarter and
  clock, down and distance. It must stay legible at 320px.
- The play-by-play is never stored: it is rebuilt from the game's seed plus the saved `sidelined` list
  (`online/src/blocks.ts`, `regenerateBroadcast`). Do not change what is fetched or when. Loading, failure and
  "not available" states must be designed too, not just the happy path.
- Playback controls (play, pause, speed, skip) need 44px targets and visible focus.
- Spoilers: the page may only open for games this GM has watched or revealed; keep that guard.
- Respect `prefers-reduced-motion` and the app's motion setting for any ball, clock or highlight animation.
- Long logs: use a scroll container with its own overflow, not the page.

## Acceptance

All of `00-brief.md` section 8, plus: the two unit tests and `play-by-play.spec.ts` pass; sound still starts
only after a click; play, pause and skip work by keyboard; the screen is checked at 320 with fonts blocked.
