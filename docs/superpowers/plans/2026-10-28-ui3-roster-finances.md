# UI-3: roster and finances

## Base and deployment gate

Master test/deploy run 40740180975 succeeded for c5a20a3b26ae3cbb28352e885f44e4e3617f7099.
The workflow and an independent live metadata read confirmed that exact SHA on UI and API
before implementation. The branch then advanced normally to master
073356d322abd38f6f28b3e4a846e3a483555a80, inheriting Claude's merged work unchanged.
The normal fast-forward update had no conflicts with the frontend files.

## Approved visual direction

Use the supplied cinematic sports-dashboard reference and the approved roster/finance concepts:
an illustrated team header and sidebar, compact colorful icon cards, a depth board beside a
selected-player dossier, a cap donut beside unit allocation, and a contract-selection workspace.
The composition changes what is emphasized; it does not merely restyle the old expanded table.

Ink/teal surfaces, violet/blue/gold accents, clear team identity and restrained glow continue
the design system. All existing navigation remains available; a finance shortcut opens the
existing cap view. The main desktop workspace spans the available width. Mobile stacks the
panels, keeps every player field, and moves to selected-player details after selection.

## Source responsibilities

- AppShell.tsx and sports-shell.css: shared visual navigation, original crown/wordmark treatment,
  icons and a query-aware finance shortcut. Sync, arrival, audio and stage hooks are unchanged.
- RosterCapManagement.tsx: position controls, identity-based selection, dossier composition and
  contract selection. Existing action handlers, eligibility checks, confirmation text and server
  calls are retained. Nudge also retains the selected player's UI identity after reordering.
- SportsPresentation.tsx: original SVG icons, team crest and passive stat cards.
- RosterFinance.tsx: display the supplied cap/contract values. The ring fill clamps geometrically;
  an over-cap text percentage remains above 100%. Coaching costs stay outside the player cap.
- UnitGrades.tsx: a meter for its existing authoritative strength; no grading changes.
- DashboardOverview.tsx: its finance link opens the cap view directly.
- RosterFinance.test.ts and roster-presentation.spec.ts: binding, bounds, real controls,
  persistence, focus, reduced motion, mobile and navigation regressions.

No engine, state, save, online, trade-intelligence, arcade, dependency or deployment changes.

## Artwork and performance

Original artwork was generated for this project: a natural raven header (Baltimore only),
a generic stadium/city atmosphere and an anonymous helmeted athlete illustration. These are
decorative, not real player portraits, official logos or a claimed real city photograph.
Other teams receive the stadium header with their own actual team code/name and theme.
All three runtime WebP files total approximately 339 KB. No runtime external image/font service.

Reuse the existing Framer Motion dependency, MotionSurface, MotionMeter, AnimatedNumber and
shared timing tokens. The ring animates its SVG stroke; meters animate transforms. No per-frame
React state updates or large-list animation expansion. Cap content mounts on tab entry so its
entrance runs when visible. The existing memoized unit report remains unchanged. Closing routes
and dialogs releases effects immediately; no interactive old screen is retained for exit motion.

## Verification and review

1. Unit red/green coverage: absent cap/contract data, supplied contract terms, separate coaching
   costs, and over-cap geometry/text (260 of 255 displays 102%, not 100%).
2. Browser coverage: finance deep link/back/reload and one active nav item; actual player/depth
   identity and persistence; player/extension dialog focus, Escape, editing and Cancel; mobile
   fields/overflow and 44px modal controls; reduced motion and guarded recording.
3. Run browser/frontend typechecks, full UI tests, relevant Chromium and wentz-verify on the
   final tree. Confirm exact-head standard CI and the complete Ubuntu Chromium suite.
4. Inspect desktop/mobile captures and the motion clip. Open a dedicated PR; never merge/deploy.
   UI-4 and UI-5 remain separate.

The dark sidebar overlay protects text contrast over its decorative image. Focus indicators,
dialog focus trap/return and OS reduced-motion precedence remain active. Mobile card labels
restore years remaining that legacy CSS hid; no field is discarded.

Existing limitation, unchanged: the shared negotiation stepper defaults to a $60M salary ceiling
even when a star's opening extension expectation is higher (observed on the earlier baseline
at $60.9M; the updated baseline fixture currently asks less).
A separate rule-aware correction is needed; this redesign does not invent a new limit.
The edit/Cancel regression uses an in-bounds draft offer and proves no contract was changed.

Review captures: [roster](../../frontend-ui3/desktop-roster.png),
[cap](../../frontend-ui3/desktop-cap.png), [mobile roster](../../frontend-ui3/mobile-roster.png),
[mobile dialog](../../frontend-ui3/mobile-contract.png), [motion clip](../../frontend-ui3/roster-motion.webm).
Exact final test/CI outcomes and commit are recorded in the PR description.

