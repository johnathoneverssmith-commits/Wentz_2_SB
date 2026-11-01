# Agent 4: play-by-play, fan reactions, portraits

## The play-by-play defect (UI-PT-26)
There was no single missing button. Four independent causes, found by tracing the pipeline:

1. **Solo play has no engine in the browser.** The engine is Node-only (`src/engine/loaders.ts` reads `artifacts/` with `fs`). The UI reaches it through the adapter on `localhost:8787`; when that is unreachable (the shipped solo case, and every e2e run) `HybridSimulationService.viaAdapter` silently falls back to the Mock sim, which produces scores and scoring plays but **no play trace**. `WatchGame` then said "No play-by-play was kept". Even with the adapter, only the *viewer's* game of a week carried a trace.
2. **Game history was erased each season.** The rollover did `games = []` (local `store.ts` and online `phases.ts`), so `/box/:id` and `/watch/:id` (which look up by id) dead-ended for every past game.
3. **The hub hid "Watch Play-by-Play" whenever the game had no box-score totals**, though the two are unrelated.
4. No schedule/history entry points and no browsable transcript.

### Fix
- `state/gameHistory.ts`: `gameArchive` (optional on `LeagueState`, old saves simply lack it) keeps every human-team non-preseason game across rollover, last 5 seasons; the previous season keeps its traces, older ones keep scores/scoring plays/box scores only (localStorage budget ~5MB; a trace is ~44KB). `findGame` looks in `games` then the archive; `describeTrace` = `full | summary | none`.
- `WatchGame`: full replay + quarter-tabbed transcript (`PlayByPlayLog`, behind a "shows the result" toggle so the replay is not spoiled) when a trace exists; otherwise a clearly labelled **scoring summary** from stored scoring plays; otherwise an explicit "nothing kept" message. Nothing is invented.
- Entry points: hub (Watch Play-by-Play, Game History), dashboard timeline link, schedule rows, new `/games` Game History screen (nav + How It Works text), existing results screens.
- Multiplayer: online games are already redacted per GM server-side (`redactedGames`); Game History uses `visibleGames`; archived games exist only after a season completes. Archived games are not re-fetched from the server (it cannot rebuild them: rosters changed).
- Agent 2 (fast-forward): any path that simulates through `store`/`phases` and reaches the rollover is covered by `archiveSeasonGames`; if fast-forward adds its own rollover, call `archiveSeasonGames(state)` before clearing `games`. Traces exist only where the sim produced them (adapter / viewer game); fast-forward cannot add them after the fact.

## Fan reactions (UI-PT-25)
`state/fanReactions.ts` (pure; seeded by `gameId|team`; no clock/network/AI). Facts come from the game record only (score, quarter points, totals, player lines, scoring plays, earlier results for streaks). Score-only games still get 4-6 true posts. `components/fans/FanReactions.tsx`: `FanPosts` (presentational, classes `.fan-reactions*`, `data-tone`, uses `--team`/`--team-on`) for Agent 3 to style; `FanReactions` is the connected Command Center section. Preseason games get light reactions. Online it uses `visibleGames`.

## Portraits (UI-PT-14)
`state/portrait.ts` + `components/PlayerPortrait.tsx`: deterministic layered inline-SVG illustrations from `hash(leagueSeed | playerId)` (rookie id `p_rookie_X` maps to prospect `X`, so a draft pick keeps his face). Team colours are props only (uniform changes on trade; face never does). ~19 traits (8 skin tones, 10 hair styles, 6 beards, face/jaw/ear/nose/brow/eye variation, eye black, headband, scar); 20,000 players -> 20,000 distinct specs (test). ~2KB SVG each, no network, no image decode; 2,000 specs generate in <200ms.

**Limitation (explicit):** these are stylised vector illustrations, **not photorealistic or cinematic**. Photorealistic faces need a generative model or licensed photo set; neither is available offline or responsibly here. Licensing/privacy: everything is original code, no photos, no real likenesses, no names read; skin tone etc. are random costume parts, not inferred from anyone.
Integrated: roster depth chart + contract list, player card modal, free agency rows, fantasy/rookie draft board, trade asset lists. **Agent 3:** use `<PlayerPortrait playerId size teamColor teamOnColor/>` or `<PlayerThumb player size/>` in the redesigned dossier (the large dossier artwork still uses the old silhouette art).

