# nfl-sim-ui

Front-end for the GM-managed NFL franchise simulation game. React + TypeScript +
Vite. Ports the 14 canonical HTML mockups into a single navigable application with
the full annual-cycle state machine (see `../franchise-sim-spec.md`), driven by a
seeded in-browser mock simulation. The real engine (`../nfl-franchise-sim`) plugs
in later behind one interface — see **Engine integration** below.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run test       # vitest (pure logic: scoring, stage machine)
npm run build
```

If `esbuild`'s postinstall is blocked (`npm warn allow-scripts`), run
`npm approve-scripts esbuild && npm rebuild esbuild` once.

## Layout

```
src/
  theme.css              design tokens + shared classes, copied verbatim from the mockups
  domain/                types — mirror franchise-sim-spec §6 + the engine's Player schema
  data/teams.ts          the 32 real NFL teams (name, city, color, conf, div)
  sim/
    SimulationService.ts the seam the real engine implements later
    MockSimulationService.ts   seeded stand-in (rosters, schedule, box scores, playoffs)
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

## Engine integration (later)

`SimulationService` method names track `nfl-franchise-sim`'s current + planned
exports. `domain/player.ts` mirrors the engine's zod `Player` schema field for
field. Because the engine reads model artifacts via `node:fs`, it can't run in the
browser — the real wiring is a small Node adapter (Fastify) that imports the
engine and an `HttpSimulationService` in its place. No screen changes.

## Known mock-quality gaps (not architectural)

- Fantasy-draft autopick distributes talent too evenly → team overalls compress.
- Box-score time-of-possession doesn't sum to 60:00.
- Playoff bracket uses a column layout, not the mockup's measured SVG elbows.
- No real sim math, AI strategy, auth, or multiplayer sync (all out of scope).
