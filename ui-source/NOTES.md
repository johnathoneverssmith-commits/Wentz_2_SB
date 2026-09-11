# Franchise Sim UI — source handoff notes

This is the real, unbuilt source of the `nfl-sim-ui` project (React 18 + TypeScript
+ Vite). `franchise-sim.html` (the file you may have seen floating around as
"UI D2.html") is just this project run through `vite build` with
`vite-plugin-singlefile` — a minified, single-file convenience export for
opening without a dev server. This folder is the real thing: readable
components, real names, no bundler in the way.

Run it with:
```bash
npm install
npm run dev        # http://localhost:5173
```

## State / data-fetching pattern

**Zustand**, one store, no Redux and no React Context for domain state (Context
is only used by `react-router`'s `HashRouter`).

- `src/state/store.ts` — the entire `LeagueState` plus every mutating action
  (`tryAdvance`, `simulateGameDay`, `startDraft`, `placeOffer`, `signRookie`,
  `proposeTrade`, …), wrapped in `immer` so actions read like plain mutations.
  Persisted to `localStorage` via zustand's `persist` middleware
  (key `nfl-sim-ui.league`).
- Screens read state with the `useStore` hook, e.g.
  `const s = useStore(); const code = useStore((s) => s.viewerGmId);` — plain
  selector props, no prop-drilling between screens.
- `src/state/selectors.ts`, `src/state/standings.ts`, `src/state/leagueStats.ts`,
  `src/state/scoreTracker.ts` — pure derived-data functions over `LeagueState`
  (standings, rankings, leaderboards, head-to-head, playoff odds, the
  cross-season score tracker). None of these hold state themselves.
- `src/state/stageMachine.ts` — the annual-cycle stage graph
  (`resolveTransition`) that `tryAdvance` applies. This is the state machine
  driving which screen is "home" for the current stage.

## Where the mock data lives (→ what the engine should replace)

**`src/sim/SimulationService.ts`** is the seam — an interface, not an
implementation. Everything the UI needs from a simulator is one method call on
it: `generateInitialPool`, `generateCoachMarket`, `generateSchedule`,
`generateDraftClass`, `simulateWeek`, `simulatePlayoffRound`, `seedBracket`,
`evaluateTrade`, `computeSchemeFit`, `retirementOutcomes`,
`finalizeSeasonOutcomes`.

**`src/sim/MockSimulationService.ts`** implements that interface today with a
seeded, plausible-but-fake generator (`src/sim/rng.ts`, `src/sim/names.ts`,
`src/sim/roster-template.ts`, `src/sim/priorities.ts` for FA/coach negotiation
priorities). `src/state/seed.ts` (`createLeague`) calls it once to build a
fresh league. `src/state/store.ts` calls it on every sim action.

**To wire in the real engine**: write an `EngineSimulationService` that
implements `SimulationService` by calling into `nfl-franchise-sim/src/engine/`
— *but* that engine reads model artifacts via `node:fs`, so it can't run in the
browser directly. The intended path (see this project's own README) is a thin
Node adapter (Fastify or similar) that imports the engine and an
`HttpSimulationService` that calls it over HTTP; the store and every screen
stay unchanged either way, since they only ever touch `SimulationService`.

**`src/domain/player.ts`** is a field-for-field mirror of the engine's zod
`Player` schema (`nfl-franchise-sim/src/schema/player.ts`) plus a few UI-only
additions (`draft_info`, `retirement_status`, `college`, `season_stats`,
`scheme_fit`) the engine schema doesn't carry yet. `src/data/teams.ts` is real
data (the 32 actual NFL teams/colors/divisions), not mock.

**The Game Day screen** (`src/screens/GameDay.tsx`) is intentionally a thin
placeholder — it just proves the "week simulated, here's the score, continue"
flow. This is almost certainly where your `broadcastGame()` play-by-play view
belongs: today it shows the final score + around-the-league scores; it should
grow into the actual gamecast presentation, reading from whatever your engine
returns per game instead of `MockSimulationService`'s output.

## Routes / screens — all real, nothing left as a placeholder

Every route in `src/App.tsx` points at a fully built screen in `src/screens/`
(20 screens total). There used to be a generic `Placeholder.tsx` component
used while screens were being built out; it's no longer imported anywhere —
safe to delete if you want, kept only for reference.

| Route | Screen | Notes |
|---|---|---|
| `/setup` | `LeagueSetup` | lobby, team pick, league rules |
| `/draft`, `/fantasy-draft-summary` | `DraftRoom`, `FantasyDraftSummary` | fantasy draft (Y1) + annual rookie draft share `DraftRoom` |
| `/coaching` | `CoachingStaffHub` | includes the 5-day initial coach-hiring window |
| `/hub` | `WeeklyTeamHub` | base screen, preseason + regular season |
| `/game-day` | `GameDay` | **the light one — see above** |
| `/bracket` | `PostseasonBracket` | becomes base screen during playoffs |
| `/roster`, `/league-rosters` | `RosterCapManagement`, `LeagueRosters` | |
| `/trade` | `TradeProposal` | |
| `/free-agency` | `FreeAgencyBoard` | both the 5-day offseason window and the in-season standing market |
| `/schedule`, `/league-stats`, `/player-stats` | `FullSchedule`, `LeagueStatsRankings`, `PlayerStatistics` | |
| `/box/:gameId` | `FullBoxScore` | |
| `/retirement`, `/draft-preview`, `/rookie-signings` | offseason screens | |
| `/end-of-season`, `/season-complete` | `EndOfSeason.tsx` (two exports) | |
| `/history` | `LeagueHistory` | cross-season score tracker |
| `/gallery` | `ScreenGallery` | dev-only index of every screen |

`docs/screen-map.md` in this folder has the full spec-section-by-spec-section
mapping if useful context for the merge.
