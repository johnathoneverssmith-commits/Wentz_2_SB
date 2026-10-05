# CLAUDE.md

Project guide for the NFL franchise sim. Read `README.md` for the product
vision and the 7-phase roadmap; this file is about working in the codebase.

## Current phase

**Phase 1 — simulation engine. Empirical build (spec `docs/engine_spec.md`)
has a working V1 end to end: Phases A–E all done at V1.** `analysis/` holds the
Python pipeline, `analysis/engine/` the headless game loop, `artifacts/` the
committed outputs the loop consumes. Done: §28 audit, 15 league-baseline
resolvers (Phase B), usage-role priors (C), player-effect calibration (D),
full-sim validation §22 (E, **16/20 within 10%** as last regenerated; the
three penalty metrics were fixed after that table was written, see below —
`docs/v16_points_gap_plan.md` took points/team-game **−11.8% → −2.0%**:
`CLOCK_SCALE` (M24 snap gaps ran long), `rz_yac` table (goal-line catch YAC),
end-of-half clock management (2-min drill / spikes / kick unit), punt
field-position bugs, RZ air-yards by goal-line distance, pick-6/scoop-6 rates,
punt-return-TD drive labeling), rating-layer validation §23 (E), penalty module §25
V1.5 + a **V1.7 global hazard calibration** (`PENALTY_HAZARD_SCALE` 1.0 → 1.22,
measured over 1,500 games: penalties −20.8% → −2.8%, penalty yards −15.7% →
+3.3%, DPI −26.7% → −6.0%) + a **V1.8 team-strength channel**
(`src/engine/team-strength.ts`, mirrored in `analysis/engine/team_strength.py`)
closing the rating layer's between-team shortfall — split offense/defense
index, `TEAM_STRENGTH_SCALE = 1.0`, `points_sd` 8.65 → 9.6–9.9 vs real 9.93,
favourite win rate 58.8% → 66–70%. §22/§23 regenerated and current: **19/20
within 10%**, `points_sd` (measured rating-layer-off, by design) the sole
miss. Full story and the numbers behind both fits in `docs/ENGINE_HANDOFF.md`),
portable resolver export + a TypeScript runtime port (`src/engine/`, runs
on `artifacts/**/portable/*.json`, no Python). Residual-variance anchors use the
wide 2018–2025 window + team-season units; §13.6 joint-calibration harness
(`26_joint_calibration.py`) run — layer is emergently sound (margin widens,
points −0.8±0.4/team-game, no βᵢ change).

**A1 (real season) is in** — `src/engine/{nfl-structure,schedule,standings,
playoffs,clinch,report}.ts` + `simulateNflSeason` / `simulateFranchise` in
`season.ts`: the current 17-game schedule formula with **the real
division-rotation cycles anchored to the published 2023–2026 pairings** (so
`year: 2026`, the default, reproduces the actual 2026 slate and later years
roll forward), byes confined to weeks 5–14, `TRADE_DEADLINE_WEEK`/
`BYE_WEEK_RANGE` constants, the full NFL standings tiebreaker chain, 7-seed
conference seeding, the 14-team playoff bracket through the Super Bowl, and a
conservative clinch/elimination tracker (`docs/decisions.md` → A1).
`npm run season` prints a full season / bracket; `--through W` prints
standings + clinch tags as of week W. For an interactive UI there's a
week-by-week loop (`startSeason` → `playWeek` → `finishSeason`, plus
`progressStandings` / `progressClinches` / `remainingOpponents` /
`boxScoreFor` / `playoffPicture`) and a matching round-by-round playoff
stepper (`startPlayoffs` → `playPlayoffRound` → `finishPlayoffs`). Both step functions are pure and
byte-identical to their one-shot equivalents (`simulateNflSeason` /
`simulatePlayoffs`); `serde.ts` saves/loads the progress states with a
version + shape check. `Roster` also takes an optional **depth order** (position -> player ids)
so a franchise UI's hand-set lineup reaches the sim; omitting it sorts by
`overall` exactly as before, so every validation path is byte-identical, and
like roster injection it is TS/adapter-only surface with no Python mirror.
A **coaching layer** (`staff.ts` / `staff-shift.ts` /
`staff-data.ts`, mirrored in `analysis/engine/staff*.py`) adds subtle HC/OC/DC
effects on top of the player ratings — `simulateGame(…, {homeStaff, awayStaff})`,
default ON in the season sims with the 32 authored v0 staffs; a
`leagueAverageStaff` is exactly zero (see `docs/decisions.md` → A1 add-on). Headless + deterministic; round-robin `simulateSeason`
stays as the pool-free guard.

