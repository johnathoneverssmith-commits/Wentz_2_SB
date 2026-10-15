# Browser tests (solo proof of concept)

Playwright tests that drive the real UI in a real browser, against a league the game itself played into place.
Solo play only: the league lives in the browser, so there is **no server, database, account or network** involved.

```bash
npx playwright install chromium        # once: Playwright's own Chromium (about 150 MB)
npm run e2e                            # the suite (about 1.5 minutes)
npm run e2e:typecheck                  # the tests, and the fixture builder under the UI's TypeScript settings

E2E_BROWSER_CHANNEL=chrome npm run e2e # use the Chrome that is already installed instead of downloading Chromium
```

## What is guaranteed

* **Only this run's own UI is reachable.** Before the tests, the production bundle is built into a temporary
  directory and served by a static server process the run owns, on a free loopback port. Every browser request to
  any other origin is aborted (`support/guard.ts`): the engine adapter on `:8787`, the league API on `:8788`, Google
  Fonts, a deployed site, another local port, WebSockets. A test fails if the page tries to reach something that is
  not on the short list of known, harmless attempts. The deployed website and its API are never contacted.
* **Service workers are blocked**, and **every test gets a new browser context**, so no `localStorage` survives.
* **The server cannot be left behind.** It is stopped by the teardown, whether the run passed, failed or timed out;
  and if the run is killed outright it notices its parent has gone and exits within seconds. (A killed run leaves two
  temporary directories in the system temp folder, `wentz-e2e-ui-*` and `wentz-e2e-fx-*`; delete them.)

## Where the starting leagues come from

`fixtures/build.ts` plays a real league headless through the game's own stage machine (setup, the fantasy draft,
the coaching draft, free agency, training camp, ... , preseason), the way `ui-source/src/state/playthrough.test.ts`
does, and keeps the exact string the app saved at the first arrival in five stages. No stage is set by hand.

Two of the five come from playing a whole year, and are built in full only when asked for (`--only` limits a build
to the early three, which is what the seed and clock checks use):

