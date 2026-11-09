# Master TAFI Register

Last updated: 2026-11-09 · Reference build: `master` `d0727ff` (includes #92, #99, #100, #101, #103). Agent evidence was gathered on earlier builds, as stated per section · **All agent TAFIs below are pre-baseline** (no baseline SHA has been declared).

Priorities are the **coordinator's provisional reading**, not owner-approved. "?" = depends on an unverified fact. Status is **New** (intake only; not reproduced by the coordinator) unless a row says otherwise. **Fixed** = a fix PR is merged; **Verified** is reserved for a fix whose regression check was re-run after the merge and reviewed. Dedup links are noted per row.

## Agent 1 — Aesthetics & UI/UX (22 TAFIs, submitted)
Source: PR [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (open, not merged), [register](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/blob/claude/brave-cray-w76j72/docs/qa-longitudinal/agent-01-aesthetics/03-tafi-register.md). Evidence: production build, Chromium, **BAL only**, fixture saves (not hand-played). Severity/class are Agent 1's; "grounding" is the coordinator's reading. **#94 predates master** (base `48fa26e`): its statements on A1-001/002/005/017 and A1-023, its "pre-baseline" labels and its "Group 08 cannot fix these" sequencing note are **superseded by #101 and #103 and are not carried into this register**. Its A1-025…037 entries are not registered here; they must be re-verified on current master by Agent 1 first. IDs `A1-001…022` = `UI-TAFI-001…022`; both are kept as issued.

| ID | Title | Class | Sev (A1) | P (prov.) | Mode | Grounding | Notes / links |
|---|---|---|---|---|---|---|---|
| UI-TAFI-001 (= A1-001) | Leftover dark stat strips with unreadable values (draft, FA, mid-season FA, trade deadline) | UX | High | **Fixed (merged)** | Both | Fixed by Group 08, [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103) (`d0727ff`): the leftover `.decision-workspace .ticker` override is removed; strip text ≥5.40:1 per the PR's own measurements. Coordinator's independent review of the final head: before/after screenshots and my own capture at 390/320 (no strip contrast findings, no overflow) | **Not yet Verified** by Agent 1's own re-run. Residual dark card-header band is a different element → PA-001 |
| UI-TAFI-002 (= A1-002) | Fantasy Draft Summary still on old dark design | UX | High | **Fixed (merged)** | Both | Fixed by [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103): overview restyled on the gameday tokens, layout and grade logic untouched. My review found the "Methodology and full numbers" disclosure still at 1.40:1 on the first final head; fixed at `95b13f9` and browser-verified by me at 17.35:1 (1440/390/320) | A1-025 (trade / FA / rookie summaries on the old dark design) is **not** independently re-verified on current master. The root rule behind the disclosure problem (`decisions.css:19`) still exists → PA-003 |
| UI-TAFI-003 | 'On the clock' overlay headline clipped, page bleeds through | UX | High | P2 | Both | Confirmed once, cause undiagnosed | Small; needs repro at scroll 0 vs scrolled |
| UI-TAFI-004 (= A1-004) | Two floating buttons (Methodology / Unit Grades) cover content on phones | UX | Medium | **P1 (provisional, raised from P2)** | Both | Confirmed by **two independent Agent 1 sessions**: #94 (hub covers "Simulate Regular Season"; Gamecast key-moments card) and #104 (Trade Deadline covers "You're on the clock" text; hub readiness card), BAL, 390px. Root cause per #94: `app-shell.css:419` `position:fixed` dock | Also listed as outstanding in `GROUP-08-REPORT.md`. **The P1 escalation is provisional and UNVERIFIED:** a `position:fixed` element occludes different content as the page scrolls, and full-page captures draw it once. It stays provisional until a live-viewport case is demonstrated in which a control or required text is unreachable; until then do not treat it as a blocker |
| UI-TAFI-005 (= A1-005) | Default browser-blue link in setup notice | UX | Low | **Fixed (merged)** | Both | Fixed by [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103): notice links use `--gd-link`. Verified by diff and the PR's evidence (1440px `/setup` diff is the link only); not measured in a browser by me | — |
| UI-TAFI-006 | One stadium photo is the masthead on every screen | UX | Medium | P2 | Both | (see source) | links 019 |
| UI-TAFI-007 | Empty states are blank pages | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-008 | Command Center 4,190px long, leads with dashes | UX | Medium | P2 | SP | Confirmed | — |
| UI-TAFI-009 | Mid-season FA page 10,464px tall | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-010 (= A1-010) | Season Complete buries champion; theme breaks | UX | High | P2 | Both | Confirmed | **Not changed** by #103 (judged deliberate design; moving the champion is a layout change, out of scope) |
| UI-TAFI-011 | Awards page hides next step behind 'tap anywhere' | UX | Low | P2? | Both | Confirmed | Escalate to P1 if a player can get stuck — unverified |
| UI-TAFI-012 (= A1-012) | Shell controls 40px; draft board ~100 undersized controls | UX | Medium | P2 → **P3 proposed** | Both | Confirmed (sizes) | **Disagreement to resolve:** #104 measured these at ≥24px (meets WCAG 2.2 SC 2.5.8; only misses the 44px platform/AAA guideline) and proposes P3 polish; #94 rates it Medium. Keep P2 until Agent 1 (#94) concurs |
| UI-TAFI-013 | Text below 11px on dense screens | UX | Medium | P2 | Both | Confirmed | — |
| UI-TAFI-014 | Bracket card mostly empty until games played | UX | Low | P3 | Both | (see source) | — |
| UI-TAFI-015 | Box score header details | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-016 | Fonts come from Google's CDN | UX | Medium | P2 | Both | Confirmed | Cross-link Agent 6 (privacy/CSP) and Agent 8 (offline) |
| UI-TAFI-017 (= A1-017) | Primary button colour inconsistent | UX | Low | **Fixed (merged)** | Both | Fixed by [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103): `.btn-primary` inside `.gd` pages takes the accent (Season Complete "Continue" teal → orange). Verified by diff and the PR's before/after; not measured in a browser by me | Gamecast quarter-break "Continue" in team yellow (A1-031, in #94) is not covered and not re-verified |
| UI-TAFI-018 | Stray full stop in FA 'You're up' notice | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-019 | 15 franchises have no stadium photo; one extreme crop | Enhancement | Medium | P2 | Both | (see source) | Asset work; link 006 |
| UI-TAFI-020 | Online lobby has no failure/timeout state when server unreachable | UX | Medium | P2 | MP | Confirmed (server-down state only) | Overlaps #92 lobby states; Agent 8 |
| UI-TAFI-021 | Left rail clips footer controls at 900px height | UX | Low | P3 | Both | Confirmed | — |
| UI-TAFI-022 | Full-page captures show rail ending mid-page | UX | Low? | P3 | Both | (see source) | may be capture artefact |

Routing (D-009), now done: 001, 002, 005, 017 shipped in Group 08 (#103, `d0727ff`); the theme part of 010 was judged deliberate and not changed. 003 and the rest remain open for later PRs. Group 08's own outstanding list (`GROUP-08-REPORT.md`): BAL badge 2.34:1, the floating Methodology tab (UI-TAFI-004), the shared dark card-header band (→ PA-001), a stray rule on stacked stat strips, and the dark shell/dialogs with the retained token-remap block.

## Agent 3 — Competitiveness (**STALE: rows below are the earlier draft intake**)
> **Warning (2026-11-09):** PR #95 is **merged** and its final `agent-03-competitiveness/TAFI_REGISTER.md` supersedes these rows. It splits COMP-002 into **002a** (sign-and-flip, low–medium) and **002b** (K/P "need" bonus makes CPU teams overpay: *confirmed in the trade model*, Medium), downgrades COMP-001 (equal-payroll QB edge only +1 to +2 margin), marks COMP-005 a confirmed UX gap, and adds **COMP-008** (higher CPU-GM skill gives no wins, tentative) and **COMP-009** (the standard game plan is about best). The rows and priorities below were **not** reconciled in this update and must not be relied on; reconciling them is an open item (needs its own pass against the merged register).
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
Source: PR [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99) (**merged**, `9e2f541`), `agent-04-gaps/report-2026-11-07.md`. Pre-baseline (built from master `d9af7c4`, work started at `3abcfff`). Sim path stated per finding in the report: **real engine** for UI/online runs, **Mock** only where marked. IDs `TAFI-GAP-nnn` = alias `A4-nnn` (kept as issued). Status for all: **New** (intake). Priorities are the coordinator's provisional reading.

| ID | Title | Class | Sev (A4) | P (prov.) | Mode | Grounding | Fix / links |
|---|---|---|---|---|---|---|---|
| TAFI-GAP-008 | Solo save outgrows browser storage; failed saves lose progress on reload | Bug (data loss) | **Critical** | **P0** | SP | Played-in-UI ×2 (two seeds) + controlled sim; root cause confirmed | **Fix merged:** [#101](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/101) as `b4846f7`. **Status: Fixed.** Real-engine regression evidence from Agent 6's adversarial session, draft PR [#106](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/106) (head `73e5f97`, **unmerged, local results, not CI**): 8 consecutive real-engine solo seasons played through the UI (two leagues, with browser restarts); saves reached 6.2 MB (above the old 5.2 M-char ceiling) with no failed write; reload kept the position every time; a damaged newest record fell back to `#prev` with a notice; a legacy localStorage save migrated; no fresh-league flash. **Remaining limitations (#106):** **ADV-001** — "New solo dynasty" overwrites the live save *and* the `#prev` recovery copy in <300 ms (reported P2; not yet registered); a legacy string is ignored if IndexedDB already holds a record (low); closing a tab inside the write window and two-tab last-writer-wins remain documented limits and were not retested; `#prev` roughly doubles storage (~12 MB at season 5; growth beyond 5 seasons is extrapolated, not measured); quota exhaustion not reproduced in a real browser; Firefox/WebKit untested. Verified pending review of #106. **Duplicate observation:** Agent 1 `A1-023` (per #94 description) — same root cause, linked, not a separate TAFI. Related #74 (would make the default player hit it) |
| TAFI-GAP-011 | Solo playoff bracket contradicts stored playoff games (engine path) | Bug | High | P1 | SP (adapter path) | Controlled sim 4/4 seasons + one UI instance; mechanism confirmed, trigger suspected | **Fix merged:** [#100](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/100) as `13e80ea`. **Status: Fixed.** Regression evidence (#106, draft, unmerged, local): across 8 real-engine seasons the bracket/game checker found **0 inconsistencies** (every bracket winner is a participant with an agreeing stored game, no eliminated team reappears, champion = Super Bowl winner, byes handled, no orphan games), including after restarts. The same checker flags the Mock path (13/13 matchups with no stored game), so it is not vacuous. **Remaining limitations:** holds on the engine path only (on Mock the contradiction/absence persists: GAP-005, #74); history keeps only the viewer's games after rollover; a reload *inside* a round simulation could not be provoked (the round completes in <100 ms), so mid-simulation interruption is inferred; `humansOnly` single-bracket formats and online nfl-format playoffs untested. Verified pending review of #106. |
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

Cross-agent routing: GAP-001/002/004/005 → issue #74 plan (Phase 1 approved only; no fallback fix approved). GAP-003/010/011-trigger → Agent 2. GAP-006 → Agent 1 (and Group 08 is **not** the place: out of its scope). GAP-011 (#100) and GAP-008 (#101) are both merged and regression-tested on the real engine in #106 (draft, local); both stay short of **Verified** until #106 is reviewed. #106 also re-verified GAP-001/003/004/005/006/007 (not new) and reports that an engine-built dynasty silently continued a whole season on the Mock after the adapter was lost (impossible scores, 13/13 playoff matchups without a stored game, no banner), i.e. #74 is worse in practice than its entry reads.

## Presentation, Audio & Immersion — Agent 1 presentation session, `PA-nnn` series (final, PR [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104), corrected final head `be809b0`, 2026-11-09)
Source: draft PR #104 (open, **not merged**; `test` still running when checked), `agent-01-presentation/REPORT.md` at `be809b0`: its top section is the single authoritative set of findings and its appendix is explicitly marked **SUPERSEDED**; the PR description was rewritten to match. (I reviewed the earlier head `ab5b2f0`; the corrections I asked for are in `be809b0`, and no finding changed.) Baseline `d0727ff` (post-Group 08), BAL only, 1440/390/320, fixture saves (not hand-played), real build. **Pre-baseline.** Sim path: not applicable (presentation); audio measured by recording the Web Audio graph headless, **nothing was listened to**. Of the first pass's 10 IDs: **6 confirmed** (PA-001, 002, 003, 004a, 005, 008), **2 false positives** (PA-006, PA-007) plus **1 sub-reading** (PA-004b), and **2 reclassified as opportunities** (PA-009, PA-010). PA-004 is split: 004a confirmed, 004b disproven. Priorities are the coordinator's provisional reading. Status for all: **New**.

### A. Confirmed defects
| ID | Title | Class | P (prov.) | Mode | Grounding | Cross-references |
|---|---|---|---|---|---|---|
| PA-001 | Trade Deadline "Your assets (0)" (and "Their assets (0)") controls unreadable at phone width: dark teal on the dark card-header band, 1.28:1 | UX / contrast | **P1** | Both | Viewed in screenshot + measured on a solid `rgb(10,52,53)` background, 390 and 320 | **Residual of the dark header band Group 08 left by owner decision** (`GROUP-08-REPORT.md`). Related to, not the same as, UI-TAFI-001 (a different element). My #103 review's probe had flagged both assets buttons at the time and left them unattributed. Agent's text names only "Your assets": scope must include "Their assets" and the whole class of dark-header controls |
| PA-003 | Draft room "Roster needs & unit grades" disclosure invisible: `#c9dcf0` on opaque `rgb(239,242,245)`, **1.25:1**, 1440 and 390 | UX / contrast | **P2 (top quick win, XS)** | Both | Real pixels sampled; root cause `decisions.css:19` `.decision-workspace details>summary{color:#c9dcf0}` | **Same root rule** as the Fantasy Draft Summary "Methodology" disclosure that PR #103 fixed with a *narrow* override (`.decision-workspace .dso-method > summary`, 17.35:1). The root rule still affects every `details>summary` in the decision workspace; fixing it there is the general fix. Different element from #103's, so no contradiction. Family: A1-001/002/025, UI-TAFI-001/002 |
| PA-002 | Game Day empty state scrolls sideways: `scrollWidth` 394 > 390 (and 322 > 320) | Bug (layout) | **P2** | Both | Viewed + measured at 390/320; 1440 clean. **ROOT CAUSE UNRESOLVED:** the agent gives the symptom only (no element or CSS rule identified, in either head) | **Pre-existing, not a Group 08 regression:** `game-day-week-9` is pixel-identical before and after #103 at all three widths (`group-08-evidence` table). **Conflicts with #94**, which reports "0 px horizontal overflow on 23 routes" at 390/320 (a different state or fixture; resolve which). Related: A1-007 (blank empty states) |
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
1. **UI-TAFI-004 / A1-004** — floating tabs cover content on phones. P1 **provisional**, S. (Two independent sightings; the escalation is unverified until a live-viewport case is demonstrated.)
2. **PA-001** — unreadable Trade Deadline controls. P1, S.
3. **PA-003** — draft-room disclosure (and, by root cause, every decision-workspace disclosure). P2, XS: highest value per effort.
4. **PA-002** — Game Day sideways scroll. P2, XS–S once the element is identified.
Rule kept: audio and polish items do not outrank these.

## Reported in PR #106 (draft, unmerged) — pending intake, **not registered here**
Agent label "Adversarial gameplay & multi-season QA" (folder `agent-06-adversarial`; the roster's Agent 6 is Cybersecurity, so confirm which role this is). `ADV-001` (P2): "New solo dynasty" overwrites the live save and the `#prev` recovery copy (2/2 confirmed; **a remaining save-integrity limitation of GAP-008's fix**). `ADV-002` (P3): 42% of "retirements" are unsigned free agents aged ≤24 (data confirmed; UI exposure unverified). To be registered when #106 is reviewed; cited above only as evidence for GAP-008/011.

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
