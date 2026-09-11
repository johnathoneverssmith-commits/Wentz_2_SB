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
baseline is fetched; falls back to Mock's heuristic until then),
`generateCoachMarket` (the real 32 current staffs' HC/OC/DC — real 2026 names,
reputation-informed scheme/tendency numbers where a coordinator has a real
public track record — plus a free-agent pool sampled from that same v0 rating
distribution), and `seedBracket` / `simulatePlayoffRound` (real standings +
a real, round-by-round-simulated playoff bracket — the engine's own
`standings.ts`/`playoffs.ts`, stateless on the adapter side: each round
replays from the same seed through the rounds already played, so there's no
server-side bracket state to keep in sync; win-probability display is still
a ratings-based heuristic, since the engine only reports the simulated
result, not a pre-game probability).

Still Mock (no calibrated engine model yet — see `nfl-franchise-sim/CLAUDE.md`'s
own roadmap): `generateDraftClass` (prospect generation itself),
`evaluateTrade`'s underlying value curve, `retirementOutcomes`,
`finalizeSeasonOutcomes`.

**AI GM decision objective (OQ-9, implemented for free agency, coach hiring,
draft-pick selection, and trade evaluation):** `store.ts`'s
`aiOfferForPlayer`/`aiOfferForCoach`/`bestAvailable` pick a team (or a pick)
weighted by actual positional need / scheme fit with that team's current
roster, and bid a realistic amount off the player's/coach's real rating —
not a uniformly random team at a uniformly random dollar amount, and not
"take the highest overall regardless of who's picking."
`MockSimulationService.evaluateTrade`'s AI accept-likelihood similarly
weighs whether the incoming/outgoing players address or leave a real need
(and had a real sign bug fixed along the way — see git history). The
underlying prospect/pick *value* itself (real draft-pick trade charts,
position-scarcity-aware player valuation) is still the Mock heuristic —
OQ-5/OQ-6 in `nfl-franchise-sim/docs/decisions.md` track that as separate
from the decision-objective fix.

## Known mock-quality gaps (not architectural)

- Fantasy-draft autopick distributes talent too evenly → team overalls compress.
- Box-score time-of-possession doesn't sum to 60:00.
- Playoff bracket uses a column layout, not the mockup's measured SVG elbows.
- Draft-class prospect generation / trade & FA value curves / retirement:
  plausible but not calibrated (see **Engine integration** above); the coach
  market, schedule, game sim, and playoff bracket are all real-backed now.
- No auth, no multiplayer sync.
