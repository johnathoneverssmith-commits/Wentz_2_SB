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
| UI-TAFI-004 (= A1-004) | Two floating buttons (Methodology / Unit Grades) cover content on phones | UX | Medium | **P1 (provisional, raised from P2)** | Both | Confirmed by **two independent Agent 1 sessions**: #94 (hub covers "Simulate Regular Season"; Gamecast key-moments card) and #104 (Trade Deadline covers "You're on the clock" text; hub readiness card), BAL, 390px. Root cause per #94: `app-shell.css:419` `position:fixed` dock | Also listed as outstanding in `GROUP-08-REPORT.md`. Caveat: a fixed element occludes different content as the page scrolls, and full-page captures draw it once, so confirm in a live viewport that a control or required text can be left unreachable before treating it as a blocker |
| UI-TAFI-005 | Default browser-blue link in setup notice | UX | Low | P3 | Both | Confirmed | Group 08 token layer? |
| UI-TAFI-006 | One stadium photo is the masthead on every screen | UX | Medium | P2 | Both | (see source) | links 019 |
| UI-TAFI-007 | Empty states are blank pages | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-008 | Command Center 4,190px long, leads with dashes | UX | Medium | P2 | SP | Confirmed | — |
| UI-TAFI-009 | Mid-season FA page 10,464px tall | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-010 | Season Complete buries champion; theme breaks | UX | High | P2 | Both | Confirmed | — |
| UI-TAFI-011 | Awards page hides next step behind 'tap anywhere' | UX | Low | P2? | Both | Confirmed | Escalate to P1 if a player can get stuck — unverified |
| UI-TAFI-012 (= A1-012) | Shell controls 40px; draft board ~100 undersized controls | UX | Medium | P2 → **P3 proposed** | Both | Confirmed (sizes) | **Disagreement to resolve:** #104 measured these at ≥24px (meets WCAG 2.2 SC 2.5.8; only misses the 44px platform/AAA guideline) and proposes P3 polish; #94 rates it Medium. Keep P2 until Agent 1 (#94) concurs |
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

Routing (D-009): 001, 002, 005, 017 (and the theme part of 010, if confirmed) are folded into Group 08 — see `GROUP-08-PLAN.md`. 003 and the rest stay in this register for later PRs.

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

## Agent 4 — Gaps & Completeness (11 TAFIs, submitted)
Source: PR [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99), `agent-04-gaps/report-2026-11-07.md`. Pre-baseline (built from master `d9af7c4`, work started at `3abcfff`). Sim path stated per finding in the report: **real engine** for UI/online runs, **Mock** only where marked. IDs `TAFI-GAP-nnn` = alias `A4-nnn` (kept as issued). Status for all: **New** (intake). Priorities are the coordinator's provisional reading.

