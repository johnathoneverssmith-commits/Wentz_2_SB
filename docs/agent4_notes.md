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