**Synergy (`src/engine/synergy.ts`) makes position groups more than their
average** — superadditive complete units, weak links that cost more than
their share, two great edge rushers worth >2× one, QB × each receiver both
ways, and one cross-team term (this rush vs that line's protection) feeding
sacks, completions and interceptions. It also gives the offensive line its
missing effect on the run game. Centred on the reference depth charts and
tanh-capped per channel, so league averages don't move (points/team-game
20.45 → 20.44) while the spread lands on real (points sd 9.90 vs 9.93). TS
only; calibration and unit/matchup experiments in `analysis/33_synergy.ts`,
the story in `docs/decisions.md` → Synergy. Playoff games now take the
franchise rosters too (`withPlayoffRosters` in `playoffs.ts`) — they used to
fall back to the reference NFL teams.

**The 2026-10 realism pass** (`docs/decisions.md` → The 2026-10 realism
pass) added a rotating defensive front, blitz × personnel, venue weather
(`weather.ts`; every franchise game and replay passes `weatherFor(...)`, so
pass it from any new call site too), per-channel league calibration, and
`test/engine-realism.test.ts` as the guard. A practice-squad player is
`nfl_team = "PS:<team>"` (`state/practiceSquad.ts`): every roster, cap and
game filter by `nfl_team === team` excludes him by design.

**Phases 2-6 are built on top of this.** `ui-source/` is the franchise UI (a
complete single-player dynasty, React + Vite); `server/` is the stateless
adapter that lets it play real engine games; `online/` is a league server with
Postgres, accounts and asynchronous multi-GM play. See the top-level
`README.md` for where each part stands and `online/README.md` for the
multiplayer design.

**The off-field circuit redesign is done** (`docs/REDESIGN_CHANGE_LOG.md`, all
thirteen changes). The shape to know before touching anything in `online/` or
`ui-source/src/state/`:

- **Football is simulated once, at a checkpoint, and revealed afterwards.** A
  *block* runs from one checkpoint to the next thing that could change its
  inputs — which is why the regular season is two blocks either side of the
  trade deadline. `ui-source/src/state/revealBlocks.ts` defines them;
  `reveal.ts` holds each GM's own markers. **`visibleGames` and
  `visibleBracket` are load-bearing**: anything that reads `state.games` or
  `state.bracket` directly will show a GM a result they have not watched.
- **Reveals do not move `state.week`.** A preseason watched to the end still
  reads week 1. Ask `currentBlock`, not the week.
- **Play-by-play is not stored.** It is rebuilt from the game's seed plus the
  saved `sidelined` list (`online/src/blocks.ts`, `regenerateBroadcast`).
- **The turn-based events** (coaching draft, both free-agency periods, the
  trade deadline, the rookie draft) are one order, one turn, one thing at a
  time, and their CPU turns run server-side in a sweep.
- **Illegality is deliberate** at the trade deadline, the rookie draft and
  both free-agency periods — cap, roster limit and positional minimums are all
  allowed to break there and are enforced at reconciliation.