* `midseason-fa`: the first arrival at the mid-season free-agency market, nothing chosen yet.
* `offseason-fa-skip-carried`: the same league a year on, at the door of the offseason market, after the human GM
  chose "Skip free agency" in the mid-season market (the store's own `setSkip`, which the checkbox calls) and the
  league was played on through its stage machine. The builder refuses to write it unless that choice is still set,
  so the save always exercises the carry-over. `E2E_BUILD_TRACE=1` prints each stage the build plays.

What is controlled, because a frozen clock alone does not make a league deterministic: an explicit seed (never 1),
the draft salt (`seed * 31`), the data the generator reads (hashed; `fixtures/inputs.json` pins it, so changing the
player pool or schedule is a deliberate re-pin), the in-process Mock simulation (the engine adapter is unreachable),
and the clock. `specs/fixtures.spec.ts` builds all the leagues twice in separate processes and requires byte-identical
saves; it also builds with another seed (different) and with the real clock (the finding is recorded).

## What the tests check

| Spec | What |
|---|---|
| `isolation.spec.ts` | the guard, service workers, fresh storage, what a page load tries to reach |
| `fixtures.spec.ts` | pinned inputs, genuine progression, determinism, size |
| `save-reload.spec.ts` | each save opens at its own stage's screen and survives a reload |
| `draft.spec.ts` | a real action: draft a player, check the saved league, reload, check again |
| `regular-season.spec.ts` | the regular season through the hub and Game Day: each game once, records and standings recounted from the games, reloads that never replay, the trade deadline and the stages after it, and the move into the playoffs (see below) |
| `free-agency-offers.spec.ts` | real offers in a free-agency market: the form, what the game accepts and refuses, the signing, the roster, the books and the cap, across rounds and reloads (see below) |
| `free-agency-skip.spec.ts` | the "Skip free agency" soft-lock (commit `b757e8d`): the real checkbox and buttons, on screen and in the saved league, across a reload (see below) |
| `stack.spec.ts` | the static server: read-only, loopback, refuses taken ports, exits with its parent |

Selectors are accessible roles and names (`getByRole`); no `data-testid` was needed.

### The free-agency skip regression

The choice is a setting on the human GM and used to outlive the market it was made in: the next market opened with
it still on, passed the GM's turns before they saw the board, and was over before it began. The fix is the
`clearSkips` call in `beginFreeAgencyEvent`. Three tests, each checked on the screen and in the saved league:

1. **control** (mid-season market, box left unchecked): the market waits for me; nothing moves on its own; passing
   takes my turn and the league plays its round; it survives a reload.
2. **ticking the box** finishes this market, moves the league to its summary, and saves the choice.
3. **the carry-over**: from the save above, through the rookie signings to the offseason market. It must open on
   round 1 with my team on the clock, the box unchecked and the saved choice cleared; then five rounds of my turns, the
   summary, the roster fix and the advance to training camp, with a reload at the start and at the end.

Negative control, done once in a disposable copy and not part of the suite: with the `clearSkips` call removed, tests 1
and 2 still pass and test 3 fails at "the offseason market is the board": the page is the market's summary, the
market over before its human saw it. (In solo play the league then moves on by itself; the literal "stage never
leaves" form of the bug was in the online server's turn runner, which these tests do not cover.)

### The regular season

Three more saves from the same playthrough: `season-week-1` (the opener), `season-week-9` (the last week before the
trade deadline) and `season-week-17` (two weeks from the playoffs); each holds exactly the games already played. A
week is "Ready for Game Day" on the hub, the Game Day screen, and "Continue". After every week the tests recount the
season from the saved games alone (`support/season.ts`, `expectSeasonConsistent`): each scheduled game is on the books
exactly once and nothing else is; no team plays twice in a week; every record and point total is what its games add up
to; the ranks agree with the records. Then the screens: the hub's record, the standings table and the schedule's final
scores are compared with the save.

1. **Three weeks from the opener**, then the hub, the standings table and the schedule against the books.
2. **Reloads never replay a game**: on Game Day (the slate is held and shown again, same games and scores), after
   Continue, and into the next week, whose games are added on top of the same books.
3. **The trade deadline**: week 9 is played like any other; then, each reached by the player's own action and each
   leaving the games and the standings untouched, the deadline (sat out, offers turned down), its summary, the
   mid-season market (sat out), the depth chart, and week 10, which is then played.
4. **Into the playoffs**: weeks 17 and 18, then the regular season is complete (272 games, 17 per team), fourteen
   teams are seeded (seven a conference, the right conference, no team twice, the best seven by wins, the same seven the
   standings table shows), the one seed has a bye, the rest are paired 2-7, 3-6, 4-5, nothing is played, the screen shows
   the same records, and a reload finds the same bracket. Playing the rounds is not covered here.

Two findings are recorded in the test output (as annotations), not asserted, because they would need a change to the
game's rules rather than to a test: teams with the same record are ordered on the standings table, and the bracket's
seeds are ordered, by wins then point difference, while the saved conference and division ranks apply head-to-head, division
and conference record first (`recomputeStandings`). The seven teams in the field are the same either way in this save.

Each test was shown to fail when one thing was broken in a disposable copy (not part of the suite): every game played
twice, ties counted as losses, a week that never advances, a held slate that is never cleared, a deadline that is
skipped, and a bracket that seeds the worst teams.

### Offers, signings and the cap

From the `midseason-fa` save (the same engine and screens as the offseason market, with a smaller pool). The rules the
tests lean on, all in `ui-source/src/state/freeAgencyEvent.ts` and `freeAgencyValues.ts`: a player will only take an
offer at or above his asking price; the best eligible offer wins when the round ends (salary against his asking price,
capped, and fit, which counts for less); the cap and the roster limit are suspended while bidding and come back at the
summary. What is therefore pinned, and what is not:

* **Pinned**: the form refuses a bid below the ask (and at exactly the ask lets it through); the rules refuse one above
  the league maximum, in words, with the turn unspent and nothing saved; a bid at three times the ask cannot be beaten by
  any CPU offer, so it is accepted at the end of the round.
* **Then checked three ways** (the market's record, the player, the books) against exactly what was offered: owner,
  contract years and per-year cap hit, roster, and the team's cap use as the game computes it (the first-year cap hit
  of every contract on the roster, which is also what the summary shows).
* **Not pinned**: which of two close offers a player prefers. That is a matter of fit and tuning.

The three tests: one offer through the form, accepted, with the Signed tab and a reload; the refusals above; and
three rounds of offers on different terms (1, 2 and 5 years) through to the summary, where the suspended limits are
back (roster and cap both over, the gate reads "Roster not legal"), the staff fixes the roster, and the league moves on.

Each test below was shown to fail when one thing was broken in a disposable copy (not part of the suite): the contract
paid half, a signing that never changes the owner, a form that lets a below-ask bid through, no league maximum, and a
market whose rounds never advance.

Runs on GitHub's Ubuntu in the advisory workflow `.github/workflows/browser-e2e.yml`, which runs the whole suite. Not part
of `wentz-verify`. Multiplayer is out of scope.
