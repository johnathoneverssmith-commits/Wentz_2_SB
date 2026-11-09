# Critical franchise reliability fixes — engine lock (#74 / GAP-004) and recoverable dynasty reset (ADV-001)

Baseline: `master` @ `d0727ff`. Findings come from QA PR #106 (`docs/qa-longitudinal/agent-06-adversarial/` on that branch).

## Fix 1 — a dynasty never silently changes simulator

**Before:** `HybridSimulationService.viaAdapter` fell back to the Mock on *any* adapter failure, per call. PR #106 killed the adapter under an engine-built dynasty and the same save played a whole season on the Mock (1-point scores, no stored playoff games, no banner).

**Now:** each solo dynasty has a persisted `simEngine: "engine" | "mock"` (`LeagueState`, optional), fixed when it is created.

| Dynasty is | Adapter up | Adapter down |
|---|---|---|
| `engine` | real engine | **play stops**: `EngineUnavailableError`, nothing simulated, nothing changed, banner "Play is stopped…" with **Retry**. Every press re-asks the adapter (the 30 s console-quieting cooldown does not apply). |
| `mock` | **Mock** (adapter never called — a Mock dynasty cannot become an engine one) | Mock |
| undecided (old save that has played nothing) | engine, then recorded | Mock, then recorded |

* Creation: `newLeague` records `engine` only if pool, schedule and coach market all came from the adapter; otherwise `mock`.
* Standalone / no-adapter users are **not stranded**: their dynasty is `mock`, plays exactly as before, and the hub now says so ("Mock simulation (not the real engine)…"). Documented in How It Works ("Real engine or Mock simulation").
* Guarded call sites: `simulateWeek`, `seedBracket`, `simulatePlayoffRound`, next-season `generateSchedule` (store: `simulateGameDay`, `finishGameDay`, `tryAdvance`, `fastForwardSeason`). All simulator calls occur *before* any state change, so a refusal leaves the save byte-identical. Fast-forward stops with the reason rather than finishing weeks that were never played.
* Not changed: scheme-fit baseline (cosmetic, may still use its cooldown), draft class/trade/retirement logic (Mock-only by design), online leagues (server-side).

### Existing-save compatibility
`engineOf(state)`: explicit `simEngine` wins; otherwise inferred from played non-preseason games in `games` + `gameArchive` — engine games carry `weather`, Mock games never do. Verified in Chromium with a save written by the previous build (League 2, 2028 preseason): loaded unchanged, adapter loss stopped play, Retry resumed on the engine and recorded `simEngine`. A pre-change save that has played **no** regular/playoff game yet is undecided and takes whichever answers first (see limitations).

## Fix 2 — recoverable dynasty reset

* `durableSave.ts`: `Backend.archive(slot)` copies the current record **verbatim** to `<slot>#undo` (verified by read-back; refuses an unreadable record). `#undo` is written by nothing else — not autosave, not `remove`, not migration, not corruption recovery. Works on IndexedDB and the localStorage fallback.
* `store.ts`: `keepCurrentDynasty()` (flushes first; skips leagues still at setup so an empty league can never take the slot; skips online). `newLeague` calls it before replacing anything, so the header button **and** Setup's "Create league" are covered.
* UI: the native `confirm()` is replaced by `NewDynastyConfirm` (alertdialog): names the team, seasons played and year; says a recovery copy is kept and how to restore; warns when it would replace an earlier kept copy; states the limits (this browser only, one dynasty, cleared by site-data wipe); **Download backup first**; if the copy cannot be made, the reset is refused unless the player chooses "Start anyway — lose current dynasty".
* Recovery: **Restore previous dynasty (TEAM, year)** in the rail (`SaveBackup`), visible after a restart. Restoring *swaps* (the league on screen takes the kept slot), so it is itself undoable; migration runs as for backups.
* IndexedDB corruption recovery (`#prev`/`#damaged`) and legacy localStorage migration are untouched and re-tested.

## Verification
| Check | Result |
|---|---|
| New: `sim/engineLock.test.ts` (8), `state/engineLock.store.test.ts` (5, the PR #106 adapter-loss scenario at the store), `state/dynastyReset.test.ts` (9: 5-season save, post-reset autosaves, restart, swap, empty league, failed copy, corruption interplay, legacy migration, localStorage fallback) | pass; mutation check (remove the keep call) fails 3 of them |
| Full UI suite (final) | 172 files, 1083 tests pass, 2 skipped (as before) |
| Engine/online/UI typecheck, UI build | pass |
| Chromium, real adapter, `scripts/verify-lock-and-reset.mjs` | `evidence/verify-*.out`: engine-loss (11 PASS), standalone (4), old-save (4), reset with a pre-change 5-season save + browser restart (13) |
| Playoff consistency (PR #100) | `e2e/specs/playoffs.spec.ts` passes; no change to `playoffs`/bracket code |
| `npm run e2e` (Chromium, final) | 108 passed, 1 failed, 5 did not run. The failure is `cleanup.spec.ts` "server never becomes ready" (process-tree cleanup in this sandbox) and **fails identically on untouched master**; the 5 not-run tests follow it in the same serial group. A first run also failed `frontend-dashboard` mobile because the Mock notice sat above the game button; the notice now renders below the page content and the spec passes. |

## Remaining limitations / risks
1. A **pre-change engine save with no regular/playoff games played yet** is undecided; if the adapter is down at its first simulate it locks to Mock. (Once any engine game is stored it is inferred correctly.)
2. The kept copy covers **one** dynasty and lives only in this browser; a second reset after playing replaces it (the dialog says so). Backups remain the permanent route.
3. `#undo` roughly doubles stored dynasty size (≈6 MB more at season 5), same order as `#prev`.
4. A tab closed inside the IndexedDB write window is still the documented #101 limit.
5. Mock dynasties show a notice on hub/game-day/bracket; no way to "upgrade" one to the engine (start a new dynasty).
6. Not covered: manual trades, online mode, other browsers.
