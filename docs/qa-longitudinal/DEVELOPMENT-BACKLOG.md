# Prioritized development backlog

Created 2026-11-09 from the reconciled `MASTER-TAFI-REGISTER.md` (master `22f79aa`). **Provisional: nothing here is approved for implementation.** Per `CLAUDE.md`, every item that touches production code, simulation balance, the schema or CI needs the owner's explicit approval, one change at a time. This file supersedes the "Draft batches" list in `PRIORITY-ROADMAP.md`.

**How items are ranked:** priority band first (P1 before P2), then **gameplay impact × confidence ÷ effort**. Evidence path matters as much as size, so every row says where its numbers came from:
**RE** real engine · **MOCK** Mock fallback · **TM** trade-model probe (no game simulated) · **CODE** code-inspected · **PIX** rendered pixels or measured boxes · **DESIGN** design/prototype (not an engine fact).

## 0. Triage before ranking (reported, not yet reviewed by the coordinator)
These are on master but not centrally registered. Do not schedule them from this list; triage them first.
| Item | Why it cannot wait | Source |
|---|---|---|
| FUN-TAFI-014 (redacted league still carries `hoodedFigure.unavailable` before the reveal; test-reproduced, rated Medium) | A multiplayer **information leak** is a P0/P1-class category in this program, whatever the agent's severity | #98 |
| FUN-TAFI-001 (one-human league: the figure's streak counts a title year; High, "suspected; spec unavailable") | A possible rules defect in a headline feature; needs the spec | #98 |
| TAFI-REAL-001/002/003/004 (safeties 1.2–2.7× NFL rate; defensive OT score does not end the game; no two-point attempts by the default plan; kicker XPs never recorded) | Confirmed engine realism defects (agent severity S2–S3), not reconciled; REAL-010 also conflicts with STRAT-006 | #102 |

## 1. Confirmed defects and exploits (ranked)
| # | Item | TAFIs | Type | Path | Impact | Effort | P | State |
|---|---|---|---|---|---|---|---|---|
| 1 | **Real engine for standalone single-player** | GAP-001/002/004/005, **STRAT-001**, issue **#74** | Structural defect | MOCK vs RE | In the default build a rating point is worth 0.17–0.27 wins instead of 0.67–1.04; sd of wins 1.8 vs 3.0–3.5; impossible scores (1-point "Safety"); plans/staff/units ignored; a dynasty can silently switch simulators. The biggest single limit on whether decisions matter | L (Phase 1: S) | **P1** | Issue **open**. Phase 1 (explicit versioned pool) approved (D-020); **no Phase 1 PR found open**. Interim: #110 draft. Phases 2–5 not approved |
| 2 | **Phone-width legibility cluster** | UI-TAFI-004 (**P1 provisional, unverified**), **PA-001** (P1), PA-003 (P2, XS), PA-002 (P2, **root cause unresolved**) | Defects | PIX | Floating tabs cover content; "Your assets (0)" 1.28:1; draft-room disclosure 1.25:1 (root rule `decisions.css:19` still on master); Game Day scrolls sideways (394 > 390) | S overall | P1/P2 | Not started. UI-TAFI-004 stays provisional until a live-viewport case is shown; PA-002 needs its element identified first |
| 3 | **CPU contract dumping** | **STRAT-002** (GH #37 and COMP-002a are related, not the same) | Exploit (model level) | TM | A 32-year-old 70 on $20M × 3 is taken for nothing by 32 of 32 CPU teams with cap room, so cap mistakes can be undone at the deadline. Not yet shown end-to-end in the UI | Validate S (2-second probe on year-3, tight-cap states), then fix M | **P2 → P1** if reproduced under a tight cap | Validate first (acceptance: free takes ≤ 20% for release penalty ≥ $10M) |
| 4 | **K/P need bonus** (extended to every position, bounded) | **COMP-002b**, STRAT-010 | Exploit (confirmed in the trade model) | TM | K returned 1.14×, P 1.80× chart in picks; a $3.5M punter ≈ a second-round pick; bounded by the deadline window | S | P2 (A3 proposed P1) | Fix options A–C written; regression: signed FA offered to every CPU team returns ≤ 1.0× chart on average |
| 5 | **Depth-chart inversion warning** | **COMP-005** (code-confirmed twice: #95, #105) | Confirmed UX gap | RE (effect) + CODE (gap) | An accidental worst-first chart ≈ 0 wins; nothing warns. Cheap, silent self-harm | S | P2 | Not started. Not screenshot-verified |
| 6 | **Recoverable dynasty reset** | **ADV-001** (pending intake), GAP-008 residual | Defect (data loss) | Real browser + adapter (#106) | "New solo dynasty" wipes the live save and the `#prev` copy in <300 ms: the likeliest way a player loses a long dynasty | S–M | P2 | **Drafted in #110** (unmerged, not approved) |
| 7 | **Draft Room grade label** | STRAT-003 (display half) | UX defect | RE (X2) + CODE | Headline "college grade" overstates true rating by ≈ 15 (r ≈ 0.5); teaches the wrong number | XS–S | P2 | Not started; separate from the scouting enhancement |
| 8 | Hub favourite-% green 3.94:1 | PA-004 (a only) | Accessibility (marginal) | PIX | Needs 4.5:1 | XS | P3 | — |

## 2. Investigations before any fix (not defects yet)
| Question | TAFIs | Why first | Effort |
|---|---|---|---|
| Does a skilled human dominate? (scripted human over all turn-based events, ≥10 seeds × 10 seasons, talent 1.0/1.5) | **COMP-006** (experiment P1) | The central missing experiment; decides whether any balance change is needed | L |
| Is the dump exploit end-to-end? | STRAT-002 | Rank 3 above | S |
| Does CPU skill pay off? (≥20 leagues, matched strategies) | COMP-008 | −0.55 ±0.26 over 6 leagues is tentative | M |
| Wins dispersion and low-win tail | **REAL-010 vs STRAT-006/X1** | Two agents measured opposite shapes (sd 2.7 vs 3.4; persistence 0.2 vs 0.39; ≤2-win teams) | S–M |
| Is the floating-tab overlap a real blocker? | UI-TAFI-004 | Fixed-position element; full-page captures draw it once | S |
| Season-level cost of sign-and-flip | COMP-002a | No season-level simulation | M |

## 3. Proposed gameplay enhancements (NOT defects; none implemented)
Nothing in this section may be described as built. #107 is a **design with prototype evidence**.
| Enhancement | Basis | What the evidence does and does not show | Needs |
|---|---|---|---|
| **Scouting** (information the player can buy) | STRAT-003 / #105 R3; design in **#107** (Phase 1, need-aware, CPU parity) | #107 Experiment C: scouting the top of the board is worthless (0.00 ±0.03); 24 basic reports at positions of need recover about half of perfect information's immediate rating gain (+0.10 vs +0.20); breadth beats depth. **Limits:** it measures the rating change after one draft, not wins; the scouting model exists only in a script; the human currently has no way to beat the CPU's draft baseline (#105 X2) | Approval; a CPU analogue, or the human keeps a built-in edge |
| **Scheme identity and skill-style synergy** | **#107** findings 1–6 | Claimed: the shipped scheme mechanic penalises specialisation (every non-neutral scheme is worse than neutral); the engine cannot see skill style. Prototype: style alignment ≈ 2.6–2.8 margin **at the extremes**, realistic rosters +0.3 / −1.4; **superadditivity with unit quality not demonstrated** (+0.40 ±0.62); fit-based building vs highest-overall at equal spend +0.03 ±0.12 in the real engine. The prototype is a ~130-line patch calibrated to a target, **not an engine fact** | Approval; per-league flag (the `talentImpact` pattern) so existing franchises are untouched. **Phase 0 (derived scheme tags, neutral when untagged) is drafted in #109** (production code, unmerged, local results, branch behind master) |
| **Tactical agency** (discoverable opponent tactics, safe dials) | COMP-009, STRAT-005, #105 R5 | Run-heavy is the only dial with a reliable matchup signal; tailoring ≈ +0.5 pts/game (≈ 0.25 wins/season); pass +15 costs everyone 1.7 pts/game. Low agency is a design concern, not a defect. #107 finding 6: a weekly counter that abandons the roster's identity loses (−0.35) | Approval; preview noise (SE ≈ 0.8 at 160 sims) can mislead |
| Season / decision attribution | STRAT-004, #105 R4 | Absence confirmed in code searched, **not in a played build** | UI design |
| CPU that remembers; slower rebuild arc | STRAT-008, #105 R6 | Reading, not run; low priority | New state to serialise |
| Optional audio (sack cue, stage-change sting, first-round pick tone; `signed` cue gap) | PA-008/009/010 | Source-inspected and loudness-measured; **nothing listened to** | Agent 9 evaluation (not started) |

## 4. Infrastructure and documentation
- **COMP-010:** seed-pinned, auto-play solo option for reproducible UI runs (a production change: needs approval).
- **STRAT-009:** correct the "whole dollars" statement in `CLAUDE.md` / `player_schema.md` (team cap is `$M`).
- Keep `SAVE_SOAK=1` and a bracket-consistency check in the release checklist (#106).
- #92 harness: treat near-black/gradient background contrast readings as unknown (four false positives in #104).

## 5. Fix PRs in flight (drafts; **not approved**, not QA evidence)
| PR | What | Notes |
|---|---|---|
| #110 | Locks a dynasty to its simulator (no silent engine↔Mock switching; stops play when an engine dynasty loses the adapter; labels the Mock) **and** keeps a recoverable copy on reset (ADV-001) | Addresses GAP-004 and ADV-001. **Does not** make standalone use the real engine and does not raise the Mock's sensitivity. Local results; remaining risk: a pre-change engine save with no stored games locks to the Mock |
| #109 | Phase 0 of #107: scheme fit repaired (derived tags; untagged units neutral; per-league flag, new leagues default derived, saves stay legacy) | Behind master; local results; one unrelated failing engine test reported |

## 6. Dependencies and sequencing
1. #74 Phase 1 (explicit versioned pool) → Phases 2–5; the standalone realism tests in `ISSUE-74-PLAN.md` gate Phase 5.
2. Contract-dump validation (rank 3) before any change to the trade model; do K/P (rank 4) and need-stacking together so the trade tests are updated once.
3. Scouting needs CPU parity and the draft grade label (rank 7) first; synergy follows Phase 0 and a per-league flag.
4. COMP-006 informs every balance decision (QB price COMP-001, plan values COMP-009): **no price or balance constant should be tuned before it runs.**

## 7. What this backlog does not say
- It does not treat #107's prototype numbers as engine facts, nor #109/#110 as accepted.
- It does not rank the unreconciled #98/#102 findings (section 0).
- It does not claim the real-engine results apply to the standalone build: STRAT-001 shows they do not until #74.
