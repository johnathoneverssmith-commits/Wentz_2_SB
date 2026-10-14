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
does, and keeps the exact string the app saved at the first arrival in three stages. No stage is set by hand.

What is controlled, because a frozen clock alone does not make a league deterministic: an explicit seed (never 1),
the draft salt (`seed * 31`), the data the generator reads (hashed; `fixtures/inputs.json` pins it, so changing the
player pool or schedule is a deliberate re-pin), the in-process Mock simulation (the engine adapter is unreachable),
and the clock. `specs/fixtures.spec.ts` builds the leagues twice in separate processes and requires byte-identical
saves; it also builds with another seed (different) and with the real clock (the finding is recorded).

## What the tests check

| Spec | What |
|---|---|
| `isolation.spec.ts` | the guard, service workers, fresh storage, what a page load tries to reach |
| `fixtures.spec.ts` | pinned inputs, genuine progression, determinism, size |
| `save-reload.spec.ts` | each save opens at its own stage's screen and survives a reload |
| `draft.spec.ts` | a real action: draft a player, check the saved league, reload, check again |
| `stack.spec.ts` | the static server: read-only, loopback, refuses taken ports, exits with its parent |

Selectors are accessible roles and names (`getByRole`); no `data-testid` was needed.

Not yet part of `wentz-verify` or CI. Multiplayer is out of scope.
