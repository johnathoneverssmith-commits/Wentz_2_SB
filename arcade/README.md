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

**CI limitation:** existing standard CI still checks the franchise, not arcade.
Its root/UI Vitest includes and browser workflow path filter do not discover this
module. No shared CI or `wentz-verify` allowlist has been changed. Before relying
on GitHub for arcade coverage, separately approve an advisory Ubuntu job invoking
this explicit verification command. A green standard check is not arcade evidence.

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
