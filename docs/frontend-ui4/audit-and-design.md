# UI-4 audit and design — 2026-10-29

Baseline: `6bef919474f6a8c7e690986ea7a3e64afc7c3a36` (UI-3 merged).
Branch: `feat/frontend-draft-fa-trade`. Reuse the existing isolated frontend checkout.
The user's supplied UI-4 brief authorizes this scope and visual direction. This document makes the layouts and implementation boundaries concrete for the pre-implementation design checkpoint.

## Existing workflows and boundaries

| Workflow | Screen / route | Existing authority to preserve |
|---|---|---|
| Fantasy and rookie drafts | DraftRoom, /draft | useLeagueActions.makeDraftPick; draft.pickOrder/currentPickIndex/results; startDraft only offline; runAiPicks in rules/server |
| Five-round market | FreeAgencyBoardTurns, /free-agency-board | freeAgencyTurn; onTheClock; leadingOffer; expectedSalary; FREE_AGENCY_ROUNDS; staff and skip actions |
| Standing market / old saves | FreeAgencyBoard, /free-agency | signFreeAgent/placeBid; standingAsk; ContractNegotiation; old sealed-window effects retained |
| Ordinary trades | TradeProposal, /trade | checkTrade; evaluateTrade; tradeVerdict; proposeTrade/respondToTrade/withdrawTrade; existing cap/vote rules |
| Deadline checkpoint | TradeDeadlineRoom, /trade-deadline | deadlineTurn; pendingFor/onTheClock; offer/counter/respond/final states; shared TradeColumn; cap reconciliation later |

All network mutations continue through useLeagueActions / OnlineLeagueClient, including their version handling and server refusals. No direct store mutation is added for online actions. Existing busy refs, errors, confirmations, skip/staff controls, commissioner takeover and stage redirects remain.

Privacy: online/src/index.ts strips other GMs' draft targets, pending third-party offers, unrevealed games/brackets and unrevealed rookie trueOverall. Do not reconstruct these from local state. Player.potential is explicitly a **hidden ceiling** in domain/player.ts: never show its raw number, even offline. Use existing public career-stage labels and rookie scouting notes/projection ranges; say potential is undisclosed where appropriate. Do not present an AI forecast as another human GM's decision.

## Visual direction

Use the actual docs/frontend-ui3/desktop-roster.png, desktop-cap.png and mobile captures: ink/teal stadium shell, original crest and decorative athlete art, violet/gold/blue accents, rounded layered panels, clear selected states and restrained glow. Keep UI-3's font, shared timing tokens, motion preferences and existing dependencies. No new image/font CDN, animation dependency, fake numbers or placeholder controls.

Builder choices: desktop starts at 1100 CSS pixels; tablet stacks context alongside or below the main board; mobile is below 700. Verify 360/390 phone, 768 tablet and 1440/1600 desktop. Layout breakpoints are presentation decisions, not new gameplay modes.

## Draft desktop

Top: actual season/mode, round, current pick and on-clock team; horizontal upcoming-pick strip (read only from pickOrder, no fabricated clock). Main area: wide sortable player board with search/position filters; narrow selected-player dossier and public roster-needs/unit context. Recent picks appear below the context. Fantasy-draft unit context must be computed by the existing unitReport selector over a temporary read-only projection containing drafted players only, not the pool's former NFL assignments; label grades as the incomplete drafted roster. Never mutate the store or present pre-draft pool members as this GM's roster. Board columns: identity, position, public OVR or explicitly College Grade, age, existing fit/scouting and action. Default ordering remains existing draftValue/college ordering. Explicit name, rating and age sorting only reorders the already-authorized available pool; filter/sort before the display limit. Compare up to two players by ID using public fields only.

Selection and scouting are browsing state. A draft action opens a concise identity/pick confirmation; Cancel has no gameplay effect. Confirm calls the existing guarded pick(id) once. Revalidate that the candidate is available and it remains the viewer's turn; errors stay visible and close/recover correctly when the server changes the board. Preserve end-of-board overlay labels and automatic-completion explanations.

## Draft mobile

Single player-card board, compact pick-status header, filter disclosure, Details/Compare navigation and an explicit selected-player confirmation. Player identity remains visible beside the action. Team context/recent picks have dedicated disclosures rather than a cramped sidebar. All columns' meaningful data remain available in cards/details; the layout does not merely hide cells. Same selection, filters, confirmation and action handler as desktop.

## Free-agency desktop

Status/round and actual cap context above a player-market board. Selected-player dossier/offer workspace at the side; league-leading offers only where the existing turn-market exposes them. Keep asking-price floor, preferences, binding-offer explanation and reconciliation notice beside salary/years. Distinguish unsubmitted draft offer, submitted/pending, outbid, won/lost and server rejection. Use existing round results and offers, not invented transactions or success predictions. Keep five-round market and standing market separate: do not describe an immediate standing-market signing as a pending round bid.

## Free-agency mobile

Player cards with position/rating/age/asking amount and legitimate leading-offer indicator. Open one focused offer panel with the selected identity, inputs, cap context and Submit/Cancel in reach. Return focus to the invoking control. Persistent round/turn feedback, with Staff/Pass/Skip visible in their existing permitted states. Browse and compare remain available while another GM acts; mutation buttons remain disabled.

## Trading desktop

