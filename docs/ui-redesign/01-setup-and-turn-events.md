# Group 01: setup and the turn-based stages

Read `00-brief.md` first. Branch `feat/ui-setup-stages`. Open a draft PR to claim it. Suggested split: one PR
for League Setup (large, special: no team yet), one PR for the rest. Both are fine; say which you did.

## Screens

| Screen | File | Route | Lines |
|---|---|---|---|
| League Setup | `screens/LeagueSetup.tsx` (+ `components/journey/UniversePicker.tsx`, `SetupSeed.tsx`) | `/setup` | 651 |
| Coaching draft room | `screens/CoachingDraftRoom.tsx` | `/coaching-draft` | 482 |
| Coaching draft summary | `screens/CoachingDraftSummary.tsx` | `/coaching-draft-summary` | 277 |
| Training camp | `screens/TrainingCamp.tsx` | `/training-camp` | 219 |
| Training camp results | `screens/TrainingCampResults.tsx` | `/training-camp-results` | 191 |
| Hooded Figure encounter | `screens/HoodedFigureEncounter.tsx` | `/hooded-figure` | 197 |
| League developments | `screens/LeagueDevelopments.tsx` | `/league-developments` | 161 |
| Checkpoint ("the only place a league waits") | `screens/Checkpoint.tsx` | shown at every check-in | 267 |

Already done, do not touch: the drafts, free agency and trade screens (`DecisionFrame`).

## Per-screen notes

- **League Setup** is the one screen with **no team yet**. `GdPage code={undefined}` and the masthead must
  look right with no team (neutral colour, a generic skyline), then take the colours of the team the person
  has picked. It holds: a Lobby tab (the 32 team tiles grouped AFC/NFC by division, the GM lobby, GM identity
  select, the league profile) and a League Settings tab (universe picker, seed, format, GM count, fantasy
  draft, draft type, difficulty, talent impact, manual picks), then "I'm ready to begin" through
  `ReadinessGate`. Device suggestion: the team picker as a ruled league board where each tile is a team-colour
  block. **`e2e/specs/journey-usability.spec.ts` and `fixtures.spec.ts` select by exact accessible names**:
  heading "League Setup", tabs "Lobby" and "League Settings", the "Fantasy draft" group's combobox, textbox
  "Seed", buttons "Create league with this universe" and "I'm ready to begin", team buttons named like
  `Baltimore Ravens — available`, region "League profile", the "Creating solo league" dialog, `.team-tile`
  and its `:enabled` state. Keep all of them exactly. Online setup (seats, invite code, locked states while a
  league is being created) must keep working: read `SetupCreationNotice` and the pending-creation lock.
- **Coaching draft room** is a turn-based event (one order, one turn). It is not one of `DecisionFrame`'s kinds
  (`draft`, `market`, `trade`). Either add a `coaching` kind to `DecisionWorkspace.tsx` (a small additive shared
  change: make it its own PR first and say so) or build it on `GdPage` and the shared blocks. Keep
  `CommissionerTakeTurn`, `CoachDetailsModal`, `StageLoading`, the clock, "Hire …" buttons (specs click
  `/^Hire /`), and the online guards. Specs: `journey-usability`, `transaction-shortcuts`,
  `visual-accessibility`, `save-reload`, `fixtures`.
- **Coaching draft summary**: staff review plus `ReadinessGate`. Specs expect the heading "Coaching Draft
  Summary" and the button "Advance to Training Camp".
- **Training camp**: focus pickers (buttons named like `Quarterbacks …` and `Defensive line …`) and the
  submit button "Advance to End of Training Camp". It runs camp once and cannot be undone: keep the warning
  and the disabled and refused states exactly (specs test a refused step and a retry).
  **Training camp results**: "See Your Results", "Advance to Re-order Depth Chart".
- **Hooded Figure**: a dark-comedy catch-up offer that only a long-losing human team sees. The numeric stepper
  is deliberate (every reachable amount is legal); keep it. This screen is the one place a deliberate tonal
  exception is allowed: you may invert the page to ink with the accent, as long as it still uses the system's
  type, rules and controls and passes the section-6 checks. `offseason.spec.ts` covers it.
- **League developments**: league-wide news list, the same for every human, ordered by tier then team code.
  Do not personalise it.
- **Checkpoint**: tells you who the league is waiting on, when the clock runs out, and gives the commissioner
  a way to move on. Specs: `decision-online-ui`, `transaction-shortcuts`. Online-only states (waiting list,
  take back check-in, commissioner pause and resume from PR #77) must all keep working and stay legible.

## Acceptance

All of `00-brief.md` section 8, plus: every spec named above passes in CI; League Setup works with no team,
with a team, mid-creation (locked) and online; the setup flow can be completed by keyboard alone.
