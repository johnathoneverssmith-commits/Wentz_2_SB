# UI-4 Draft, Free Agency and Trade Implementation Plan

> For agentic workers: use superpowers:executing-plans for implementation in this chat after the design checkpoint; retain one independent whole-branch review, not a Codex PR-review request.

Goal: implement the authorized UI-4 brief with distinct desktop/mobile layouts over existing game rules and mutations.
Architecture: presentation-only workspaces, explicit public player view models and shared action handlers. Local sorting, comparison and selection never enter saved league state.
Tech stack: existing React/TypeScript, CSS and Framer Motion; Vitest and Playwright. No new dependencies.
Spec: docs/frontend-ui4/audit-and-design.md and the user's pasted UI-4 brief.

## Global constraints

- Preserve all state/sim/server/API/schema/gameplay/acceptance/trade validation code; no arcade or UI-5 changes.
- Single branch and final PR from current master; no force-push, Codex review request, merge or deploy.
- Privacy allowlist excludes raw Player.potential, prospect.trueOverall, other-GM targets and unrevealed results.
- Browsing/Cancel must not mutate saves. Offline and online use existing useLeagueActions and busy guards.
- Use UI-3 components, artwork and motion tokens; 1100px desktop, below 700px focused mobile, tablet in between.
- Same mutations/data on both layouts. Preserve old-save standing-market compatibility and checkpoint-specific rules.

## Task 1 — public decision workspace

Files: create ui-source/src/components/decisions/DecisionWorkspace.tsx, decision-view.ts, decision-view.test.ts, decisions.css.
Consumes: UI-3 TeamCrest/SportsIcon, existing MotionSurface/MotionMeter/useMotion and formatting helpers.
Produces: workspace/context composition, public comparison view and stable sorting helper for all screens.
Public view fields: id/name/position/rating/ratingLabel/age/context; optional authorized ask and preference labels supplied by the caller. No raw domain object is spread into comparison UI.
Sort interface: sortDecisionRows<T extends {id:string;name:string;rating:number;age:number}>(rows:readonly T[], sort:'board'|'name'|'rating'|'age'):T[]. Board order is unchanged; name ascending, rating descending, age ascending, stable ties.

- [ ] Write failing tests: input order remains unchanged; ties stable; filtering/sorting reaches a low-ranked requested position before limit; equal names remain distinct by ID; sentinel hidden fields cannot appear in public view markup.
- [ ] Run the specific UI test file and observe the missing behavior fail.
- [ ] Implement only these presentation contracts and shared responsive surfaces, then pass the focused tests.

## Task 2 — draft board and confirmation

Files: modify screens/DraftRoom.tsx; create components/decisions/DraftDecision.tsx if needed to keep composition readable; create e2e/specs/decision-workflows.spec.ts draft cases.
Consumes: task 1; existing Available mapping, pick(id), draft state, roster needs, unitReport and PlayerStatsModal.
Produces: local selection/two-ID comparison, sortable board, upcoming/recent picks, shared selected-player confirmation; mode-specific public scouting and mobile cards.

- [ ] Add a failing browser case for selecting a specific player, cancelling confirmation without a saved-state change, confirming once, exact ID/ownership/pick progression and reload. Run on the old interface to prove the missing confirmation/layout path fails.
- [ ] Add unit tests for stale selected ID and turn changes; ensure the confirmation cannot submit a departed player or for another GM.
- [ ] Compose the desktop board/context and mobile focused view without changing pick(), AI sweep, stage redirects, overlays, stars or commissioner action eligibility.
- [ ] Derive fantasy unit context from drafted results only through the existing selector, with an explicit incomplete-roster label; do not alter stored roster ownership.
- [ ] Update existing draft browser interactions only for the new confirmation, keeping every ownership/uniqueness/progression assertion. Pass draft and new focused cases.

## Task 3 — free agency

Files: modify screens/FreeAgencyBoardTurns.tsx and FreeAgencyBoard.tsx; add presentation components under components/decisions as justified; extend decision-workflows.spec.ts.
Consumes: task 1; existing OfferDialog/ContractNegotiation, expectedSalary/standingAsk, leadingOffer, FREE_AGENCY_ROUNDS, act and existing handlers.
Produces: desktop market/offer workspace; mobile cards/focused offer, public comparisons/search and clear pending/result states.

