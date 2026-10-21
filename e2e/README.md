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
| `offseason.spec.ts` | a finished season through the whole offseason into the next season's first week: history kept, the year turns once, draft, rosters and contracts, and reloads that repeat nothing (see below) |
| `playoffs.spec.ts` | the postseason through the bracket and Game Day: every round, who advances, byes, the champion, and reloads that replay nothing (see below) |
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
4. **Into the playoffs**: weeks 17 and 18, 272 completed games, fourteen unique teams, one bye per conference,
   2-7 / 3-6 / 4-5 pairings, and reload persistence. Expected seed identities and numbers come independently from
   `src/engine/standings.ts` (`computeStandings`) using only the finished regular-season games: four division winners
   at seeds 1-4, then three wild cards, with the documented NFL tiebreakers. Mock's bracket and saved ranks are not the oracle.

Standings rows retain team identity, seed, record and points and must agree with persisted conference ranks in order.
Bracket rows retain identity, seed and record, matched to each persisted Wild Card side. Numerical multisets are not enough. Two real-page reader negative controls replace a standings name and a bracket name with another team while leaving all numbers unchanged; the exact-identity comparisons must reject both.

**Known production dependencies (tests intentionally fail):** the hub orders tied teams by point differential rather than
persisted conference rank; Mock (also used for multiplayer seeding) selects by wins and point differential instead of the
main-engine division-winner and tiebreak rules. The corrected assertions expose these discrepancies as failures, not
annotations, skips or expected-failure markers. Soft assertions keep later schedule, bracket and reload coverage running
but still give the test and suite a failing exit code. Production fixes belong in a separate focused gameplay PR.

Each test was shown to fail when one thing was broken in a disposable copy (not part of the suite): every game played
twice, ties counted as losses, a week that never advances, a held slate that is never cleared, a deadline that is
skipped, and a bracket that seeds the worst teams.

### The offseason

