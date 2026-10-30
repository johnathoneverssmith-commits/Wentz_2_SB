# Game planning and predictive feedback

Adds an editable Game Plan panel to the Franchise Command Center without a dashboard redesign. Native pass/run and blitz controls update an unsaved draft, preserve every advanced playbook dial, and save through the existing game-state/action path. The full editor remains available.

## How the projection works

During preseason the panel automatically requests the existing engine lab after a450ms trailing debounce. It runs no probability formula in React: each answer comes from160 paired seeded simulations using available roster players, depth order, coaches, weather, talent scaling and the opponent's real plan. The existing engine estimates a plan's margin effect and maps that measured change to a win chance using its existing final-margin distribution. Two estimates on the same inputs compare the saved custom plan with the unsaved draft. Percentages are rounded; equality and sampling noise are valid outcomes.

Work is serialized; obsolete queued work is skipped and old responses disappear immediately when their plan or inputs change. An eight-answer cache is scoped to the current simulation inputs. Equivalent polling snapshots retain the cache. Online evidence carries the server version; missing/outdated/mixed versions fail closed instead of comparing different league states. The only server change is this read-only metadata, not authorization, mechanics or persistence.

Previewing never saves a plan. Save success appears only after the existing action succeeds. Ownership checks, detached-session protection and server refusal remain authoritative. Plans apply to future simulations, not precomputed multiplayer blocks. The lab is preseason-only; missing/invalid schedules or missing rosters do not produce fabricated odds.

## Actual screenshots

[Desktop command center](command-center-1440.png) · [Mobile command center](command-center-390.png)

Captured from the running application. The final capture uses actual seeded-engine responses computed in the isolated test process, not invented presentation values. It demonstrates the same adapter request/response contract; it is not evidence of a connection to a deployed server.

## Verification

The PR records exact-head results and counts. Focused coverage includes saved/draft comparison, unchanged rounded estimates, malformed/mixed snapshot evidence, current online-version validation, preserved advanced settings, saved-plan wiring into the actual subsequent Hybrid simulation request, adapter roster/depth/talent inputs, explicit request timeout, automatic recalculation, request serialization, stale-response suppression, failure/refusal recovery, save/reload, desktop/mobile layout and server-version rejection.

The existing engine plan-effect regressions exercise real passing/blitzing and roster-sensitive tradeoffs. An added independent-seed160-game calibration sanity check compares the existing estimate with observed outcomes using a finite-sample tolerance. It covers one matchup; it is not comprehensive probability calibration. The full browser suite retains the franchise lifecycle coverage.

## Material execution limitation

**Standalone offline solo is not a supported tactical simulation path.** The existing Mock simulator ignores game plans. This PR does not alter that simulator or invent a probability modifier. Real solo projections and tactical effects require the existing local engine adapter (`npm run server`); multiplayer uses the existing league engine. The UI and help explicitly disclose this. Extending true tactical effects to the adapter-free standalone game requires a separate simulation/runtime decision, and the all-modes definition of done is therefore not met by this PR.

The browser's multiplayer scenarios use controlled HTTP; the real-engine browser case runs engine functions in Node. Neither is a live multi-user server/browser integration test. CI separately covers server behavior with ephemeral PostgreSQL. Local PGlite is single-session and cannot establish true PostgreSQL concurrency.

The existing engine emitted non-finite-shift warnings for the generated browser fixture; it ignored those shifts as its existing guard specifies. No simulation formulas, ratings, fixture player attributes or balance were changed to hide this. The estimate uses the same current engine behavior; uncertainty and engine limitations remain relevant.

No contracts/cap, CPU decisions, trades/free agency, fictional generation, save schemas, arcade, dependencies, deployment configuration or branch protections changed. No merge or deployment is authorized.