- [ ] Add failing tests for search/selection/compare being read-only; offer focus and Cancel; exact submitted player/salary/years and round progression after reload on desktop and phone.
- [ ] Implement presentation with the same offer form state and submit callback, preserving salary bounds, five rounds, binding offers, staff/pass/skip, cap suspension and sign-versus-bid distinctions.
- [ ] Fix only presentation-owned focus/scroll reduced-motion behavior if needed. No change to acceptance/pricing.
- [ ] Pass existing free-agency offers, skip and offseason lifecycle browser tests without weakening ledger or transaction assertions.

## Task 4 — trade workbench and deadline

Files: modify screens/TradeProposal.tsx (including exported TradeColumn) and TradeDeadlineRoom.tsx; extend decision-workflows.spec.ts and focused presentation tests.
Consumes: task 1; existing give/get/partner state, pick identifiers, checkTrade/evaluateTrade/tradeUnitImpact and existing action handlers.
Produces: desktop dual asset panels and review; mobile Your assets / Their assets / Review navigation with shared selection and payloads.

- [ ] Add failing tests: select player/pick by exact ID; switch mobile panels without losing selections; summary matches selected asset IDs; Reset/partner change retain existing behavior; submit result and reload; wrong-turn and frozen-stage actions cannot send.
- [ ] Render native labeled selection controls with bounded searchable lists and exact asset summaries, preserve proposal/withdraw/respond/vote and deadline propose/counter/final controls.
- [ ] Reuse existing legality, AI assessment and unit report; show human status as their decision. Show cap information only through existing authoritative helpers and distinguish suspended checkpoint limits.
- [ ] Pass trade/unit presentation tests; confirm a stale/refused server response remains visible and busy refs prevent duplicate requests.

## Task 5 — cross-device, multiplayer and final evidence

Files: new focused tests only as needed; screenshots/docs under docs/frontend-ui4/. No workflow or schema edits.
Consumes: completed tasks 1–4, existing deterministic fixtures and HTTP client contracts.
Produces: parity/accessibility evidence, six actual runtime desktop/mobile captures, one final PR and exact-head CI report.

- [ ] Controlled-transport UI tests prove wrong-turn/frozen-stage refusal, selected-identity changes and stale responses; label these as UI evidence, not real server E2E. Existing online CI tests run on ephemeral PostgreSQL and cover rule/authorization behavior.
- [ ] Run 360/390 phone, 768 tablet and 1440/1600 desktop checks: no body overflow, 44px touch targets, keyboard focus/Escape/return, live status and reduced motion. All actions remain reachable on each layout.
- [ ] Run engine typecheck/tests, UI typecheck/full tests/build, browser/fixture typechecks, focused browser suite and complete Ubuntu Chromium suite. Run selected related/online checks when the actual diff requires them, with explicit isolated test DB authorization only.
- [ ] Read real logs, report all failures/skips/retries. Existing test assertions may change selectors/confirmation steps, never business oracles to accommodate wrong behavior.
- [ ] Capture desktop/mobile draft, FA and trade views from actual game state. Keep all generated reports and temporary server/database resources out of the commit; clean owned resources only.
- [ ] Inspect own diff against current master, refresh normally if needed; preserve unrelated branches/worktrees. Freeze, verify, commit/push normally and open one UI-4 PR with SHA, captures and limitations. Inspect exact-head standard test/deploy-skipped and Ubuntu actual test counts. Stop for separate merge authorization.

## Review focus / acceptance gates

1. No sentinel hidden potential/trueOverall or another GM's private data reaches the visible UI.
2. All candidates/picks remain reachable after filters, with limits/counts explicit; shared sort state does not mutate source arrays or saves.
3. Confirmation and offer state invalidates safely on live turn/selected-ID changes, with one mutation per actual submit.
4. Ordinary trade and deadline cap/vote/counter rules stay separate; no invented financial projections or valuation.
5. Exact desktop/mobile player/asset payload parity and persistence; no weakened existing lifecycle oracles.

Baseline audit: UI typecheck passed; 5 existing RosterFinance tests passed. Implementation/full-suite/current-head CI results are intentionally not claimed before execution.
Builder check of the design: nothing important left; the remaining layout details are presentation decisions within the supplied brief.