| ID | Title | Class | Sev (A4) | P (prov.) | Mode | Grounding | Fix / links |
|---|---|---|---|---|---|---|---|
| TAFI-GAP-008 | Solo save outgrows browser storage; failed saves lose progress on reload | Bug (data loss) | **Critical** | **P0** | SP | Played-in-UI ×2 (two seeds) + controlled sim; root cause confirmed | Fix in review: [#101](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/101) (draft, **unmerged**, CI not yet green when checked). **Duplicate observation:** Agent 1 `A1-023` (per #94 description) — same root cause, linked, not a separate TAFI. Related #74 (would make the default player hit it) |
| TAFI-GAP-011 | Solo playoff bracket contradicts stored playoff games (engine path) | Bug | High | P1 | SP (adapter path) | Controlled sim 4/4 seasons + one UI instance; mechanism confirmed, trigger suspected | Fix **merged**: [#100](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/100) as `13e80ea` (CI green). Status **Fixed — not yet Verified**: re-run Agent 4's bracket-vs-games check (`harness/bracket_check_snippet.txt`) on current master first. Online nfl-format playoffs **untested** |
| TAFI-GAP-004 | Silent, per-call, mid-franchise fallback to Mock; no indicator | Bug/UX | High | P1 | SP | Played-in-UI (controlled block) + code; root cause confirmed | #74 (reduces, does not remove). Spontaneous browser failure never observed |
| TAFI-GAP-001 | Mock simulator produces impossible scores (1-point "Safety") | Bug | High | P1 | SP standalone | Controlled sim (Mock) + code; confirmed | #74 resolves it only if the Mock is retired or fixed. Small fix available |
| TAFI-GAP-002 | Mock player lines contradict team totals | Bug | Medium | P2 | SP standalone | Controlled sim + code; confirmed | tied to 001 / #74 |
| TAFI-GAP-005 | Mock playoffs store no games | Bug | Medium | P2 | SP standalone | Code + controlled sim | tied to 001 / #74 |
| TAFI-GAP-006 | Native `confirm()`/`alert()` dialogs remain (~20 sites; two fired in real play) | UX | Low–Medium | P2 | Both | Two played-in-UI, rest code-inspected | Dedup: Agent 1 `A1-024` (28 sites, per #94) — **same inventory, merge when #94 lands**. Irreversible ones first (trade accept, Hooded Figure payment, pass-a-turn) |
| TAFI-GAP-009 | Hard-coded "Week 10"/"Week 9" labels ignore league size | Bug (text) | Low | P3 | Both | Formula run (`seasonShapeFor`), not played in other formats | Wrong for 6, 8, 12, 16, 20, 32 teams; XS fix |
| TAFI-GAP-007 | Unknown/out-of-stage URLs silently go to hub; bogus round renders | UX | Low | P3 | Both | Route crawl (13 routes) | XS fix; no state lost |
| TAFI-GAP-003 | Engine box-score player lines vs team yardage | Bug (accounting) | Low | P3 | Both | Controlled sim + code; **mixed** | Rush gap = convention (code-confirmed); pass gap **unexplained** → hand to Agent 2 |
| TAFI-GAP-010 | Engine logs non-finite shifts in a 4-team league | Bug (suspected) | Low | P3 | MP | Log only, **not reproduced** elsewhere | Hand to Agent 2 |

Agent 4 is **not** a "no gaps" result for what it did not touch: online inactive-GM / disconnect / commissioner-transfer paths, Firefox/WebKit, real phones and online playoffs were **not exercised** (see `agent-04-gaps/playtest-and-multiplayer-coverage.md`).

Cross-agent routing: GAP-001/002/004/005 → issue #74 plan (Phase 1 approved only; no fallback fix approved). GAP-003/010/011-trigger → Agent 2. GAP-006 → Agent 1 (and Group 08 is **not** the place: out of its scope). GAP-011's fix (#100) is merged but **not Verified** until Agent 4's regression check is re-run; GAP-008's fix (#101) is unmerged, so GAP-008 is not Fixed.

## Presentation, Audio & Immersion — Agent 1 presentation session, `PA-nnn` series (final, PR [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104), head `ab5b2f0`)
Source: draft PR #104 (open, **not merged**), `agent-01-presentation/REPORT.md` (the **FINAL** section; its appendix is the superseded first pass). Baseline `d0727ff` (post-Group 08), BAL only, 1440/390/320, fixture saves (not hand-played), real build. **Pre-baseline.** Sim path: not applicable (presentation); audio measured by recording the Web Audio graph headless, **nothing was listened to**. Of the first pass's 10 IDs: **6 confirmed, 3 disproven, 2 reclassified as opportunities** (PA-004 is split: 004a confirmed, 004b disproven). Priorities are the coordinator's provisional reading. Status for all: **New**.

### A. Confirmed defects
| ID | Title | Class | P (prov.) | Mode | Grounding | Cross-references |
|---|---|---|---|---|---|---|
| PA-001 | Trade Deadline "Your assets (0)" (and "Their assets (0)") controls unreadable at phone width: dark teal on the dark card-header band, 1.28:1 | UX / contrast | **P1** | Both | Viewed in screenshot + measured on a solid `rgb(10,52,53)` background, 390 and 320 | **Residual of the dark header band Group 08 left by owner decision** (`GROUP-08-REPORT.md`). Related to, not the same as, UI-TAFI-001 (a different element). My #103 review's probe had flagged both assets buttons at the time and left them unattributed. Agent's text names only "Your assets": scope must include "Their assets" and the whole class of dark-header controls |
| PA-003 | Draft room "Roster needs & unit grades" disclosure invisible: `#c9dcf0` on opaque `rgb(239,242,245)`, **1.25:1**, 1440 and 390 | UX / contrast | **P2 (top quick win, XS)** | Both | Real pixels sampled; root cause `decisions.css:19` `.decision-workspace details>summary{color:#c9dcf0}` | **Same root rule** as the Fantasy Draft Summary "Methodology" disclosure that PR #103 fixed with a *narrow* override (`.decision-workspace .dso-method > summary`, 17.35:1). The root rule still affects every `details>summary` in the decision workspace; fixing it there is the general fix. Different element from #103's, so no contradiction. Family: A1-001/002/025, UI-TAFI-001/002 |
| PA-002 | Game Day empty state scrolls sideways: `scrollWidth` 394 > 390 (and 322 > 320) | Bug (layout) | **P2** | Both | Viewed + measured at 390/320; 1440 clean. Root-cause element **not identified** by the agent | **Pre-existing, not a Group 08 regression:** `game-day-week-9` is pixel-identical before and after #103 at all three widths (`group-08-evidence` table). **Conflicts with #94**, which reports "0 px horizontal overflow on 23 routes" at 390/320 (a different state or fixture; resolve which). Related: A1-007 (blank empty states) |
| PA-004 (= **004a** only) | Hub favourite-% green on grey 3.94:1 (13px bold, needs 4.5:1) | Accessibility (marginal) | P3 | Both | Real pixels (90% of sampled pixels); best pixel 4.80 | Check against A1-029 (franchise-dependent contrast), which says BAL's hub has no such failure (different elements listed) |

### B. Accessibility advisories (best practice, not WCAG failures)
| ID | Title | P (prov.) | Grounding | Notes |
|---|---|---|---|---|
| PA-005 | Heading level skips h1 → h3 on game plan, bracket and rookie-draft summary (no h2) | P3 | Probe + confirmed on three screens | WCAG 1.3.1 advisory technique. Not in #94 |

### C. Audio (source-inspected; **nothing listened to**)
| ID | Title | Class | P (prov.) | Notes |
|---|---|---|---|---|
| PA-008 | `signed` cue is defined in `audio/cues.ts` but no call site exists | Confirmed small gap (unwired feature) | P3 | Visual feedback exists, so silence is not a usability defect. Agent downgraded it from P2. The free-agency board already computes round results (`lastResults`), where it could fire |
| PA-009 | No sack cue in the Gamecast | **Optional enhancement** | P3 | Source-only; not a defect |
| PA-010 | Draft atmosphere stops at your own pick | **Optional enhancement (intentional by design)** | P3 | `PickMoments.tsx` documents silence for others' picks (224-pick draft; first-round visuals exist). The agent withdrew "no announcement" as wrong |
Measured, not judged: music beds −22.5 to −24.1 dBFS RMS, no clipping; cues +3.1 to +8.5 dB over the bed; `tradeOffer` and `signed` quietest (~+3 dB, possible masking). Whether it *sounds good*, chant balance and long-session repetition are **unassessed**. Audio is Agent 9's remit and Agent 9 is **not started**: this is a pre-assessment, not Agent 9's evaluation.

### D. Disproven / withdrawn (kept for the audit trail; **not counted, not to be scheduled**)
| ID | What was claimed | Why it is disproven |
|---|---|---|
| PA-004b | Hub 10px caption 4.25:1 | Real pixels `rgb(78,95,112)` on `rgb(238,242,245)` = 5.84:1, passes. The harness read the wrong background |
| PA-006 | Roster pitch graphic clipped | 2.5px of a decorative icon overshoots an `overflow:hidden` box; no content lost, no page scroll |
| PA-007 | Skip checkbox "13×40px" below 24px | The effective target is the wrapping `<label>` at 366–1152 × 72–106px; passes WCAG 2.2 SC 2.5.8 |
| Harness V-001…V-004 | History/Season Complete `td` 1.20:1 "on rgb(1,1,1)" | Legible dark navy on a light row; the probe misreads near-black/gradient backgrounds. Recommendation for the #92 harness owner (not implemented): treat near-black background readings as *unknown* |
| Harness V-006 | Roster slot numerals 2.95:1 | Decorative, within rounding |
Unchanged by this report and not re-verified: BAL badge 2.34:1 and the stat-strip stray rule (Group 08 report).

### Priority focus (owner request, provisional)
1. **UI-TAFI-004 / A1-004** — floating tabs cover content on phones. P1, S. (Two independent confirmations; verify a live-viewport case.)
2. **PA-001** — unreadable Trade Deadline controls. P1, S.
3. **PA-003** — draft-room disclosure (and, by root cause, every decision-workspace disclosure). P2, XS: highest value per effort.
4. **PA-002** — Game Day sideways scroll. P2, XS–S once the element is identified.
Rule kept: audio and polish items do not outrank these.

## Agents 2, 5
_No submissions on GitHub._ Agent 5 reportedly has 13 TAFIs not yet pushed; **not registered** until its draft PR exists (D-014).

## Agents 6–9
_Not launched._ (Audio findings above came from an Agent 1 session; Agent 9 has not started.)

## Pre-existing known issues (GitHub; not agent findings)

| GH issue | Title | Provisional | Note |
|---|---|---|---|
| [#37](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/37) | Human auto roster trimming does not charge dead money | P1? | Cap integrity; Agent 7 to confirm |
| [#38](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/38) | CPU teams may release players signed in the same FA window | P2? | Agent 7 / 3 |
| [#44](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/44) | Flaky test: local-launcher port in use | P3 | Test infra |
| [#74](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/74) | Real engine unusable in standalone single-player (no :8787) | P1? | **Owner directive D-006**: every realism finding must state its sim path. Likely also means Agent 1's fixture league scores came from the mock sim (suspected: fixtures show no play-by-play; unverified) |

## Enhancement backlog (P3)
_See P3 rows above._ Optional audio enhancements: PA-009 (sack cue), PA-010 (first-round picks by others, stage-change sting). Audio level tweak (`tradeOffer`/`signed`) only if a human listening test confirms masking.
