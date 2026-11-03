# UI redesign: shared brief (read this first, every time)

You are converting screens of the Wentz 2 SB franchise UI (`ui-source/`, React + Vite) to the **gameday
design system**. The system is built, merged and in use on 16 screens. Your job is to convert one group of
the remaining screens to it, with no behaviour change. Read this file, then your group's file, then
CLAUDE.md at the repo root. Do not redesign the system and do not invent a new look.

## 1. Where things stand (master f7c9a85)

Converted and merged (use them as worked examples):

| Screen | File | Notes |
|---|---|---|
| Roster & depth chart | `screens/RosterCapManagement.tsx` + `components/roster/gameday.css` | the reference screen (PR #78) |
| Weekly team hub | `screens/WeeklyTeamHub.tsx` + `components/dashboard/dashboard-gameday.css` | stat strip, season timeline |
| Coaching Staff | `screens/CoachingStaffHub.tsx` + `screens/people-gameday.css` | ruled cards, rating bars, hiring rows |
| Schedule, League Stats, Player Statistics, League Rosters, League History | `screens/office-gameday.css` | compact masthead, selects, own-team row |
| Draft rooms, free agency (board, turns, summary), trade (proposal, deadline room, summary), fantasy draft summary | `components/decisions/DecisionWorkspace.tsx` (`DecisionFrame`, `DecisionHeading`) + `decisions-gameday.css` | converted through one shared frame |

Everything else is yours to convert, in the group files next to this one:
`01-setup-and-turn-events.md`, `02-game-days.md`, `03-gamecast.md`, `04-postseason-bracket.md`,
`05-season-end.md`, `06-online-lobby.md`, `07-overlays-and-chrome.md`, then `08-cleanup.md` last.

## 2. The design language

A **light page** (paper `#eef2f5`, white cards, ink `#0b1b2e`, muted `#4e5f70`) inside the dark app shell
(the navy sidebar is already converted and shared). One **team-coloured masthead** with the team's stadium
photo (17 teams) or a drawn skyline (the rest), huge condensed uppercase type. **One accent** (orange; yellow
on red and orange teams) for the selected thing and the primary action only. **Square corners, 2px ink
rules, hard offset shadows** on the selected row and the main card. No blur, glass, gradients as decoration,
glows, rounded cards, decorative icons or arrows, emoji, or player faces. Type: **Big Shoulders Display**
(condensed uppercase, 800/900) for names, headings, numerals, tab labels; **Hanken Grotesk** for everything
else. Tabular numerals. Plain sentence-case copy, no tracked all-caps eyebrows, no "A · B · C" strings.
Nothing under 11px. Structure carries information: ruled lists, a big numeral at a row's edge, ledgers with
dotted leaders, bars scaled to real values, grades as plain letters.

**One graphic device per screen** that carries information (the roster has the cap drawn as a football
field; the hub has the season timeline; the bracket should be a bracket). Everything around it stays quiet.

## 3. Building blocks (all in `ui-source/src/design/`; read the source before using)

- `GdPage` : the page shell. `<GdPage code={teamCode} className="…">` gives the light page, the team's CSS
  variables and the one-column grid. Older screens use `<div className="roster-workspace gd"><div className="gd-page">`
  with `style={gdStyle(code)}`; either is fine, prefer `GdPage`.
- `GameDayMasthead` : `code`, `title` (small line), `sub`, `actions`, `compact` (shorter band for screens
  that are not the team's front page), `heading` (the big type in place of the team's name, for league-wide
  screens). Stadium photo with required credit line, skyline fallback.
- `teamArt.ts` : `gdStyle(code)`, `mastheadPalette(code)` (contrast-safe colours for every team), stadium
  photo credits. Never throws for an unknown team code.
- `gameday.css` : tokens (`--gd-team`, `--gd-accent`, `--gd-ink`, …), masthead, `.gd-hub` tabs, card and
  ledger, `.gd-btn` (`.gd-go`, `.gd-cut`, `.gd-small`), notices, footer, readiness gate, dialog rules, phone rules.
- `gameday-blocks.css` : stat strip (`.ticker`/`.stat`), `.ui-surface` cards, `.ui-section-heading`, `.stbl`
  tables, meters, `.subhead`, `.gd-tabbed` (tab bar + open panel as one ruled block), `.gd select`, own-team
  table row, `.povr` square rating block, `.ppos`, 44px phone targets for links and tabs.
- Screen-level CSS: add **one new file per group** (like `office-gameday.css`, `people-gameday.css`,
  `decisions-gameday.css`) for rules that belong to your screens only.
- `DecisionFrame` / `DecisionHeading` (`components/decisions/DecisionWorkspace.tsx`): the frame for
  turn-based decision screens (kinds `draft`, `market`, `trade`).

Team colour reaches CSS through variables set on the `.gd` element. Do not hard-code team colours.

## 4. Rules learned the hard way (each one broke something)

1. **The rule for shared files.** Do not edit anything under `src/design/` unless your group file says you
   own it. Add rules to your own screen CSS. If you truly need a shared change, make it a small, additive,
   separate PR first, and say so in your PR. Two sessions editing the shared files at once caused real conflicts.
2. **Fonts.** Google Fonts are blocked in CI and offline, and the fallback is much wider than the real
   condensed face. Every layout must survive it. Page and card grids use `grid-template-columns:
   minmax(0, 1fr)`; give flex and grid children `min-width: 0`; tab labels, headings and long names must
   wrap (`overflow-wrap: anywhere`), never `white-space: nowrap` with `overflow: visible`. A wide child
   that sets the page width fails the browser suite's no-sideways-scroll check in CI.
3. **44px touch targets on phones** for every button, link-as-button, tab, stepper, select and `<summary>`.
   Measure with reduced motion on, or after animations settle (a dialog measured mid-animation reads small).
4. **Widths:** 1440, 1280, 1024, 768, 390 and 320. No horizontal scroll at any. Reflow rows by the
   *content column's* width with a container query, not the window width.
5. **Existing list rules.** `theme.css` gives `.rowlist .prow` a 460px minimum width so tables scroll on
   phones. If your rows reflow, override it for your screen.
6. **Check who else uses a class before deleting a rule** (`grep -rn`). The roster's old stylesheet also
   styled the team crest and a cap ring used by other screens; `journey.css` carried setup and drawer rules.
7. **Text and tests.** Playwright's `innerText` sees CSS `text-transform`; `textContent` does not. Do not
   uppercase user data (player names) in CSS if a spec compares it with `innerText`. Never change an
   accessible name, role, `aria-*`, `data-*` or visible label that a spec selects by; read the specs first.
8. **Spoilers.** Never show a GM a result they have not watched: read `visibleGames` / `visibleBracket`,
   never `state.games` / `state.bracket`, in any screen that shows scores or outcomes (CLAUDE.md "off-field
   circuit"). Reveals do not move `state.week`; ask `currentBlock`.
9. **League formats.** A "humansOnly" league has few teams, a different season length and bracket. Use
   `seasonShape(state)`, `bracketRounds(b)`, `roundLabelFor`, never fixed constants or `ROUND_ORDER`.
10. **Methodology tab.** The floating tab is on the right edge on desktop (keep the page 40px clear) and a
    bottom-left label on phones (the Unit Grades button owns bottom-right). Keep bottom padding clear of it.
    Do not add other fixed corner controls.
11. **Photos and credits.** Stadium photos are openly licensed with a **required visible credit line**.
    Never remove it. Seven are CC BY-SA, so a tinted or cropped copy stays share-alike.
12. **Pinned data.** `ui-source/src/data/teams.ts` and `pool-2026.json` are inputs to the e2e fixture leagues:
    editing either changes every fixture's hash. Keep colour helpers private to a presentation module.
13. **Dialogs stay dark until the overlays group runs.** The page tokens are scoped so modals keep their own
    dark styling (`:where(.gd-page > :not(.modal-scrim))`). Do not restyle shared modals in a screen PR.
14. Keep every behaviour, rule check, deep link and test hook. Restyle; do not drop a control, column or flow.
    Do not change game logic, the simulation, the schema, CI or dependencies. If a design needs a number
    the game does not compute, say so and propose a source; never invent data.
15. If you change what a mechanic says on screen, `state/howItWorks.ts` must stay true (you should not be
    changing mechanics).

## 5. Process for each screen

1. Read the screen, its CSS, its tests, and every e2e spec that touches it (`e2e/specs/`, grep for the route
   and the visible labels). List every control, state, empty state, error, locked and online variant, and
   deep link. Run its tests first for a baseline.
2. Reach it. Quick path: League Setup, pick a team, set Fantasy draft to Off in League Settings, "I'm ready
   to begin", then navigate by hash. For deeper stages use the fixtures in `e2e/fixtures/build.ts`.
3. Capture **before** screenshots from one saved league at 1440, 390 and 320.
4. Build on the shared blocks. Keep logic and data paths untouched. Keep names and ARIA.
5. Verify in a real browser (section 6). Do not claim visual correctness without having looked.
6. Update or add tests for meaningful behaviour; never weaken or re-pin an expectation to make a failure
   disappear. Update e2e specs that asserted old markup.
7. Capture **after** screenshots from the same league at the same sizes.
8. Run `wentz-verify` (skill in the repo): typechecks, UI build, direct and related UI tests, the full UI
   suite. The advisory Chromium suite runs only in CI (Playwright is not installed locally): read failures
   with `gh run view <id> --log-failed`; fix real regressions; show unrelated ones are unrelated.
9. Review the full diff for accidental data changes, generated files, unrelated edits. Commit with
   `git commit -F <file>`, push, open the PR (base `master`), check CI on the final commit.

## 6. Verification matrix (do all of it; say what you could not do)

- **No sideways scroll:** `scrollWidth <= clientWidth` at 1280, 1024, 768, 390, 320, on every tab and state,
  with (a) real fonts, (b) Google Fonts blocked, (c) a wide font forced (`Verdana`, then `"Courier New"`).
- **Touch targets:** at 390, no button, link, tab, select or summary under 44px (exclude the photo credit).
- **Team colours:** check a dark team (CHI), a gold team (PIT), an orange team (CIN), a black team (LV), and
  one team with a photo and one without.
- **Keyboard:** Tab reaches everything in a sensible order with a visible focus ring; Enter and Space work
  on custom buttons; Escape closes dialogs and returns focus to the opener.
- **Motion:** correct with the app's motion setting off and `prefers-reduced-motion`.
- **Contrast:** AA (4.5:1) for text on every team colour; the sidebar text is already 7.8:1 or more.
- **No console errors**, and no network requests outside the app.
- **Neighbours:** open two other screens that share anything you touched.

Machine notes that cost time before: in the in-app Playwright browser, `localhost` can carry a stale page
zoom that makes `innerWidth` double; use `http://[::1]:<port>` and `deviceScaleFactor: 2`. Screenshots can
only be written under the allowed roots (the main checkout and its `.playwright-mcp` folder). To reuse a saved
league in a fresh browser context, copy its `localStorage` (`nfl-sim-ui.league`) in with `addInitScript`.
A full-page screenshot draws fixed elements (the Methodology tab, the sticky rail) in the middle: that is
a capture artefact, not a bug.

## 7. Working in parallel with other agents

- Before you start: `git fetch`, `gh pr list --state all`, `git branch -r`, and list other sessions. Read
  what is already claimed. **Do not start a screen another branch or PR already covers.**
- Claim your group at once: create your branch (`feat/ui-<group>`), push it, and open a **draft PR** titled
  with the group name. Other agents read that to avoid you.
- Work in your own git worktree off `origin/master` (`git worktree add -b feat/ui-<group> ../nfl-franchise-sim-<group>
  origin/master`), link `node_modules` (root and `ui-source`) from the main checkout, never switch a shared
  checkout's branch, and never revert or edit another agent's files or worktree.
- Touch only the screens in your group plus your own new CSS file. Rebase on `master` before you open the PR.
- If a PR for a group merged since you started, rebase and re-check your screens against it.
- Never merge, deploy, force-push or run a workflow unless the user asks in this conversation.

## 8. Definition of done (per PR)

- Matches the roster screen's language: light page, masthead, one accent, square ruled components, Big
  Shoulders + Hanken, no decorative icons, faces or glows, one purposeful graphic device per screen.
- Every behaviour and every piece of information preserved; all required CI checks green; the advisory
  browser suite green or each failure explained and shown unrelated.
- Section 6 passed, with before/after screenshots at matching sizes attached to the PR and an honest list of
  what could not be verified.
- PR description: what changed and why, which shared blocks it used, which neighbouring screens could be
  affected and how you checked them, the check table (PASSED / FAILED / SKIPPED / NOT RUN), screenshots,
  licensing notes if imagery changed, and anything the user must decide. Do not call it merge-ready while a
  required check or a material regression is open. **Do not merge it.**
