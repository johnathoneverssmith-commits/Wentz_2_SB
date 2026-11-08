# Visual & accessibility audit harness

Browser-based audit of the main franchise UI: what a player sees, at five widths, for several franchises, under
blocked fonts, reduced motion and keyboard-only use, with a structured defect register. **Harness only**: it changes no
gameplay, engine, schema or data, and it is not part of CI or of `npm run e2e`.

```bash
npm run audit:selfcheck     # no browser, no build: the harness checks its own policy (seconds)
npm run audit:typecheck
npm run audit:visual        # the full audit (long: it plays one league per franchise)
npm run audit:register      # group the run's records into e2e-audit/audit-output/<run>/DEFECT_REGISTER.md
```

Needs Playwright's Chromium (`npx playwright install chromium`). On a machine whose Chromium is not the build this
Playwright version downloads, set `AUDIT_CHROMIUM_PATH` (for example `/opt/pw-browsers/chromium`).

## Narrowing a run

Every list can be limited; a narrowed run is stamped `NARROWED RUN` in `run.json` and in the register, so it cannot be
mistaken for the baseline.

| Variable | Default | Example |
|---|---|---|
| `AUDIT_TEAMS` | all 10 (`matrix.ts`) | `BAL,CIN` |
| `AUDIT_VIEWPORTS` | `1440,1280,768,390,320` | `390,320` |
| `AUDIT_CONDITIONS` | `baseline` | `baseline,fonts-blocked,reduced-motion` |
| `AUDIT_SCREENS` | all | `hub-week-9,bracket` |
| `AUDIT_OUT` | `e2e-audit/audit-output/local` | `/tmp/audit-1` |
| `AUDIT_DSF` | `1` | `2` for screenshots a person will read |
| `AUDIT_MASTER_SHA` | none | the exact master SHA, recorded in `run.json` and the register |

## What guarantees nothing real is touched

* The network is sealed by the functional suite's guard (`e2e/support/guard.ts`): only this run's own loopback UI origin
  is reachable. The engine adapter, the league API, deployed sites and WebSockets are aborted. With `fonts: real`, exactly
  `fonts.googleapis.com` and `fonts.gstatic.com` are served from a disk cache fetched by this process.
* Every test gets a fresh browser context; the league lives in that context's `localStorage` and dies with it.
* Leagues are played headless through the game's own stage machine by `e2e/fixtures/build.ts` (seeded, fixed clock,
  engine adapter unreachable), one per audited franchise (`--team`, added for this harness; default output unchanged).
* Online screens run on a route handler (`support/online-league.ts`, `support/lobby-api.ts`); action calls are refused.
* Variants (`support/variants.ts`: long names, partial reveal) change a **copy** of a save in memory.
* `harness-selfcheck.spec.ts` fails if a harness file imports app/engine/server code or writes outside its output.

## Layout

| File | Role |
|---|---|
| `support/matrix.ts` | viewports, franchises (with why each is in), conditions, run scope |
| `support/screens.ts` | the screen catalog: route + fixture + inventory group + state |
| `support/probes.ts` | in-page measurements: overflow, clipping, targets, names, headings, contrast; focus walk; running motion |
| `support/audit-test.ts` | the test object: context per viewport/condition/team, `capture()`, record writer |
| `support/known-exceptions.ts` | deliberate deviations, each with a citation (shown as "accepted", not hidden) |
| `support/register.ts` | severity policy, grouping by root cause, manual-entry schema, markdown |
| `specs/capture.spec.ts` | every screen x viewport x franchise (palette sweep for non-primary franchises) |
| `specs/conditions.spec.ts` | fonts blocked, wide/mono fallback faces, reduced motion, keyboard, long text, dense table |
| `specs/online-states.spec.ts` | lobby states, CommissionerTakeTurn in each context, partial-reveal spoiler probe, corrupt save |
| `specs/harness-selfcheck.spec.ts` | browser-free checks of the harness itself |
| `scripts/build-register.ts` | records + `defects/manual.json` -> `DEFECT_REGISTER.md` / `defect-register.json` |

## Defect register

Severity: **S1** blocker (cannot proceed, spoiler, unreadable) - **S2** high (fails WCAG AA for some players) -
**S3** medium (below the product's own bar) - **S4** low. Probe findings are grouped by *rule + element signature* across
every screen, team and width, so one CSS root cause is one entry with a count. Each entry has: screens, teams, viewports,
expected, actual, numbered reproduction steps, proposed fix, evidence screenshots and status. Things a probe cannot
measure (a misaligned masthead, a confusing state) go in `defects/manual.json`; `validateManual` rejects an entry
without reproduction steps, evidence and a fix.

## Known gaps (stated, not hidden)

* **Fantasy-draft take-turn:** the `fantasy-draft` fixture is saved before the draft starts, so the commissioner's control
  has no turn to attach to there. It is covered in the coaching draft, trade deadline and free-agency board.
* **Spoiler probe blind spots:** it matches final scores (larger side >= 10) of unrevealed games in visible text. It does
  not yet check standings/records, injuries, or the bracket's unrevealed rounds; those need selectors from the finished
  screens. It serves the block unredacted (worst-case server) so the client's own filters are what is tested.
* **Overlays beyond the dossier** (How It Works dock, coach details, stats modal, contract negotiation, full-screen
  overlay) have no scripted opener yet; selectors are confirmed against the final redesign before they are added.
* **Hooded Figure encounter, League Developments and Checkpoint with content** are not reachable from the fixtures
  (noted in PR #84); they need a fixture variant.
* **Real multi-GM play, push notifications and the live league server** are not exercised: no database or account exists
  here by design.
* **Contrast over images/gradients** is reported as indeterminate (counted per capture), not guessed; masthead photo text
  needs a manual look or a sampled-pixel check.
* **Forced-colors / high-contrast mode, 200% zoom and screen-reader output** are not automated.
