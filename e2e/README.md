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

Runs on GitHub's Ubuntu in the advisory workflow `.github/workflows/browser-e2e.yml`, which runs the whole suite. Not part
of `wentz-verify`. Multiplayer is out of scope.
