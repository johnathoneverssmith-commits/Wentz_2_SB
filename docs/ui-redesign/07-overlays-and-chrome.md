# Group 07: dialogs, drawers, docks, notices (the overlays)

Read `00-brief.md` first. Branch `feat/ui-overlays`. Open a draft PR to claim it. **You own the shared overlay
styles**: this is the one group allowed to add a new shared file, `src/design/overlays.css`, and to edit the
`.modal-*` rules. Everything else in `src/design/` still follows the brief's section 4 rule 1. Because overlay
styles are global, your change touches every screen: check at least six of them (one per other group).

## What is still the old dark style

Pages are light; these are not, and they now sit oddly on top of a light page:

| Piece | File | Notes |
|---|---|---|
| Player card dialog | `components/PlayerStatsModal.tsx` | already has a `portrait` prop (off on the roster page) |
| Contract negotiation (extension, free-agent offer) | `components/ContractNegotiation.tsx` | steppers, offer summary, "Their read" |
| Coach details | `components/CoachDetailsModal.tsx` | |
| Confirm decision, focused offer panel | `components/decisions/DecisionWorkspace.tsx` | shared with the decision screens |
| Methodology drawer (How It Works) and its tab | `components/HowItWorksDock.tsx` | `.how-tab`, `.how-drawer`, tabs inside; the tab is already restyled |
| Unit Grades dock and drawer | `components/UnitGradesDock.tsx`, `UnitGrades.tsx`, `unit-cards.css` | |
| Score reveal moments / full screen overlay | `motion/ScoreMoment.tsx`, `components/FullScreenOverlay.tsx` | keep the motion, restyle the surface |
| Turn alerts, update available, setup creation notice, roster repair notice | `TurnAlerts.tsx`, `UpdateAvailable.tsx`, `journey/SetupCreationNotice.tsx`, `RosterRepairNotice.tsx` | |
| Loading and error boundary | `StageLoading.tsx`, `ScreenBoundary.tsx` | |
| Save backup / restore controls in the rail | `SaveBackup.tsx` | |
| Rail sub-parts: league wire, turn clock | `LeagueWire.tsx`, `TurnClock.tsx` | inside the already-converted sidebar |
| Global dialog rules | `theme.css` (`.modal-scrim`, `.modal-card`, `.modal-head`, `.modal-body`, `.modal-foot`, `.neg-*`) | |

## Direction

Convert every overlay to the system: a **light ruled card** over a dimmed scrim (square corners, 2px ink border,
a hard offset shadow, a condensed uppercase title, plain footer buttons with the accent for the one primary
action), drawers as ruled panels sliding in from the right with the same border. The page's token scope
currently excludes `.modal-scrim` on purpose (`:where(.gd-page > :not(.modal-scrim))`); give overlays their own
explicit light tokens so they look the same whether they render inside a page or portal to `document.body`
(the drawers and docks portal; check both).

## Rules specific to overlays

- **`useDialog` (`components/useDialog.ts`) owns focus**: focus moves in, is trapped, Escape closes, and
  focus returns to the opener. Do not change that behaviour; test it for every dialog.
- Keep every accessible name, role, `aria-*`, and every spec selector: specs find dialogs by name
  (`Methodology`, `Creating solo league`, the player card, the extension offer) and click `Close`, `Cancel`,
  `Submit offer`, the stepper buttons (`More base salary / yr`, ...).
- The 44px rule is a **spec requirement** for dialog controls on a phone (`roster-presentation.spec.ts`
  measures a stepper, after animation). Keep it. Dialogs must fit a 390x844 screen and a 320x568 screen with
  their own scrolling body and footer always reachable.
- Scrim opacity, outside click to close, and Escape must behave as they do now.
- Keep the confirm for destructive actions; never auto-focus a destructive button.
- No portraits in dialogs on the roster page; keep the existing `portrait` prop behaviour.
- The offline-ready standalone build opens from `file://`: nothing may depend on a remote font or image.

## Acceptance

All of `00-brief.md` section 8, plus: a contact sheet of every overlay in the new style at 1440 and 390;
keyboard path (open, Tab trap, Escape, focus return) verified for each dialog and drawer; `roster-presentation`,
`journey-usability`, `decision-workflows`, `free-agency-offers` pass in CI. Then, with the other groups landed,
the exclusion in `gameday.css` for modal scrims can be removed in the cleanup group, not here.