One more save from the same playthrough, `end-of-season`: the first arrival after the Super Bowl, the season over and scored (champion,
awards, every team's season and the human GM's history recorded), the offseason not begun. One test takes it, with the real controls, to
the first regular-season week of the next season: the end-of-season screens and the hot seat, the retirement review, the rookie draft
(the human's own seven picks, one click each), the rookie signings, free agency and the roster fix, training camp, the depth chart, the
start of the next season, the three preseason games, and week one (simulated once). It checks, from the saved league
(`support/offseason.ts`) and from the screens:

* **History kept**: the season that ended stays on the record once and unchanged (champion and runner-up, every team's season, the
  awards, the human GM's history; the Hall of Fame only grows), the League History screen shows it before and after the year turns, and
  nothing is recorded for a season not yet played.
* **The year turns once** (the old year until the season starts; `season + 1` after), and every player ages exactly once with it (camp
  ages no one).
* **Identity**: the same thirty-two franchises, the same human GM on the same team.
* **Retirements** happen once as the review closes and are never undone; nobody retired is on a roster; players the staff released are on
  the market.
* **The draft**: 224 picks (seven rounds of the thirty-two teams), nobody taken twice, each by the team the order gave it, every round in
  the same order, and that order the worst regular-season record first (the champion is not last: the order is the record, nothing
  more). Every pick is initially assigned to its drafting team. All 224 signed identities and original draft metadata are then
  accounted for at each market, reconciliation, camp, rollover and new-season boundary. Duplicate identities, missing rookies and
  unexplained active-team transfers fail. A release must be observed at an allowed boundary; a different-team signing needs a new
  persisted market record or a prior market snapshot at roster fill. Own-team practice-squad moves and promotions use their documented
  eligibility and fixed contracts. This year's retirees remain identifiable, with a market snapshot and retirement year.
* **Contracts and rosters**: complete contract objects (all future cap hits, guarantees, bonuses and optional flags) are compared.
  Untouched contracts are exact, including across rollover and reload. Only entry to camp permits automatic CPU extensions: authoritative
  read-only eligibility/price quotes are checked against ownership, every extension term, one extension per team and the budget rules.
  Human extensions are never inferred. Recorded free-agency deals match their signing terms; observed market players signed during
  roster fill must have a documented fill price and contract shape. Every team that takes the field is full (53) and under the cap.
* **A new season**: records, points, games and the bracket start again, the schedule is a full new one (272 games, 17 each), and week
  one's games, once played, add up (`expectSeasonConsistent`).
* **Reloads change nothing**, at every boundary (the end-of-season screen, the hot seat, the retirement review, the start of the draft,
  the middle of the draft, the completed draft, the rookie signings, the roster fix, camp results, the depth chart, the start of the next
  season, the first hub, Game Day): no second retirement, no draft rebuilt, no second signing, no camp run again, no second year, no
  second round of aging, no rewritten champion.

**Evidence limits:** the save has no exhaustive release, trade or roster-fill transaction log. Adjacent snapshots establish that a
player was on the market; documented stage windows and signing records constrain what may happen next. They do not prove every internal
operation or the ordering of transactions within one atomic save. An active-team-to-active-team change without a signing record or an
intervening market snapshot is rejected, rather than inventing a release. No trade is initiated by this scenario. Authoritative quote
functions establish permitted terms, not independent evidence that an extension command executed. Old retirees/generated fillers have
documented compaction paths, but none permits a current drafted rookie to silently disappear.

The lifecycle includes positive controls for releases, new-team signing records, practice-squad moves/promotions and market retirement;
and negative controls for unauthorized rookie transfers, missing/duplicate identities, human extensions, second expiration, future
salary, guarantee and bonus corruption. The former two false passes were reproduced in disposable browser builds before correction.

Each defect below was shown to fail this test, on the intended assertion and not on a timeout, in a disposable copy (not part of the
suite): the league year turning twice, the last champion dropped from the record, the draft taking a player twice, rookies signed to
the wrong team, contracts shortened a second time at the rollover, new-season records not reset, offseason advancement stuck at the
retirement review, the draft board rebuilt when the screen is re-entered, and everyone ageing twice.

### The postseason

One more save from the same playthrough, `playoffs-wild-card`: the first arrival at the playoffs, the regular season played out,
the bracket seeded by the game, nothing in it played. A round is "Simulate the <round>" on the bracket, the Game Day screen, and
"Continue" (which goes back to the bracket; after the Super Bowl it goes on to the end of the season). No participant is chosen and
no result is made up. `support/postseason.ts` checks the bracket from the saved league alone after every round
(`expectBracketConsistent`): the field is the seeded fourteen (and is the engine's seeding of the season just played); the one seeds
were on a bye and 2-7, 3-6, 4-5 were paired; every game played has a winner that its score gives (the home side, the higher seed,
holds `homeScore`); the next round is the reseeding of those winners (best surviving seed against worst, the higher seed hosts; the
Super Bowl is the AFC champion against the NFC champion); no team that lost ever comes back; nothing later has been played; the
champion is the Super Bowl winner and only then.

1. **All four rounds.** After each round the Game Day list is compared with the save row by row, in the order shown: which team is
   home and which away, each with its own score, and the winner's name in the winner's weight (a loser emphasised, or two games'
   scores swapped, is not the same list). Both conferences' brackets are compared team by team (seed, name, score) with the
   winner marked as the screen marks it (the winner's score in the "good" colour). After the Super Bowl the Super Bowl tab is opened
   by name and its one game compared with the save: the AFC then the NFC champion, each with its own score, exactly one winner
   marked, and it is the champion the bracket names. After the season ends, each team's recorded season (furthest round, seed,
   champion) is compared with where the bracket says it went out.
2. **Reloads replay nothing**: on Game Day (the round is held and shown again, the whole postseason unchanged), on the bracket while
   a round's results are held (it offers the results and no other round to simulate, and the Super Bowl tab still shows the same
   game), and between rounds (the next round waiting, unplayed, the one just played not offered again).

The Mock simulation (what plays when the engine adapter is unreachable, as in these tests) records a playoff round in the bracket's
matchups (scores and winners) and not in the list of games, so "recorded once" here means each matchup decided once, never twice;
a round that is replayed would show as a round skipped or a bracket made again. Each test was shown to fail when one thing was
broken in a disposable copy (not part of the suite): a bracket that never advances a round, the loser recorded as the winner, byes
not carried into the next round, the wrong reseeding, the champion always the AFC side, Continue making the bracket again, every
round made twice; and, in the screens themselves, Game Day scores rotated between games, Game Day emphasising the loser, a Super
Bowl bracket showing a score of 99, a bracket marking the loser as the winner, and the Super Bowl's scores on the wrong teams.

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
