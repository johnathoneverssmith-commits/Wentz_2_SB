# Group 08: cleanup (run last, after groups 01 to 07 have merged)

Read `00-brief.md` first. Branch `feat/ui-cleanup`. **Do not start until every other group's PR is merged**
(check `gh pr list --state all`). You own the shared files. This group removes what the redesign left behind
and fixes the architecture so future screens are cheap. No visual change is the goal: every screen must look
**pixel-identical** before and after except where this file says otherwise.

## Tasks

1. **Remove dead CSS.** `theme.css` (about 2,300 lines), `design-system.css`, `dashboard.css`,
   `decisions.css`, `shared-presentation.css`, `app-shell.css`, `unit-cards.css`, `gamecast/*.css`, `journey.css`
   still hold rules for the old dark pages. For each selector, `grep -rn` the class in `src` (including
   template strings and `className={...}` expressions) and in `e2e/`. Delete rules whose classes no screen
   renders. Do it in small commits by file so a mistake is easy to find. Keep: base resets, the sidebar and
   shell, the rules that dialogs and the standalone build still need.
2. **Prove no visual change.** Before you start, capture full-page screenshots of **every route** (use
   `ScreenGallery` or the route list in `App.tsx`; use fixtures for the stages that need a league in a given
   stage) at 1440, 390 and 320 with reduced motion, and the same after each commit. Pixel-diff them (see how
   the roster extraction was proven: identical at every size and tab). Differences must be zero, or each one
   explained.
3. **One token layer.** Today the page tokens (`--page`, `--panel`, `--ink`, ...) and the gameday tokens
   (`--gd-*`) both exist, and every screen redefines the old ones inside `.gd`. Promote the gameday tokens to
   `:root`, point the old names at them, then delete the redefinition block and the modal-scrim exclusion
   from `gameday.css`. If a dark page still exists anywhere, stop and report it.
4. **One page shell.** Move every screen still using `<div className="roster-workspace gd">...` to `GdPage`.
5. **Dev screens.** Convert `ScreenGallery` and `VisualLab` (dev-only: `/gallery`, `/visual-lab`) or delete
   them if nothing uses them (check `App.tsx`, `import.meta.env.DEV` and the rail link).
6. **Delete unused components and assets**: `OvrPill` variants, `PlayerPortrait` uses that no screen renders
   (portraits are gone from lists; the player card can still use them), `art/franchise/*` images if unused,
   `JourneyGuide` leftovers, `journey.css` rules for deleted cards. Confirm each by search.
7. **Tests.** Every e2e spec selector must still resolve. Remove or update tests that assert deleted markup
   only after confirming the behaviour they guard is covered elsewhere.
8. **Docs.** Update `CLAUDE.md` with a short "UI design system" section: where the tokens and blocks live,
   the rule about shared files, the verification matrix, the photo credit requirement, and the pinned data
   files. Keep `howItWorks.ts` true.
9. **Retire these prompts.** Add `docs/ui-redesign/README.md` marking the redesign complete and pointing to
   the CLAUDE.md section.

## Acceptance

All of `00-brief.md` section 8, plus the full pixel-diff report (route by route, three widths), the CSS size
before and after, and a list of every rule you kept that looked dead and why.
