# Backyard football — movement sandbox

Milestone 1 of the isolated Wentz arcade track. Bluebirds and Foxes are fictional
five-player teams. This module does not import franchise code, connect to an API,
read/write browser storage or participate in the franchise production build.

## Launch

Use Node 22 or later. From the repository root, install the existing locked tools:

```sh
npm ci
npm ci --prefix ui-source
npm --prefix arcade run dev
```

Open **http://127.0.0.1:5184**. The server binds to loopback, refuses to reuse an
occupied port and uses the arcade entry/config only. Stop it with Ctrl+C.
There are no new dependency installations: the arcade scripts reuse the root
TypeScript/Vitest/Playwright and UI Vite/React installations. No arcade lockfile
is needed; do not run `npm install` inside `arcade/`.

## Play

- Blue #1: **W A S D**. Orange #1: **arrow keys**. Hold both sets simultaneously.
- White rings identify the two humans. The gold outer ring and small football
  identify the carrier (blue #1). Numbered teammates are AI-controlled.
- Blue AI teammates seek support lanes relative to the carrier. Orange AI
  teammates pursue the carrier, with small lane offsets.
- **Pause / Resume** freezes/unfreezes the whole drill. **Restart** resets all
  players and timing, clears held input and resumes practice.
- Switching windows or hiding the page pauses and clears keys. Resume explicitly
  and press a movement key again. Click the field to restore gameplay focus after
  navigating other controls. Arrow keys still work normally on buttons.
- Open **Player positions** to inspect yard coordinates. This is also the visible
  observation surface used by browser tests, not a private test-state hook.

This is a movement drill: possession is fixed, players may overlap, and there are
no passes, tackles, scoring, down progression, roster import or multiplayer yet.
Movement is keyboard-only; narrow screens scale the field but do not add touch
controls. Some keyboards cannot register certain simultaneous key combinations.

## Verify explicitly

Install Chromium once using the existing locked Playwright CLI:

```sh
node node_modules/@playwright/test/cli.js install chromium
npm --prefix arcade run verify
```

On Linux, use `install --with-deps chromium` when system libraries are absent.
To use installed Google Chrome instead, set `E2E_BROWSER_CHANNEL=chrome`
(`$env:E2E_BROWSER_CHANNEL='chrome'` in PowerShell).

`verify` fails at the first failed check and runs, in order:
typecheck, headless unit tests, standalone build, and all arcade browser tests.
Individual commands: `npm --prefix arcade run typecheck`, `test`, `build`, `e2e`.
Playwright owns its temporary Vite server; it refuses an existing server and tears
it down afterwards. Traces, failure screenshots and JSON results are kept under
`arcade/test-results/` (ignored). The build writes only `arcade/dist/` (ignored).

**CI scope:** `.github/workflows/arcade-e2e.yml` is a separate advisory PR workflow
on Ubuntu 24.04 / Node 22. It checks out the exact PR head, installs the locked
root/UI dependencies and Chromium with system libraries, and executes arcade
typecheck, unit tests, build and browser tests as separate steps. It uploads JSON
results, traces and the build even on failure. It has read-only permissions, no
production secrets, no database services and no deployment trigger. Advisory means
it is not required by branch protection; a failed test still makes this job fail.

The existing standard and franchise-browser workflows are unchanged and do not
execute arcade tests. Inspect the dedicated job's exact head, executed steps and
test counts before claiming Linux arcade coverage. A green standard check is not
arcade evidence. No `wentz-verify` command allowlist has changed. Its arcade check
is still a **manual attestation**, not observed runner evidence, so generic CI
cannot promote an arcade plan to an unqualified `VERIFIED` verdict. The report
explicitly qualifies its green local verdict and does not validate the dedicated
arcade workflow; inspect that workflow separately.

## Restart, lifecycle and error regressions

Browser tests use actual simultaneous keyboard input. Restart is exercised both
while two keys are still physically held and directly from paused practice. The
entry runs inside React Strict Mode; its real development effect setup/cleanup/
setup cycle is observed by test-side instrumentation of browser listener and
animation APIs. Exactly one live keyboard listener set and one pending animation
callback must remain. No application state hooks are exposed to tests.

All specs import `e2e/fixtures.ts`, which collects `pageerror` messages through
page closure and asserts the collection in awaited fixture teardown. It does not
throw asynchronously from an event callback. Visibility/blur lifecycle events
are dispatched in the browser while real keyboard keys are held.

Deliberate defects reproduced in disposable copies (not committed to the suite):

| Defect | Required failure |
| --- | --- |
| Remove Restart's input clear | Player moves away from its reset coordinate with keys still held |
| Retain paused state on Restart | Actual control reads Resume instead of Pause |
| Remove keyboard listener cleanup | Two active keydown/keyup listeners instead of one after effect replay |
| Remove animation cancellation | Two pending animation callbacks instead of one after effect replay |
| Throw an asynchronous browser error | Awaited page-safety teardown reports the captured sentinel exception |

These controls fail on direct assertions, not unrelated navigation timeouts.

## Boundaries for the next milestone

- `core/simulation.ts`: readonly player IDs, teams, 0–99 speed abilities, input
  vectors, possession and match snapshots. A pure `step` advances exactly 1/60 s.
  World units are yards. Current physical speed is `4 + rating / 20` yards/s;
  this is an arcade tuning rule, not a franchise simulation formula.
- `core/clock.ts`: browser-free fixed-step accumulator. Different ordinary display
  frame rates produce identical snapshots for the same per-tick inputs. A frame
  gap above 100 ms is capped deliberately; a suspended browser does not catch up
  minutes of gameplay. This is not cross-machine networking determinism.
- `browser/`: input/lifecycle adapter, Canvas renderer, small React HUD. Browser
  time and keyboard events enter here; gameplay never imports React or the DOM.
- `tests/`, `e2e/`: deterministic core contracts and real keyboard interactions.

Later work can add ball flight, contact/tackling and explicit play phases to the
core, consuming commands and returning snapshots/events. Franchise roster mapping
and authoritative online result acceptance are separate future integration work.
