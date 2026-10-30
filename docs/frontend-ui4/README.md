# UI-4 decision workspaces

Draft, free-agency and trade presentation built on UI-3's sports shell and motion tokens. Desktop uses a board plus context rail; phone uses player cards, a focused offer and Your assets / Their assets / Review steps. Both layouts use the same original action handlers and IDs.

## Actual browser captures

| Screen | Desktop | Phone |
|---|---|---|
| Draft | [Desktop](draft-desktop.png) | [Phone](draft-mobile.png) |
| Five-round market | [Desktop](free-agency-desktop.png) | [Phone](free-agency-mobile.png) |
| Ordinary trade review | [Desktop](trade-desktop.png) | [Phone](trade-mobile.png) |

Captures come from deterministic saved leagues in an isolated browser; they are not the layout SVG. Reduced motion is enabled for stable capture. Browser tests also exercise the standing market at phone/tablet widths and a recipient-oriented mobile deadline counter.

## Safety and regression coverage

- Public comparison projection excludes hidden potential and raw prospect development ratings. Draft context uses drafted players only in fantasy mode.
- Sorting, comparison, mobile steps and confirmations are presentation state only; saves, server actions, pricing and legality functions remain unchanged.
- Exact player/pick IDs, salary and term payloads, single-flight submission, cancellation and reload persistence are asserted.
- Controlled multiplayer transport tests cover wrong turns, frozen stages, server refusal, event-loading transitions and counter/final acceptance. They intercept every request; they are **not** real multiplayer/server/database E2E. Existing online CI separately exercises server rules against ephemeral PostgreSQL.
- Regression checks reproduced inaccessible comparison recovery, a sideways-scrolled offer card, an offscreen phone refusal, and a market hook-order loading crash before their corrections.
- Draft dialog checks include initial focus, reverse-Tab containment, Escape, focus return and OS reduced motion. Native asset buttons expose pressed state and retain keyboard activation.
- Large player lists retain bounded rendering, filtering before limits and Show more. No new animation dependency, gameplay, state, database, arcade or workflow code is introduced.

## Limits retained

The shared negotiation salary stepper retains its existing $60M default ceiling. Simple trade value bars remain explicitly separate from the CPU assessment, and no AI acceptance forecast is shown for human partners. These are presentation tests, not proof of live multiplayer concurrency. The audit and approved layout plan remain in this directory.
