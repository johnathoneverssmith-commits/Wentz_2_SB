# Issue #74 — real engine in standalone single-player: implementation plan

Status 2026-11-07: **plan only. Not approved, not implemented.** Owner decision D-011: the long-term requirement is that standalone single-player uses the real simulation engine. Builds on the spike in [issue #74](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/issues/74) and `docs/agent4_notes.md`; this document adds sequencing, risks, acceptance tests and QA hooks. Per `CLAUDE.md`, simulation/production changes need explicit approval per change.

## Part 1 — Mock fallback: documented limitations (until #74 ships)

When the engine adapter (`http://localhost:8787`) is unreachable — the deployed solo default and every `npm run e2e` run — `HybridSimulationService.viaAdapter` silently falls back to `MockSimulationService`. Known consequences (from issue #74 and `docs/agent4_notes.md`; the first four are stated there, the last two are QA inferences):

| Aspect | Real engine | Mock fallback |
|---|---|---|
| Play-by-play / trace | full | none; solo UI shows a labelled scoring summary |
| Game plans | affect play | ignored (UI discloses this, PR #69) |
| Statistics, scoring, pace | validated (19/20 metrics within 10%, `CLAUDE.md`) | **not** validated against the engine spec — QA inference |
| Weather, staff, synergy, talent scale, rotation | in the engine | not representative — QA inference |
| Seeded replay of a game | yes (seed + sidelined list) | only what the mock stores |
| Pricing tables | n/a | `POSITION_VALUE`/`TRADE_POSITION_VALUE` live in `MockSimulationService.ts`, but Agent 3 reads them as the economy tables; confirm they are shared with online (open question) |

**Rules for QA now:** every report states its simulation path (`SUBMISSION-FORMAT.md`). Realism, balance and competitiveness evidence must come from the real engine (headless harness, or UI with the adapter running, or the online server). Anything from the mock path is labelled "mock" and cannot support a realism TAFI. Solo-UI testers who need real games should run the adapter (`server/`, `:8787`) and say so.

## Part 2 — Goals the implementation must meet (owner's five)

1. **Engine parity:** same seed + rosters + depth charts + plans + weather + staffs + talent scale ⇒ identical scores, box scores and traces in Node, the adapter, the online server and the browser worker.
2. **Game-plan functionality:** plans change outcomes in solo as they do online; the plan preview lab works without the adapter; the PR #69 disclosure is removed only after parity tests pass.
3. **Play-by-play:** solo games carry traces (and the Gamecast works) with storage within the localStorage budget (a trace ≈ 44 KB; `gameArchive` keeps traces for the last season only).
4. **Reproducibility:** a game replays from seed + sidelined list + **pool/engine version**; a mismatched version is refused, never silently replayed.
5. **Backward compatibility:** old saves load and play; no stored result or trace is rewritten; saves without a version are treated as legacy; the Realistic/Amplified/Extreme `talentImpact` rules unchanged.

## Part 3 — Proposed phases (each a separate, reviewable PR)

| Phase | Work | Key risk | Gate to proceed |
|---|---|---|---|
| 1. Make inputs explicit | Reference player pool becomes an explicit, versioned engine input (today `roster.ts` calls `loadPlayerPool()` at run time, so results depend on which pool file the host has). Default behaviour unchanged | silently changing results | Existing engine suites byte-identical; result identical with and without `data/players.local.json` |
| 2. Injectable artifact source | Replace `readFileSync` in `src/engine/loaders.ts` and `ratings.ts` with a source interface (Node fs / browser lazy JSON) | Node-only paths missed | `npm test` byte-identical; typecheck |
| 3. Shared sim module | Move `handleSimulateWeek`/`presentGame` out of `server/index.ts` into a module used by adapter, online server and worker | online regressions | `online/test` incl. `full-circuit`, `humans-only-circuit` against Postgres in CI |
| 4. Browser worker | Web Worker + lazy chunks (bundle ≈6.6 MB / 1.3 MB gzip, mostly model JSON + pool); progress UI; cache by app version; off the main thread | load time/memory on phones; e2e network guard (`e2e/support/guard.ts` blocks other origins) | Perf budget on a mid-range phone; offline/cache behaviour; e2e allowlist for the worker |
| 5. Switch the default | `HybridSimulationService` prefers worker → adapter → mock as last resort; remove the "no play-by-play" fallback copy and the game-plan disclosure; update `howItWorks.ts` | Math determinism differences between runtimes | Parity suite green (below) |

Speed is not a blocker (spike: ≈35 ms/game, ≈0.6 s for a 16-game week).

## Part 4 — Acceptance tests (must exist before Phase 5)
- **Parity matrix:** N seeds × (Node, adapter, online, worker bundle) compare scores, box scores, traces, injuries. Include `Math.*`-heavy paths.
- **Replay:** save a game, reload, replay from seed + sidelined + version ⇒ identical; wrong version ⇒ refused with a clear message.
- **Pool coupling:** no dependence on `data/players.local.json`.
- **Engine validation unchanged:** §22/§23 and `test/engine-realism.test.ts` pass; `passing-volume` baseline untouched.
- **Game plans:** a plan that should change outcomes does so in solo; preview works offline.
- **Legacy saves:** fixtures from before the change load, play a season, and keep stored traces.
- **E2E:** the existing Playwright suite now exercises the real engine; update the 'Mock' assumptions in specs deliberately, not incidentally.

## Part 5 — Open questions for the owner
1. Should the baseline wait for #74, or run on the real-engine path (adapter/online) while #74 is built? **Recommendation: don't wait.** Declare the baseline test environment as "UI + adapter" and require sim-path headers; re-run a solo smoke pass after Phase 5.
2. Is a bundle of ≈1.3 MB gzip lazy-loaded after setup acceptable on target devices?
3. Is a full-pool version/hash in saves acceptable as a schema addition (additive, optional)?
4. Approve Phase 1 alone first (it has value independent of the rest, and is testable by byte-identity)?
