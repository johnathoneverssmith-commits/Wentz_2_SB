# Group 08 report: final UI cleanup

Branch `claude/kind-johnson-nf6kyy`, draft PR. Local results are not CI; CI is the authority.

## What changed
| Task | Result |
|---|---|
| 1 Dead CSS | 8 files, 69 selectors removed (one commit per file): `app-shell`, `dashboard`, `shared-presentation`, `gamecast`, `gamecast-gameday`, `season-end-gameday`, `theme`, `visual`; plus the dead `.decision-heading` rules. Classes built at runtime (`'decision-' + kind`, `"ui-meter--" + tone`) are kept: a first pass removed some and was reverted. |
| 2 Proof | PR #92 harness (`e2e-audit`), BAL, 1440/390/320, reduced motion, 32 routes x 3 widths = 96 shots, master vs branch, pixel-diffed. `group-08-evidence/pixel-diff-*.tsv`. |
| 3 Tokens | Neutral `--gd-*` tokens moved to `:root`; added `--gd-link`. The remap block stays (see "Dark surfaces remain"). |
| 4 Page shell | Roster, hub, coaching, decision rooms on `GdPage` (now passes `data-*`). Dead `roster-workspace` class gone. |
| 5 Dev screens | `/gallery` and `/visual-lab` on `GdPage`, cross-linked, kept (rail link uses the gallery). |
| 6 Unused | Deleted `GameTitle.tsx`, `art/franchise/player-silhouette.webp`. |
| 7 Selectors | No selector, role, name, aria or data hook removed: e2e 105 passed (see below). |
| 8 Docs | CLAUDE.md "UI design system (gameday)". |
| 9 Prompts | `docs/ui-redesign/README.md` marks the redesign complete. |

CSS bytes (all `ui-source/src/**/*.css`): 303,158 -> 296,699 (-6,459, -2.1%).

## Approved visual corrections (every intentional pixel difference)
- **UI-TAFI-001**: leftover `.decision-workspace .ticker` override in `decisions.css` made the strip near-black. Removed; the light gameday strip shows. Routes: draft, free-agency board/standing, mid-season FA, trade deadline (and the dossier/fantasy-draft shots that start on the draft room). Page height +2px; later content shifts, which is why those shots differ widely. Evidence: `TAFI-001-*.webp`.
- **UI-TAFI-002**: the Fantasy Draft Summary was already on the shell; its overview panel (`draft-summary.css`) was the dark part. Restyled on the tokens (light cards, 2px rules, no glow). Layout and grade logic untouched. **Not in the harness catalogue, so no pixel pair was captured**; verify by eye and with `visual-accessibility.spec.ts` (passes).
- **UI-TAFI-005**: setup-notice links use `--gd-link` (bold, underlined). Setup 390/320 reflow slightly (+82/-61px).
- **UI-TAFI-017**: `.btn-primary` inside `.gd` is the accent colour (was team colour). Visible on Season Complete "Continue" (teal -> orange). Evidence: `TAFI-017-*.webp`. Button shape is unchanged (still rounded there).
- **UI-TAFI-010**: not changed. The dark result card and champion-coloured masthead are deliberate gameday design, not a leftover theme; moving the champion is a layout change, out of scope.

Results: 67 of 96 shots identical; the other 29 are exactly the routes above. Two further diffs (coaching-draft and end-of-season at 390) appeared in the first run and vanished when master was re-captured: baseline noise (rail scroll), not a change.

Contrast probe (harness findings, all 96 shots): 123 -> 114 contrast findings; mid-season FA 5 -> 3, Season Complete 5 -> 4. The remaining findings were there before and are other TAFIs.

## Checks
- `npm --prefix ui-source run typecheck`: pass. UI tests: 166 files passed, 1 skipped (1,020 tests).
- `npm run e2e` (local Chromium via symlinked build): 105 passed, 1 failed, 5 not run. The failure is `cleanup.spec.ts:141` ("process is still running" after a killed server tree), a process-handling test that touches no UI code; it also failed on the first attempt. Needs CI to confirm. The 5 not run are its serial dependents.
- Keyboard/focus: `visual-accessibility.spec.ts` (dossier focus trap, ranking disclosures, scorecards) passes.
- No engine, online, schema, dependency or CI change.

## Dark surfaces remain (reported, per the brief)
The navy sidebar and every dialog/overlay (`overlays.css`) are dark and use the old `--page/--panel/--ink` tokens; `gameday.css` remaps them inside `.gd-page`. The brief's "promote gameday tokens to :root and delete the remap" would turn the shell and dialogs light, so it was not done. Stadium-city art is still referenced by `.decision-workspace .card > .header` and `shared-presentation.css`; kept because I could not prove those rules dead.

## For later phases
Other TAFIs (003, 004, 006-009, 011-016, 018-022); Season Complete layout (010); a harness screen for `/fantasy-draft-summary`; converting dialogs/shell to light tokens, then deleting the remap block.

## Final verification addendum
- **Fantasy Draft Summary (UI-TAFI-002)**: harness catalogue entry `fantasy-draft-summary` added (fixture `coaching-draft`); BAL, 1440/390/320, reduced motion, master vs branch: `group-08-evidence/TAFI-002-*-before-left-after-right.webp`. Harness contrast findings on the route 5 -> 3 at every width, then two of the remaining three (the "GM" tag at 4.29:1 and the "Methodology" summary at 1.40:1) were fixed in the last commit. The third (the `BAL` badge, black on purple, 2.34:1) is the shared `CardHeader` badge on every screen that uses it; not changed here (shared-primitive change, out of scope), left for a later phase. Re-capture after that last CSS fix was not repeated.
- **Dark stat strips (UI-TAFI-001)**: the strip's `.stat-value` and `.stat-label` were measured on draft, free-agency board/standing, trade deadline and mid-season FA at all three widths. After: every value and label is at least 6.57:1 (free-agency standing 5.40:1); the 4.5:1 criterion passes. The "before" figures (`...-UNRELIABLE.txt`) are not valid: that script ignores the old strip's dark gradient background-image and measured against the page, so it reads 5.84 where the strip was visibly unreadable (the audit measured 1.02:1). The criterion rests on the after numbers and the screenshots.
- The harness's own contrast probe never flagged the old strip, so it cannot serve as the gate for this criterion.
