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

**The real engine is wired in.** `src/sim/HttpSimulationService.ts` calls the
dependency-free Node adapter at `nfl-franchise-sim/server/index.ts`
(`npm run server`, port 8787), and `HybridSimulationService` is what the store
actually holds: the real-backed methods go over HTTP and fall back to Mock
when the adapter isn't running, so the standalone single-file build still
works offline. A refused connection is remembered for 30 seconds rather than
retried on every call — a season is ~20 `simulateWeek` round-trips, and
retrying each one filled the console with hundreds of identical errors.

Still Mock-only, for want of a calibrated engine model: `generateDraftClass`,
`evaluateTrade`, `retirementOutcomes`, `finalizeSeasonOutcomes`.

**`src/domain/player.ts`** is a field-for-field mirror of the engine's zod
`Player` schema (`nfl-franchise-sim/src/schema/player.ts`) plus a few UI-only
additions (`draft_info`, `retirement_status`, `college`, `season_stats`,
`scheme_fit`) the engine schema doesn't carry yet. `src/data/teams.ts` is real
data (the 32 actual NFL teams/colors/divisions), not mock.

**The Game Day screen** (`src/screens/GameDay.tsx`) renders the real
play-by-play: `src/screens/gamecast/` is a native React port of the field
visualization, driven by the `broadcast` the adapter returns for the viewer's
game. Its CSS classes are all `gc-` prefixed on purpose — the app's globals
own `.panel`, `.card`, `.drive`, `.board` and `.player`.

## Routes / screens — all real, nothing left as a placeholder

Every route in `src/App.tsx` points at a fully built screen in `src/screens/`
(20 screens total), wrapped in a `ScreenBoundary` so a crash in one screen
can't blank the app — reloading out of that state doesn't help, because the
stage is persisted too.

| Route | Screen | Notes |
|---|---|---|
| `/setup` | `LeagueSetup` | lobby, team pick, league rules |
| `/draft`, `/fantasy-draft-summary` | `DraftRoom`, `FantasyDraftSummary` | fantasy draft (Y1) + annual rookie draft share `DraftRoom` |
| `/coaching` | `CoachingStaffHub` | includes the 5-day initial coach-hiring window |
| `/hub` | `WeeklyTeamHub` | base screen, preseason + regular season |
| `/game-day` | `GameDay` | drive chart + the `gamecast/` field view |
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

## Franchise economy — the rules that hold the league together

These are invariants, not preferences: several of them exist because breaking
them soft-locked the game. `src/state/rosterLegality.test.ts`,
`contracts.test.ts` and `playthrough.test.ts` are the guards.

- **A player is either on a team with a contract, or on the market with
  neither.** Nothing may be both. The engine's `/pool` violates this on
  arrival — real team code, `free_agent: true`, no contract — so
  `normalizePool` fixes it at the seam, and `applyPick` clears the flag when a
  fantasy pick joins a team. When it slipped, the roster fill "signed" players
  a team already had and left it short of 53.
- **53 from kickoff; `OFFSEASON_ROSTER_SIZE` (65) between the last game and
  the preseason gate.** Holding teams to 53 year-round made free agency
  unplayable — a team that came out of the draft full could sign nobody, and
  the window resolved two signings a day league-wide.
- **`fillRosterGaps` cuts before it fills.** Size first (worst player at an
  overstocked position), then salary in three tiers: the priciest non-starter,
  then the priciest whose position has someone behind him, and the one man a
  team can't replace at his spot only as a last resort. Cutting minimum-salary
  depth to fix a $38M overage took a team to 22 players; cutting simply the
  biggest contract took its quarterback.
- **The fill leaves `CAP_WORKING_ROOM` unspent.** Spending to the line put all
  32 teams on exactly $255.0M — legal, and nobody could sign anyone.
- **A season takes a year off every contract** (`expireContracts`, run from
  `finalizeSeason`), and deals that run out stock the next offseason's market.
  Terms are staggered on purpose: with every fill deal written for one year,
  the first expiry dropped rosters to 12-21 players.
- **Open bids are committed money** (`checkBid`), and a day's own signings
  count against the room as they resolve. Otherwise a GM with $7M of room won
  four $20M bids on day five.