## Verification
UI typecheck/build, engine + online typecheck, UI vitest (new: gameHistory, fanReactions, portrait, PlayerPortrait), e2e `play-by-play.spec.ts` (+ regular-season, save-reload). Screenshots in `docs/screenshots/agent4/`.

## Follow-up round (review of PR #70)

### Season tag bug found and fixed
`archiveSeasonGames` was first called *after* `season += 1`, so every archived game was labelled with the next year. It now runs before the increment (local `store.ts`, online `phases.ts`); `gameHistoryRollover.test.ts` drives the real stage machine across the rollover and checks the tag.

### Preseason history
Preseason games are archived too (they were excluded). Limits: last 2 preseasons (`ARCHIVE_PRESEASONS_KEPT`), never with a play trace; regular season/playoffs keep 5 seasons, traces only for the most recent. Online wipes the preseason when the regular season starts (a deliberate product rule), so the games are archived immediately before the wipe, then the wipe proceeds unchanged.

### Multiplayer visibility of history
Archived games carry `seenBy`: the GMs who had revealed that game at archive time (computed with `visibleGames`). The server's outbound league view (`online/src/index.ts`) passes the archive through `visibleArchive(archive, gmId)`, so a GM who had not watched a game never receives it, not even a stub; a commissioner with no franchise gets none. Solo archives have no `seenBy` (open to their one GM). Tests: `gameHistory.test.ts` (reveal rules, caps, tags), `online/test/result-visibility.test.ts` (real route, two GMs, DB-backed).

### `draftOrder.test.ts` flake: pre-existing, not this PR
The failing assertion is "the humans do not occupy exactly the first N slots of a randomized first round". The order is a seeded shuffle; the store's starting league seed is `Date.now() % 100000`, so each run draws a different shuffle. Measured over 300,000 shuffles: 56 put the 3 human teams in the top 3 (expected 1 in 4,960). The PR touches no draft or seed code; the test passed on 3 more full runs, and on exact-head CI. It was nondeterministic by construction, not order-dependent. Fixed in the test only by pinning `draftSalt`.

### Real engine for solo play without `localhost:8787`: not done; scoped follow-up
Spike results (scratch, nothing committed):
- Engine speed is fine for a browser worker: ~35 ms per game, ~38 ms with a trace (a 16-game week is ~0.6 s).
- Bundling `src/engine` with the Node `fs`/`url`/`path` reads shimmed produced a 6.6 MB bundle (1.3 MB gzipped), mostly the 3.9 MB of portable model JSON plus the pool.
- It does **not** just work: `roster.ts` -> `loadPlayerPool()` loads the *reference pool* (`data/players.local.json`, else the 8-player sample) at run time to centre synergy/team-strength offsets. Results therefore depend on which pool file the host has. A browser engine must ship exactly the pool the server and online use, or solo and online games diverge. That is a gameplay-consistency decision and an engine-loader change (CLAUDE.md requires explicit approval for each), so it was not attempted here.
- `server/simPool.ts` uses `worker_threads`; the browser needs a Web Worker replacement.
Proposed follow-up (own PR): (1) make the reference pool an explicit input to the engine (default unchanged, byte-identical tests); (2) replace `readFileSync` loaders with an injectable artifact source (Node: fs; browser: lazily imported JSON chunks); (3) move `server/index.ts`'s `handleSimulateWeek`/`presentGame` into a shared module used by both the adapter and a Web Worker; (4) `HybridSimulationService` prefers the worker over `localhost:8787`, with the mock only as a last resort; (5) parity test: same seed/rosters give identical scores in Node and in the worker bundle (Math.* determinism across engines); (6) e2e allowlist for the worker. Until then solo games without the adapter carry a scoring summary, labelled as such. Game history (this PR) stores whatever trace the sim produced.

### Verification (local, exact-head CI recorded in the PR)
Typechecks (engine/online/UI), UI build, UI full suite, UI "direct" and "related" suites, online suites one at a time on PGlite (all pass except the `reliability-*` suites, which require real concurrent PostgreSQL connections and are authoritative only in CI), engine `npm test`: 2 failures that fail identically on a clean `origin/master` checkout here (`verify-replay` needs full git history; this clone is shallow; `verify-safety` process-tree test), browser e2e `play-by-play`, `regular-season`, `save-reload`.
