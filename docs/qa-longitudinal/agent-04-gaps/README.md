# Agent 4 — Gaps & Completeness (interim report)

**Baseline:** master `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b` (PR #87 merge), branch `claude/friendly-bohr-sy85qm`.
**Config:** solo, 1 human GM (BAL), `DEFAULT_CONFIG`, fully fictional universe, seed 4001 (2 and 4 seasons), Node 22, headless store via the real stage machine.
**Honest scope.** Nothing below claims more than was run.

| Activity | Status |
|---|---|
| 4 consecutive solo seasons through the real stage machine + store actions (Mock sim), seed 4001 | RAN (harness: `harness/qa_longitudinal.test.ts.txt`) |
| 2 seasons with the real engine adapter (`server/`, :8787) | RAN. Needed a retry on a stale keep-alive socket (harness artefact, see GAP-004) |
| 3 seasons clicked through the **browser UI** | **NOT DONE.** The manual 53-round fantasy draft stalled my click driver; only league setup + draft room opened by hand |
| Route crawl: 2027 saves from every stage, desktop 1280 + phone 390 | RAN. No console errors, no native dialogs, no horizontal overflow, no save-failure banner |
| Route crawl of year-2/3 saves (the 5.9 MB ones) | **NOT RUN** (see GAP-009) |
| Multiplayer | Local PGlite only (NOT CI): `full-circuit, lobby, commissioner-away, commissioner-transfer, vacate-seat, result-visibility` = 42/42 passed. No live multi-browser session. |
| Feature inventory, engine-to-UI map, parity | Partial, source-inspected only unless stated; marked below |

Evidence: `evidence/`. Checks per game: score vs quarter sums vs last scoring play, increments, player lines vs team totals, duplicate games, 17 games/team, W-L/PF/PA recount, league wins == losses, playoff ties, cap, contracts.

## What passed (verified by run)
Every team played 17 REG games, no duplicate games or same-week double-booking, records/PF/PA recount exactly, league wins == losses, champions/history/teamSeasons/awards grew once per season, cap never exceeded, rosters legal at kickoff, draft-pick horizon rolls (2028-29 → 2031-32). Stage flow completed every stage (design-intended skips: training-camp results and hooded-figure are conditional).

## TAFI register
Format: severity · category · mode · status. Fix proposals only; nothing was changed.

### TAFI-GAP-001 — Mock sim produces impossible scores (1-point "Safety") — **High · Confirmed defect · solo**
- Actual: 8 games with a 1-point side in 4 seasons (e.g. `2027-REG-4-ATL-CAR 1-23`, `2027-REG-1-ATL-NO 1-4`), scoring play "Safety" adding 1. Also 2, 4, 5 point totals.
- Intended: scores reachable by 2/3/6/7/8; safety = 2.
- Cause (confirmed): `ui-source/src/sim/MockSimulationService.ts` `simGame` draws Normal(22,10) and `scoringPlays()` splits any total into 7s/3s and labels the remainder "Safety" whatever its size.
- Why it matters: Mock is the shipped solo path whenever the adapter is unreachable (standalone build; `docs/agent4_notes.md`).
- Fix: draw scores from a legal-score composition (TD/FG/safety counts), or reject unreachable totals (resample). Alt: make the standalone build refuse to play Mock games without saying so (see 004).
- Regression test: property test over 10k Mock games: no score in {1}, every scoring-play delta ∈ {2,3,6,7,8}, safety=2. Complexity: S. Priority P1.

### TAFI-GAP-002 — Mock player lines contradict team totals — **Med · Confirmed · solo**
- Lines imply more points than scored (e.g. 20 vs 17; 27 vs 22), passTD ≠ receiving TD, pass/rush/rec yards unrelated to team totals (260 vs 186).
- Cause: `teamLines` / `teamTotals` generated independently from `points`. Fix: derive lines from the same drive composition as GAP-001. Test: reconcile TD/FG/XP and yards per game. S–M. P2.

### TAFI-GAP-003 — Engine-path box score lines differ slightly from team totals — **Low · Unconfirmed · both**
- Engine game `2027-REG-1-TEN-BAL`: pass yds lines 290 vs team 278, rush 222 vs 198; every human-team game off by ~5–25 yds; TDs/points reconcile.
- Hypothesis: team passing is net of sack yards, rush excludes scrambles; `server/boxscore-map.ts` `playerLinesFrom` counts gross. Fix: one convention, or label "net". Test: reconcile within 0 for the chosen convention. S. P3. (Coordinate with Agent 2.)

### TAFI-GAP-004 — Silent fall-back to Mock for 30 s after one adapter error — **Med · Missing integration · solo**
- `HybridSimulationService.viaAdapter` sets `adapterDownUntil` after any failure; one `EPIPE` made my first season entirely Mock, with no signal to the player which engine played. Harness-induced here (Node stale keep-alive), not reproduced in a browser.
- Fix: show an "approximate simulation" badge on game results when Mock produced them; retry once before tripping the breaker. Test: adapter that fails once → UI badge/one retry. S. P2.

### TAFI-GAP-005 — Playoff games absent from `state.games` on the Mock path — **Med · Unconfirmed · solo**
- Mock run: 320 games/season (272 REG + 48 PRE); engine run: 333. Playoff box scores/Game History may then be missing offline. Verify `simulatePlayoffRound` in Mock returns `playedGames`. S. P2.

### TAFI-GAP-006 — ~20 native `confirm()`/`alert()` dialogs remain — **Low · Presentation inconsistency · both**
Sites: ReadinessGate (3), CommissionerTakeTurn, SetupSeed, UniversePicker, SaveBackup, ExpiringContracts (3 incl. `alert`), AppShell "New solo dynasty", Checkpoint (2), HoodedFigureEncounter (irreversible payment), OnlineLobby (4: archive, leave, make commissioner, remove GM), TradeProposal (accept trade). Not exercised in browser (source grep). Fix: one `ConfirmDialog` on the existing `useDialog`/`FullScreenOverlay`. Test: grep-guard forbidding `confirm(`/`alert(` in `src/`. M. P2 (irreversible ones first).

### TAFI-GAP-007 — Unknown URLs silently redirect to `/` — **Low · Incomplete · both**
`App.tsx` `path="*"` → `Navigate to="/"`. No not-found/"that screen isn't available in this stage" message. Fix: small NotFound screen with link to the stage home. XS. P3.

### TAFI-GAP-008 — Save size 4.3–5.9 MB by seasons 2–3 vs localStorage quota — **Med · Unconfirmed · solo**
Persist payloads measured: 2.0 MB (start), 4.3 MB (end S1), 5.9 MB (S2 offseason). Compaction exists (`saveCompaction.ts`) but I did not load year-2/3 saves in a browser, so I do not know whether a write failure surfaces. Next step: run `snapcrawl` on the 2028 saves; check the save-failure banner. P1 to verify.

### TAFI-GAP-009 — Hard-coded stage label "Ready for Week 10" — **Low · Inconsistency · solo/online**
`stageMachine.ts` `STAGE_READY_LABEL.midseasonDepthChart` ignores `seasonShape` (humans-only leagues have another deadline week). Source-inspected only. Fix: derive from `seasonShape(state).deadlineWeek + 1`. XS. P3.

### Observations, not defects (unverified)
- Retired players keep `nfl_team` (harness flagged ~100/season); every roster/cap filter excludes `retired`, so likely by design. Confirm retired players never show in roster lists.
- `hallOfFame` was `undefined` after 3 seasons: no induction yet; unverified whether inducting is reachable in short runs.
- Parity (source only): solo `fastForwardSeason` ("Simulate Preseason/Regular Season") vs online block flow — differs by design; solo `extendPlayer/restructure/tender` map to online `contractMove`; online `staffFix` has no solo button (solo staff auto-fills). Game-plan: all 15 `GamePlan` fields referenced in GamePlanScreen; online `saveGamePlan` exists. Personnel (p11/p12/p13) appears only in GamePlanStrip/GamePlanScreen — not checked that it changes outcomes.

## Feature inventory (condensed)
Complete & verified by run (solo, headless): setup, fantasy draft, coaching draft, training camp, trade deadline stage, mid-season FA, playoffs/Super Bowl, end-of-season records, rollover, rookie draft/signings, annual FA, standings/records integrity.
Verified in browser (screens render, no errors, no overflow, 2 widths): every stage route for 2027 saves.
Complete in tests only (local): online full circuit, lobby, commissioner transfer/away, vacate, result visibility.
Implemented but unverified by me: Hooded Figure (reached 2028; not exercised), awards/Hall of Fame UI, player development history UI, trade valuation display, contract/dead-money display, injury UI, online multi-GM reveal screens, mobile touch flows, reload mid-transition, disconnects.
Not assessed: Agent-1 visual quality; team-theme identity per screen (only `AppShell` uses `useTeamTheme`; worth checking that screens inherit it).

## Roadmap
1. GAP-001/002 (+005): make the offline sim legal. 2. GAP-008: verify/guard save size. 3. GAP-004: sim-source badge + retry. 4. GAP-006: ConfirmDialog migration. 5. Finish the undone work: clicked 3-season browser run with a draft-autopick shortcut, year-2/3 crawl, live two-GM online session.