**Talent impact** (`LeagueConfig.talentImpact`, `state/talentImpact.ts`) is
the engine's `talentScale` game option: it multiplies every roster-driven
shift (rating families, team strength, synergy) and leaves home field and
coaching alone. Realistic 1.0 is the validated engine, byte-identical;
Amplified 1.5 (the new-league default) and Extreme 2.0 make the favourite
win 72% / 79% instead of 67%, with scoring levels flat. It is passed on
*every* simulation and replay — adapter week sims, both playoff endpoints,
the viewer broadcast, and online's block/simulate/broadcast calls — because
a replay at a different scale is a different game. Saves without it play
Realistic.

**League formats** (`ui-source/src/state/leagueFormat.ts`). `nfl` is the
32-team game. `humansOnly` is just the GMs' teams, padded with CPU teams to
an even count of at least four, playing whole round robins nearest 17 games
(venue alternating each meeting) and a single-bracket playoff for the top
half rounded up to a power of two. The other franchises are deleted when
setup closes (`formHumansOnlyLeague`, from both the local store's
`applyStageEntry` and online's `onStageEntered`). Season length and the
deadline week come from `seasonShape(state)` — never the old 3/18/9
constants, which remain only as the NFL shape. Brackets carry `format` /
`rounds`; step rounds with `bracketRounds(b)` and label them with
`roundLabelFor`, never `ROUND_ORDER` / `ROUND_LABEL` directly.
`humansOnlyLeague.test.ts` (local) and `online/test/humans-only-circuit.test.ts`
(three human GMs) play a whole year each.

`online/test/full-circuit.test.ts` walks a whole season by pressing the
buttons the screens press. Run it after changing any stage wiring; it is what
catches a league that cannot leave a stage.

**Three CPU-behavior layers sit on top of the shared evaluators, and are
deliberately orthogonal to each other:**

- **AI GM Season Strategy** (`ui-source/src/state/aiStrategy.ts`) answers
  "what kind of roster does this GM want?" Eight strategies
  (balanced/offense-heavy/defense-heavy/pass-heavy/run-heavy/high-floor/
  high-ceiling/trenches-first) belong to a **GM**, not a team
  (`state/aiGms.ts`): `LeagueState.aiGms` holds named CPU GMs, more of them
  than CPU teams, each with a strategy and a skill; fired ones wait in a pool.
  A person picks theirs at team select (`Gm.strategy`, private). Read it with
  `strategyOf(state, team)`, never `strategyFor` (the old hash, kept only as
  the fallback for a league that has no GMs yet). Wired into the draft, coaching draft,
  free agency, AI trade offers/acceptance, and Training Camp focus as a
  small bounded bonus on top of the base evaluator.
- **AI Difficulty** (`ui-source/src/state/aiDifficulty.ts`) answers "how
  well does it search for and evaluate the options?" — never a rules/rating/
  cap change. Four levels (casual/standard/competitive/expert) via
  `LeagueConfig.difficulty` (each CPU GM's skill is a bell-curve draw around the level, `difficultyFor(state, team)`) (a field that predates this and was previously
  wired to nothing), controlling candidate-search depth, deterministic score
  noise, need-awareness, and FA chase-ceiling/rebid discipline. Same
  integration points as strategy, applied first in the pipeline (base value →
  difficulty's search/noise limits → strategy preference → hard constraints).
  A fifth level, **Master**, is Expert's search with a better evaluator and
  still no advantages: `state/unitValue.ts` values players in measured points
  of margin (`analysis/38_unit_links.ts` — per-unit value on this
  engine, e.g. QB, OL, CB, EDGE lead, K/P ≈ 0, OLB not a lineup slot), by unit with
  weak-link weighting and value over replacement, in the draft and free
  agency; it also never accepts a trade that loses value. Measured against
  Expert-built rosters from the same draft slot (`online/test/ai-master.test.ts`):
  49–51% / +0.1–0.2 margin at both settings after the 2026-10 engine pass
  (rotation, weather, RB share), which is inside the benchmark's own noise
  (a 320-game margin has a standard error of ~0.8). The earlier "+1.7" was
  mostly noise too, so treat Master as Expert's equal with a sounder evaluator. The honest ceiling for
  a rules-abiding CPU — the user chose that over giving it an edge.
- **The Hooded Figure catch-up mechanic**
  (`ui-source/src/state/hoodedFigure.ts`) is unrelated to either: a rare,
  dark-comedy offer for a *human* team that's counted as the league's losing
  franchise two seasons running. It adds two stages to the season flow —
  `hoodedFigureEncounter` (right after Training Camp results, before the
  depth chart) and `leagueDevelopments` (a league-wide reveal screen, after
  preseason is simulated and before the regular season starts) — see
  `stageMachine.ts`'s `resolveTransition`. Fully deterministic once a payment
  is submitted: thresholds, the swindle roll, the positive/negative branch,
  the specific event and its target are all seeded from
  `teamCode|season|payment`, so nothing about a reload can change the
  outcome. Replaced an older, never-actually-wired Training Camp
  "investment"/`oddsMultiplier` system, which is gone.

All three are covered by their own acceptance-test files
(`aiStrategy.test.ts`, `aiDifficulty.test.ts`, `hoodedFigure.test.ts`) keyed
to their source specs' own numbered acceptance lists.

`analysis/30_win_probability.ts` is TypeScript rather than Python because it
measures the TS engine: what a rating gap is worth, over 47,616 simulated
games — and, incidentally, that the engine has no home-field advantage
(`docs/decisions.md` → OQ-10). The draft-outcome fit behind
`ui-source/src/sim/draft-outcomes.ts` is the other measurement of this kind.

Engine toolchain split: the §28 audit is TypeScript (`analysis/00_schema_audit.ts`,
`hyparquet`); everything from Phase B on is Python (scikit-learn) in
`analysis/.venv` — see `analysis/README.md`. `data/*.parquet` is git-ignored.
The V1 engine runs in Python (loads joblib directly); `src/` is still the
schema/pool layer and the eventual TS runtime.

## Stack

- TypeScript, ESM (`"type": "module"`), Node >= 22, `NodeNext` resolution.
- Runtime validation: **zod**. The zod schema in `src/schema/player.ts` is the
  single source of truth for the player shape — TS types are `z.infer`'d from
  it, never hand-declared alongside it.
- Test runner: **vitest**.
- `tsx` runs TS directly (no build step needed for dev).
- Relative imports use the `.js` extension (NodeNext requirement) even though
  the files are `.ts`.

## Commands

```bash
npm install           # once
npm test              # vitest run
npm run typecheck     # tsc, strict, no emit
npm run validate:data # validate data/players_sample.json against the schema
npm run validate:pool # validate the active pool (generated pool if present)
npm run generate:pool -- --season 2025    # build a full pool from nflverse data
npm run pool:export-csv                   # active pool -> data/players.local.csv (editable)
npm run pool:import-csv -- <in.csv> [out] # edited csv -> pool json
npm run import:madden -- <csv> [out] [--season Y]   # alt: existing Madden CSV
npm run analysis:audit                    # spec §28 schema audit -> artifacts/
npm start             # loads + prints the active pool
npm run season -- --seed 1 --year 2026 [--seasons K] [--compact] [--through W] [--picture W] [--box KC@BUF] [--staff KC] [--no-staff]  # season/franchise; --through=standings+clinch, --picture=seeds+in-hunt, --box=one game, --staff=coaching card
```

## Layout

```
docs/       prose specs (player_schema.md is the human version of the zod schema)
data/       players_sample.json (committed, 8 players);
            players.local.json (git-ignored) is the generated full pool, preferred when present
src/schema/ zod schemas + inferred types  ← source of truth for data shapes
src/model/  positions.ts (per-position priors), ratings.ts (heuristic ratings model)
src/data/   csv.ts, players.ts (load/validate), generate-pool.ts (nflverse -> pool),
            pool-csv.ts (pool <-> editable CSV), madden.ts (alt CSV importer)
src/engine/ TS simulation engine — port of analysis/engine/ (roster, ratings,
            rng, loaders, sim + the two portable-model evaluators) plus the A1
            season layer: nfl-structure, schedule, standings, playoffs, season
            (round-robin guard + simulateNflSeason). Runs on the committed
            artifacts/**/portable/*.json; no Python at runtime.
test/       vitest specs, mirror src/ layout
analysis/   empirical modeling pipeline (see analysis/README.md); lib/ + 00_schema_audit.ts
artifacts/  committed pipeline outputs the runtime engine loads (schema/, ratings/, later models/)
docs/       engine_spec.md is the full engine build contract
```

## Player pool

- `loadPlayerPool()` / `resolveDefaultPoolPath()` prefer `data/players.local.json`,
  falling back to the committed sample. Tests that assert on the sample pass
  `SAMPLE_POOL_PATH` explicitly so a generated pool does not break them.
- `generate:pool` builds a pool from nflverse roster facts plus the
  `src/model/` heuristic ratings, deterministic per `--seed`. It is how the
  committed pool was first built and is still the way to pick up a new
  season's rosters — but see the warning below before copying its output over
  `ui-source/src/data/pool-2026.json`, whose ratings are authored.
  Network I/O lives only in `fetch*Csv` / `loadPerfSignal`; the row->player
  logic (`buildPoolFromRosterRows`, `aggregateSnapCounts`, `buildPlayer`) is
  pure and unit-tested with inline fixtures.
- Never commit `data/*.csv` or `data/*.local.json`. The CSV path is only for a
  user-supplied Madden export (EA's data — local use, not redistribution);
  generated pools are just large and regenerable.
- The exception is `ui-source/src/data/pool-2026.json`, which **is** committed:
  it is nflverse-derived (openly licensed real names/teams/ages, no EA data),
  and it has to ship or the deployed game invents its players. Real rosters do
  not cover this game's roster template, so `generateInitialPool` tops each
  team up with generated depth — the people you have heard of are real, the
  practice squad is not.
- **Do not regenerate the committed pool from `generate:pool` and copy it over.**
  That is how it used to be built, and the `src/model/` heuristic scores a
  player on snap share, draft capital and years survived — whether he is a
  starter with pedigree, not whether he is any good. It rated Jamal Adams 95
  (the best player in the league), Jameis Winston level with Joe Burrow, and
  Drew Lock 91, and the fantasy draft faithfully opened with a declining
  safety. The shipped pool's **ratings are authored** rather than heuristic
  output, which is the only reason the draft board reads like a draft board.
  Regenerating would quietly undo that while looking like an update.
  Edit it through `pool:export-csv` / `pool:import-csv` instead, which
  round-trips losslessly and validates every row against the schema.

## Conventions

- Keep `docs/player_schema.md` and `src/schema/player.ts` in sync; if they
  disagree, the prose doc is the intent and the code is the enforcement —
  update both in the same change.
- v0 schema is intentionally loose in spots (free-string `severity`, unknown
  attribute keys allowed unless `strictAttributes`). Tighten these only when a
  consuming system needs the guarantee, and note it in `docs/decisions.md`.
- Ratings are 0–99 integers everywhere.
- Money is plain numbers in whole dollars.

## Open design questions

Tracked in `docs/decisions.md` — the "figure out later" list from the spec
(attribute→overall weighting, scheme-fit modifiers, trade value, FA demand,
aging curves, injury severity vocabulary). OQ-1 (pool sourcing) is done:
`generate:pool` builds the pool from nflverse facts + the `src/model/`
heuristic. The model constants there (`AGING_CURVES`, physical bases, overall
priors) are v0 placeholders feeding OQ-2/OQ-4; expect to tune them once the
sim engine exists. Revisit each question before the phase that depends on it.
