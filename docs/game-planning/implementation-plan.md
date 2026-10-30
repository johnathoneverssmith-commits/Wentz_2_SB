# Command-center game planning implementation plan

> For agentic workers: use superpowers:executing-plans; implement inline, then obtain one independent whole-branch review.

**Goal:** Edit existing offensive pass/run and defensive blitz strategies in the command center, with an automatic engine-grounded preseason comparison against the saved plan.
**Architecture:** Reuse saveGamePlan and requestPlanPreview. Compare two deterministic existing engine estimates on identical inputs, not a second UI probability formula. Debounce requests, serialize work, cache a bounded set within the current immutable simulation-input snapshot and suppress stale responses. Keep all other plan dials intact and link to the full editor.
**Tech stack:** Existing React/TypeScript, CSS tokens, Vitest and Playwright; no dependencies.
**Spec:** User's Agent 5 request, UI-PT-20/UI-PT-21.

## Constraints and findings
- Base: master497d054; clean existing isolated frontend worktree. Branchfeat/command-center-game-planning.
- Never change contracts, CPU decisions, generation, phase rules, schemas, balance or arcade. No merge/deploy.
- Existing previewPlan runs160 paired seeded simulations and converts measured margin shifts to a rounded estimated win chance. Existing endpoint includes real available rosters, depth, staff, weather, talent scale and opponent plan.
- Existing standard-only estimate must be compared with an independently requested saved-plan estimate on the same inputs. Show sampling uncertainty; do not guarantee every change moves a rounded number.
- The standalone offline Mock has no game-plan effect model, and its adapter lives at localhost8787. Never substitute an invented preview or imply unavailable engine behavior. Explicitly disclose this limitation and give a retry; adapter-backed solo and multiplayer already pass saved plans into actual simulations.
- Online blocks already simulated cannot be changed. Save uses existing authenticated action; a preview does not reveal stored results or private opponent plans.

## Review focus
1. Stale responses after plan/opponent/league changes must never appear current.
2. Preview cannot mutate saved state or overwrite advanced dials.
3. Detached sessions and wrong owners cannot save; server refusal must remain visible.
4. No opponent/invalid response/adapter failure means no fabricated probability.
5. Bounds, keyboard controls and mobile layouts must remain usable.

## Tasks
- [x] 1. Add failing comparison/validation and ownership/persistence tests; run RED. Implement pure helpers, compare saved and draft estimates, preserve remaining dials. Verify GREEN.
- [x] 2. Add failing real browser tests for command-center controls, preview automatic refresh, save/reload, refusal, mobile and absence/error states. Implement dedicated card, serialized/debounced preview hook, scoped CSS and hub insertion; reuse preview in full editor.
- [x] 3. Verify engine plan-effect regressions, actual paired-simulation calibration and endpoint input wiring. Add focused coverage where existing tests are insufficient. Capture actual desktop/mobile controls. No changes to simulation formulas.
- [ ] 4. Run all typechecks, build, full UI and required wentz-verify checks. Independent final source review. Commit/push/open one PR, inspect exact-head standard/PostgreSQL and complete Chromium CI; leave ready for review, never merge.

## Visual direction
Keep the existing dark sports panels, typography, team accent and teal/purple hierarchy. One two-column game-plan card: labelled offense/defense controls on the left, next-opponent probability and saved-plan comparison on the right. On phones stack the comparison below controls. Use existing motion only, native inputs and explicit status text; no dashboard redesign.

## Execution rulings
- Existing Mock limitation is material and explicit; this PR cannot satisfy adapter-free tactical gameplay without a separate simulation-runtime decision. No invented fallback.
- Independent review reproduced the mixed-server-snapshot race. Added read-only response version metadata, expected-client-version validation and comparison equality; regression RED then GREEN. This narrowly necessary server change affects no mechanics/schema.
- Review's online mode-caption defect fixed and covered in browser test.
- Controlled UI transport returns explicit503 for automatic preview; no fake probability there.


