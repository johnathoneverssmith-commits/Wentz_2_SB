# Simulation fallback investigation (GAP-001, 002, 003, 004, 005) and Issue #74

## Three layers, kept apart
1. **Real engine** — `src/engine/sim.ts`, played play-by-play. Reached from the UI **through the adapter** (`server/`, `localhost:8787`) in solo, and in-process by the online league server (`online/src/blocks.ts`).
2. **Adapter** — `server/index.ts` `handleSimulateWeek` / `playoff*` / `presentGame` + `server/boxscore-map.ts`: turns engine traces into the UI's `GameResult` (totals, player lines, scoring plays, broadcast). Bugs here are engine-path bugs.
3. **Mock fallback** — `ui-source/src/sim/MockSimulationService.ts`: a statistical stand-in. Used per call by `HybridSimulationService.viaAdapter` whenever the adapter call throws. **This is what a deployed standalone solo player gets**, because nothing listens on `localhost:8787` (`docs/agent4_notes.md`; Issue #74).

## Answers to the seven questions

| # | Question | Answer | Ground |
|---|---|---|---|
| 1 | Why impossible scoring events? | **Mock only.** `simGame` draws each side from Normal(22±…, 10) clamped 0–59 and `scoringPlays()` decomposes the total into 7s and 3s with the remainder labelled "Safety". A remainder of 1 = a one-point "Safety". 307 of 640 games had one; 8 of 960 finished with a 1. The real engine produced none (0 in the 245 + 241 games kept in the two UI saves, and in 2 headless engine seasons). | code + headless |
| 2 | Why do player stats contradict team totals? | **Mock:** `teamTotals` and `teamLines` are generated independently from the points figure, so yards, TDs and implied points do not reconcile. **Engine:** differences are small and partly legitimate (QB scramble yards are in player rush lines, not team rush; GAP-003). | code + headless |
| 3 | Can one transient adapter error push a whole season to the fallback? | **Per call, then a 30-second breaker.** `viaAdapter` sets `adapterDownUntil = now + 30 s` on any throw; every call in that window (a week, a playoff round, the schedule) takes the Mock. In my harness a single stale-keep-alive `EPIPE` made the first season entirely Mock (the breaker re-trips as each window expires into another failed attempt only if the adapter is still down). Not reproduced as a *spontaneous* browser failure: the browser runs never saw one. | headless; code |
| 4 | Does the game say which simulator is active? | **No.** Controlled test (`harness/fallback_mid.cjs`): weeks 1–2 simulated with the adapter, adapter blocked, weeks 3–8 simulated. Results: weeks 1–2 each had one play-by-play game; weeks 3+ none; **no text anywhere** on the game-day screens mentioning offline/approximate/fallback. The only disclosures are: the game-plan *projection* panel ("standalone offline simulator has no game-plan projection") and `WatchGame`'s "scoring summary" label when no trace exists. | played (UI) |
| 5 | Are playoff games omitted from saved history in the fallback? | **Yes.** Mock `simulatePlayoffRound` only sets `homeScore/awayScore/winner` on the matchup (scores 20–34 vs 10–33) and returns no `playedGames`; headless Mock seasons stored 320 games (272 REG + 48 PRE) vs 333 with the engine. So there are no playoff box scores, scoring plays or Game History entries in the fallback. | code + headless |
| 6 | Are game plans etc. ignored in fallback? | `simGame` references only team overall and the RNG; no game plan, staff, weather, depth chart or talent scale (grep). **Confirmed by code; effect size not measured.** The real path passes all of them (`HybridSimulationService.simulateWeek`). | code |
| 7 | Can the engine fall back halfway through a franchise unnoticed? | **Yes, demonstrated.** Same mid-season test: a league that was real-engine at week 2 silently becomes Mock at week 3 and the saved league contains both kinds of games. There is also no flag on `GameResult` recording which simulator produced it, so afterwards even the developer cannot tell without checking for `broadcast`. | played (UI) |

## What Issue #74 would and would not fix
Issue #74 (not implemented here; needs approval) proposes a browser/worker engine as the preferred path with **"Mock only as a last resort"** and a versioned player pool.

| TAFI | Resolved by #74 as written? | Needs separate correction |
|---|---|---|
| GAP-001 impossible scores | **Only if the Mock is deleted.** If it stays as the last resort it must be fixed. | Fix `scoringPlays()` / score draw (or remove Mock from game simulation) |
| GAP-002 stats ≠ totals (Mock) | Same as 001 | Derive Mock lines from the same drive composition |
| GAP-003 engine yardage | No (engine/adapter accounting) | Choose a convention; Agent 2 |
| GAP-004 silent fallback + no indicator | **Reduced, not closed**: a worker has fewer failure modes than a localhost HTTP call, but any "last resort" still needs a visible "approximate simulation" label and a per-game `source` field | Add `GameResult.source` + banner; retry once before tripping the breaker |
| GAP-005 playoffs missing | Resolved on the engine path; remains on the last-resort path | Make Mock return `playedGames` or retire it |
| **GAP-008 save size** | **No — #74 makes it worse.** The Mock saves peak ≈3 MB; the engine path stores play-by-play for the viewer's games (≈1.1 MB per season) and peaks above the 5.24 M-char localStorage limit in season 2. Shipping #74 without fixing GAP-008 would turn a dev-only failure into the default player experience. | Fix GAP-008 **before or with** #74 |
| Game plans "ignored" in standalone | Resolved (plans reach the engine) | Remove the PR #69 disclosure only after |

**Recommendation:** treat GAP-008 as a prerequisite of #74. Add to #74's regression list: "a 10-season solo save stays under the storage budget" and "`GameResult.source` is recorded and shown".
