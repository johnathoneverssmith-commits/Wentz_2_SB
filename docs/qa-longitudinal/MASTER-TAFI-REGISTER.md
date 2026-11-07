# Master TAFI Register

Last updated: 2026-11-07 · Reference build: `master` `3abcfff` (agent evidence) / `48fa26e` (docs only) · **All agent TAFIs below are pre-baseline.**

Priorities are the **coordinator's provisional reading**, not owner-approved. "?" = depends on an unverified fact. Status for all: **New** (intake only; not yet reproduced by the coordinator). Dedup: none found yet between A1 and A3 (different domains).

## Agent 1 — Aesthetics & UI/UX (22 TAFIs, submitted)
Source: PR [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (open, not merged), [register](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/blob/claude/brave-cray-w76j72/docs/qa-longitudinal/agent-01-aesthetics/03-tafi-register.md). Evidence: production build, Chromium, **BAL only**, fixture saves (not hand-played). Severity/class are Agent 1's; "grounding" is the coordinator's reading.

| ID | Title | Class | Sev (A1) | P (prov.) | Mode | Grounding | Notes / links |
|---|---|---|---|---|---|---|---|
| UI-TAFI-001 | Leftover dark stat strips with unreadable values (draft, FA, mid-season FA, trade deadline) | UX | High | P1? | Both | Confirmed (render, BAL) | Small; overlaps Group 08 dead-CSS/token cleanup |
| UI-TAFI-002 | Fantasy Draft Summary still on old dark design | UX | High | P2 | Both | Confirmed | Medium; check vs Group 08 |
| UI-TAFI-003 | 'On the clock' overlay headline clipped, page bleeds through | UX | High | P2 | Both | Confirmed once, cause undiagnosed | Small; needs repro at scroll 0 vs scrolled |
| UI-TAFI-004 | Two floating buttons cover content | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-005 | Default browser-blue link in setup notice | UX | Low | P3 | Both | Confirmed | Group 08 token layer? |
| UI-TAFI-006 | One stadium photo is the masthead on every screen | UX | Medium | P2 | Both | (see source) | links 019 |
| UI-TAFI-007 | Empty states are blank pages | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-008 | Command Center 4,190px long, leads with dashes | UX | Medium | P2 | SP | Confirmed | — |
| UI-TAFI-009 | Mid-season FA page 10,464px tall | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-010 | Season Complete buries champion; theme breaks | UX | High | P2 | Both | Confirmed | — |
| UI-TAFI-011 | Awards page hides next step behind 'tap anywhere' | UX | Low | P2? | Both | Confirmed | Escalate to P1 if a player can get stuck — unverified |
| UI-TAFI-012 | Shell controls 40px; draft board ~100 undersized controls | UX | Medium | P2 | Both | Confirmed | accessibility; #92 harness measures this |
| UI-TAFI-013 | Text below 11px on dense screens | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-014 | Bracket card mostly empty until games played | UX | Low | P3 | Both | (see source) | — |
| UI-TAFI-015 | Box score header details | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-016 | Fonts come from Google's CDN | UX | Medium | P2 | Both | Confirmed | Cross-link Agent 6 (privacy/CSP) and Agent 8 (offline) |
| UI-TAFI-017 | Primary button colour inconsistent | UX | Low | P3 | Both | Confirmed | Group 08 token layer? |
| UI-TAFI-018 | Stray full stop in FA 'You're up' notice | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-019 | 15 franchises have no stadium photo; one extreme crop | Enhancement | Medium | P2 | Both | (see source) | Asset work; link 006 |
| UI-TAFI-020 | Online lobby has no failure/timeout state when server unreachable | UX | Medium | P2 | MP | Confirmed (server-down state only) | Overlaps #92 lobby states; Agent 8 |
| UI-TAFI-021 | Left rail clips footer controls at 900px height | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-022 | Full-page captures show rail ending mid-page | UX | Low? | P3 | Both | (see source) | may be capture artefact |

Note: 001/002/005/017 look like leftovers Group 08 (dead CSS + one token layer) may already be meant to remove. Do not schedule separately until Group 08 scope is checked (open decision O-1).

## Agent 3 — Competitiveness (6 TAFIs + 1 gap list, **work in progress**)
Source: draft PR [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95), [register](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/blob/claude/kind-feynman-ay3w05/docs/qa-longitudinal/agent-03-competitiveness/TAFI_REGISTER.md). Final results and TAFIs are pending per owner; entries may change. Sim path: **real engine, headless** (not UI, not mock) — see AGENT-STATUS for the one point still to confirm.

| ID | Title | Class | Sev (A3) | P (prov.) | Mode | Grounding | Notes / links |
|---|---|---|---|---|---|---|---|
| COMP-001 | QB leverage exceeds QB price (≈1.4–1.7× per price unit) | Balance | Medium | P2 | Both | Controlled sim, real engine; price ratio is derived/crude; root cause hypothetical | A7 (economy), A2 |
| COMP-002 | FA salary vs trade-chart mismatch → sign-and-flip candidate | Balance/exploit (hypothesis) | Med–High if real | P2 (→P1 if flip confirmed) | Both | Price table only; **no flip simulated** | A7, A8 |
| COMP-003 | Head coach / bad staffs barely matter | Balance | Low | P3 | Both | Controlled sim; win% underpowered | documented as 'subtle' by design |
| COMP-004 | Kicker/punter nearly irrelevant | Enhancement | Low | P3 | Both | Controlled sim; close-game leverage untested | A3 wrote 'P4'; normalised to P3 |
| COMP-005 | Worst-first depth chart ⇒ 0.27 wins/season; no guard verified | Balance/UX | Medium | P2 | SP | Controlled sim (lineup importance only); UI guard **not checked** | A4: does the UI warn? |
| COMP-006 | Skilled-human dominance ceiling unknown (talent 1.5 + additive units) | Balance (open question) | Unknown | P2 (upgrade on evidence) | Both | Inference from sweeps; **no human-policy run** | A3 follow-up; A2, A7 |

`COMP-007` ("untested systems": draft, FA bidding, trades, CPU decisions, multiplayer, 5-season UI play, human-policy runs) is **not a TAFI**; it is Agent 3's remaining-work list and is tracked in COVERAGE-MATRIX / AGENT-STATUS.

Priority rationale: Agent 3 proposed P1 for COMP-002 and COMP-006. Both are un-run hypotheses, so they start at P2 with an explicit upgrade trigger (a confirmed repeatable exploit, or a scripted human winning a large share of titles). Rule: unproven exploits do not displace confirmed defects.

## Agents 2, 4, 5
_No submissions yet._

## Agents 6–9
_Not launched._

## Pre-existing known issues (GitHub; not agent findings)

| GH issue | Title | Provisional | Note |
|---|---|---|---|
| [#37](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/37) | Human auto roster trimming does not charge dead money | P1? | Cap integrity; Agent 7 to confirm |
| [#38](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/38) | CPU teams may release players signed in the same FA window | P2? | Agent 7 / 3 |
| [#44](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/44) | Flaky test: local-launcher port in use | P3 | Test infra |
| [#74](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/74) | Real engine unusable in standalone single-player (no :8787) | P1? | **Owner directive D-006**: every realism finding must state its sim path. Likely also means Agent 1's fixture league scores came from the mock sim (suspected: fixtures show no play-by-play; unverified) |

## Enhancement backlog (P3)
_See P3 rows above; separated into a standalone list once volume warrants._
