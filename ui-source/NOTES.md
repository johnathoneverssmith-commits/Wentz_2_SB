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
- **A trade has to fit both sides** (`checkTrade`), on the cap and on the
  roster limit. `applyTrade` only swapped team codes, which made the trade
  screen a free way around every other gate.
- **Squads coming off the engine pool are priced to fit the cap**, not at raw
  market value. `contractValueFor` was fitted for one free agent's asking
  price; applied to 60 players at once it costs ~$350M against a $255M cap,
  and the trim that followed cut the biggest contracts on every roster.
- **The fill spends the room it has.** Taking only the cheapest free agent for
  every spot behind the starters left teams sitting on $18-124M while the
  league's median rating slid 69 to 61 and 1,070 free agents went unsigned.
- **AI teams sign their own draft classes** (`signAiDraftPicks`). Only the
  viewer's picks were, so 217 drafted players a year evaporated and the
  league's average age climbed 27.5 to 31.1 over five seasons.

## Things that are real, and easy to assume aren't

- **Injuries** (`src/state/injuries.ts`). The engine simulates them on every
  game; the adapter returns each game's log; a week's injuries land on the
  players who suffered them, heal a week per Game Day, and clear each
  offseason. An injured player is left out of the roster handed to the
  simulator, so an injury costs the team the player — except at a position
  stripped bare, where the least-hurt man suits up, because the engine builds
  its depth chart from what it's given.
- **The depth chart** (`state.depthChart`, `depthAt`). Persisted per team and
  per position, it decides the starting lineup and therefore the team rating,
  and it rides to the engine, whose `Roster` takes an optional depth order
  instead of always sorting by `overall`.
- **The test suite is hermetic.** `src/test-setup.ts` stubs `fetch` to reject,
  so nothing depends on whether a dev adapter happens to be running —
  `adapterFallback.test.ts` is the one place that seam is exercised on purpose.
- **Restructure and extend** (`state/contracts.ts`). A restructure converts
  salary to prorated bonus — cheaper now, dearer later, and the carried money
  follows the player through an extension so the pair isn't free money. An
  extension is negotiated in free agency's own modal against what the player
  would get on the open market a year early.
- **Draft picks** (`state/draftPicks.ts`). A ledger of every pick for this
  draft and the next two. The rookie draft's slots are earned by record; who
  *uses* each one comes from the ledger. Picks trade alongside players and are
  priced off `PICK_VALUE_BY_ROUND`, discounted for distance.
- **The AI proposes trades** (`state/aiTrades.ts`), at the end of a season and
  when free agency opens. Offers are seeded per stage (no rerolling), made per
  human GM, filtered through `checkTrade` so nothing is offered that the
  offering team couldn't honour, and surfaced with a count on the rail.

## Accessibility, and what's already been checked

Worth knowing before changing markup, because these were all found by
measuring rather than by reading the code:

- `Tabs`/`Panel` in `components/primitives.tsx` are a real ARIA tablist —
  roving tabindex, arrow/Home/End, each panel pointing back at its tab. Pass
  `<Panel id="...">` matching the tab id or the pairing breaks.
- The three overlays share `components/useDialog.ts`: `role="dialog"`, focus
  trap, Escape, focus returned to whatever opened them.
- Every rendered text node was measured against its *composited* background.
  `--ink-faint` was 2.85:1 and is now 5.2:1; team accents lift against the
  measurement (`readableAccent`) rather than a luminance threshold, and
  `onColorFor` picks black or white on a team fill by contrast. A test holds
  all 32 teams to AA.
- Layouts that set columns inline can't be reached by a media query. The
  `.split-2` / `.split-3` classes in `theme.css` exist for that reason; use
  them rather than an inline `gridTemplateColumns` for anything multi-column.
