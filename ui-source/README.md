# nfl-sim-ui

Front-end for the GM-managed NFL franchise simulation game. React + TypeScript +
Vite. Ports the 14 canonical HTML mockups into a single navigable application with
the full annual-cycle state machine (see `../franchise-sim-spec.md`). Schedule
generation, game simulation (+ the Gamecast play-by-play view), real rosters, and
scheme-fit are real-backed by the engine one directory up (`../`) via a small
adapter — see **Engine integration** below; everything else still runs on a
seeded in-browser mock.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run test       # vitest (pure logic: scoring, stage machine)
npm run build
```

For real engine data (rosters, schedule, game sim, the Gamecast), also start
the adapter from the engine directory:

```bash
cd .. && npm install && npm run server   # http://localhost:8787
```

The UI works fine without it too — `HybridSimulationService` falls back to the
seeded mock automatically if the adapter isn't reachable (checked on every
league/schedule/week-sim call, not just at startup), including in the
standalone single-file build (`npm run build` → `dist/index.html`, openable via
`file://` with no server at all — just without real fidelity then).

If `esbuild`'s postinstall is blocked (`npm warn allow-scripts`), run
`npm approve-scripts esbuild && npm rebuild esbuild` once.

## Layout

```
src/
  theme.css              design tokens + shared classes, copied verbatim from the mockups
  domain/                types — mirror franchise-sim-spec §6 + the engine's Player schema
  data/teams.ts          the 32 real NFL teams (name, city, color, conf, div)
  sim/
    SimulationService.ts the seam — generateInitialPool/generateSchedule/simulateWeek are async (engine-backed); the rest stay sync
    MockSimulationService.ts   seeded stand-in (rosters, schedule, box scores, playoffs, draft, coaches, trades, retirement)
    HttpSimulationService.ts   calls the engine adapter (../server/); translates the one team-code mismatch (engine "LA" vs this UI's "LAR")
    HybridSimulationService.ts the service the store actually uses — real-backs what HttpSimulationService covers, Mock-backed fallback + everything else
    scoring.ts           cross-season scoring — spec §5, unit-tested
    rng.ts               deterministic RNG (port of the engine's rng.ts)
  state/
    store.ts             the one Zustand store: LeagueState + actions
    stageMachine.ts      the spec §4 annual-cycle graph + transitions
    standings.ts         standings + season-stat accrual / reset
    selectors.ts         shared derived reads
    seed.ts              builds a fresh LeagueState
  components/            AppShell, primitives (Card/Ticker/Tabs/Panel), ReadinessGate, ExpandableRow…
  screens/              one file per screen (see docs/screen-map.md)
```

## State machine

Every stage transition is a readiness gate: it fires when all human GMs are ready
(the viewer clicks; simulated GMs auto-ready after ~1.4 s). `store.tryAdvance()` is
the single place a transition — and its attached simulation — is applied.

Single-player: one human GM (the viewer) plus `humanGmCount - 1` simulated human
GMs that auto-ready and whose teams auto-act. All other teams are AI.

In dev, the Screen Gallery (`/gallery`) opens any screen regardless of stage; in a
production build the stage guard restricts navigation to screens valid for the
current stage.

## Engine integration

`SimulationService` method names track `nfl-franchise-sim`'s exports.
`domain/player.ts` mirrors the engine's zod `Player` schema field for field;
`domain/broadcast.ts` mirrors its `GameBroadcast` (the Gamecast's data shape).
Because the engine reads model artifacts via `node:fs`, it can't run in the
browser — `../server/` is the Node adapter (dependency-free `node:http`) that
imports the engine, and `HttpSimulationService` + `HybridSimulationService`
call it in the real engine's place. No screen changes needed for the swap.

Real-backed today: `generateInitialPool` ("realRosters" mode), `generateSchedule`
(the real regular season; preseason is still synthetic — the engine has no
preseason-schedule model), `simulateWeek` (real game sim + the Gamecast
broadcast for the viewer's game), `computeSchemeFit` (once a league-mean
baseline is fetched; falls back to Mock's heuristic until then).

Still Mock (no calibrated engine model yet — see `nfl-franchise-sim/CLAUDE.md`'s
own roadmap): `generateCoachMarket`, `generateDraftClass`, `evaluateTrade`,
`retirementOutcomes`, `finalizeSeasonOutcomes`, `seedBracket` /
`simulatePlayoffRound` (the engine has real standings/playoffs logic, but
mapping this UI's `BracketState` onto it is unbuilt plumbing, not a modeling
gap). **AI GM behavior for these — free agency, drafting, trading, coach
hiring — should optimize for winning (needs, scheme fit, cap-efficient value,
positional balance) once real-backed, not for maximizing summed roster
`overall`.**

## Known mock-quality gaps (not architectural)

- Fantasy-draft autopick distributes talent too evenly → team overalls compress.
- Box-score time-of-possession doesn't sum to 60:00.
- Playoff bracket uses a column layout, not the mockup's measured SVG elbows.
- Coach market / draft classes / trade valuation / retirement: plausible but
  not calibrated (see **Engine integration** above).
- No AI strategy beyond what's noted above, no auth, no multiplayer sync.