Two asset panels with team identity and independent search/position/player-or-pick filters; selected-assets review and existing assessment/context next to or below them. Both players and draft picks retain their exact identifiers. Reuse checkTrade/evaluateTrade/tradeUnitImpact and current legality/warning text; do not invent net cap math or asset pricing. Show existing authoritative numeric cap effects if a shared selector already provides them; otherwise show current cap and the existing legality/reconciliation answer, clearly separated. Human-counterparty status says they decide; AI assessment is labeled advisory and shown only for CPU counterparts. Keep incoming/outgoing/withdrawal/vote and final response controls.

## Trading mobile

A focused Your assets / Their assets / Review navigation over the same give/get/partner state and action handlers. Selected counts persist when switching panels. Review names every selected player and pick, shows the existing assessment/rules and exposes Send only in the original eligible state. Deadline response/counter/final states remain distinct from ordinary proposal handling. No duplicate forms submitting competing payloads. A partner change keeps the current behavior for clearing their selected assets and stale feedback.

## Shared interaction and performance

Create presentation-only decision-workspace CSS/components scoped to these screens, retaining the shared shell. Native controls with explicit labels; semantic table desktop, semantic cards mobile; shared data and action functions. Sorting/compare state is local UI state and never enters saves. Use identity keys, stable memoized view projections and bounded list rendering; no animation across hundreds of rows. Existing MotionSurface/MotionMeter/Stagger/AnimatedNumber tokens handle short entrances and value changes. No screen exit retains interactive stale gameplay controls. Respect OS reduced motion, useDialog for modal focus/Escape/return, 44px touch targets, visible focus and live action status. Errors never disappear behind drawers.

## Existing limitations, separate from this redesign

- Hidden potential is intentionally unavailable; absence is not a UI bug to fix with raw state.
- Shared ContractNegotiation has the known default $60M salary-stepper ceiling. Preserve pricing/acceptance; document rather than change financial policy here.
- Draft and market have bounded display lists; retain filtering before limiting and expose counts/show-more so candidates remain reachable.
- The standalone trade display's simple asset bars are not the full AI evaluator. Do not label their arithmetic as a new authoritative valuation or rewrite the evaluator.
- Deadline cap/roster suspension differs from ordinary trading; retain those rules and reconciliation explanations.

## Implementation plan — one final PR

1. Shared presentation and public comparison projections: decision-workspace components/CSS, local sort/filter/compare helpers with focused unit tests. No changes to domain/state/sim/online APIs or dependencies.
2. DraftRoom: wide board/context composition; current/upcoming/recent picks; selection/compare and confirmation; mobile cards; existing rookie paths kept safe. Add browser actions and persistence tests before wiring the new confirmation.
3. FreeAgencyBoardTurns and FreeAgencyBoard: apply shared presentation and public dossier, search/compare and offer workflow. Keep old-save window and current five-round/standing semantics. Preserve offer payloads and sign/advance rules.
4. TradeProposal/TradeDeadlineRoom/shared TradeColumn: same asset IDs and state; native selectable assets and focused mobile navigation; readable review/cap/unit context and existing decision controls.
5. Regression coverage and captures: desktop/mobile actual selection, cancel/confirm, persistence and turn guards; unit tests for projection privacy/sorting/identity; current complete franchise suite and existing online rules tests. Capture six major desktop/mobile views under docs/frontend-ui4/.
6. Freeze, run wentz-verify with the real base, push one feature branch, open one UI-4 PR, inspect exact-head standard + Ubuntu Chromium CI and actual counts, document limitations. No @codex request, merge, deploy, UI-5 or unrelated changes.

Static layout map: [desktop/mobile layout plans](layouts.svg). These are information-layout wireframes, not screenshots of implemented functionality.

Implementation detail: [execution plan](../superpowers/plans/2026-10-29-ui4-draft-fa-trade.md).

## Acceptance and test plan

- Draft: exact selected ID is drafted once, roster ownership and pick progression match persisted state after reload; Cancel/search/sort/compare change neither the draft nor saves; commissioner and other-GM controls keep their existing eligibility.
- FA: exact salary/years/player ID reach the existing action; below-floor refusal and league maximum stay enforced; pending != signed; all five rounds and skip carry-over regressions remain; roster/cap accounting verified by existing independent ledger tests; cancellation is read-only.
- Trades: asset IDs include original pick ownership; selected counts and summary identities match; reset/partner changes behave correctly; proposal/accept/reject/withdraw/deadline counter/final states use existing actions exactly once; stored offers and outcomes survive reload; validation/server refusal remain visible.
- Multiplayer: focused UI tests with controlled server responses prove wrong-turn/frozen-stage controls cannot submit and stale/refused responses show correctly; existing online tests on CI's ephemeral PostgreSQL prove server authorization/version/rules. Clearly distinguish transport-controlled UI evidence from a real two-browser/server end-to-end run. Do not claim the latter unless actually executed.
- Privacy negative controls: comparisons never read raw potential/trueOverall/another GM's targets; stale selected IDs cannot be submitted; duplicate clicks yield one request; desktop/mobile payload parity; exact row identity/score association is preserved (no numeric-only oracle).
- Accessibility: keyboard search/filter/sort/compare/confirmation; focus trap/Escape/return; reduced-motion transitions; status text; 360/390/768 widths without body overflow and all workflow actions reachable.
- Verification: root engine tests/typecheck, UI typecheck/full suite/build, e2e:typecheck, relevant targeted Chromium then complete Ubuntu Chromium suite; wentz-verify actual records and exact-head CI; no skip claimed as pass. Local PGlite only when explicitly authorized through the existing runner; never inherited Neon. No new CI workflow/settings.

Review focus: hidden potential, five-round versus standing-market semantics, deadline versus ordinary cap rules, stale ID/turn changes, and equivalent desktop/mobile mutation payloads.
