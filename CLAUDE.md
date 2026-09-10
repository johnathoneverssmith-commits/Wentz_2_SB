# CLAUDE.md

Project guide for the NFL franchise sim. Read `README.md` for the product
vision and the 7-phase roadmap; this file is about working in the codebase.

## Current phase

**Phase 1 — simulation engine. Empirical build (spec `docs/engine_spec.md`)
has a working V1 end to end: Phases A–E all done at V1.** `analysis/` holds the
Python pipeline, `analysis/engine/` the headless game loop, `artifacts/` the
committed outputs the loop consumes. Done: §28 audit, 15 league-baseline
resolvers (Phase B), usage-role priors (C), player-effect calibration (D),
full-sim validation §22 (E, **16/20 within 10%** after V1.6 —
`docs/v16_points_gap_plan.md` took points/team-game **−11.8% → −2.0%**:
`CLOCK_SCALE` (M24 snap gaps ran long), `rz_yac` table (goal-line catch YAC),
end-of-half clock management (2-min drill / spikes / kick unit), punt
field-position bugs, RZ air-yards by goal-line distance, pick-6/scoop-6 rates,
punt-return-TD drive labeling), rating-layer validation §23 (E), penalty module §25
V1.5, portable resolver export + a TypeScript runtime port (`src/engine/`, runs
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
version + shape check. Headless + deterministic; round-robin `simulateSeason`
stays as the pool-free guard. No UI, no multiplayer yet. Next: the
franchise/game layer (offseason: draft, FA, aging) on top of `src/engine/`.

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
npm run season -- --seed 1 --year 2026 [--seasons K] [--compact] [--through W] [--picture W] [--box KC@BUF]  # season/franchise; --through=standings+clinch, --picture=seeds+in-the-hunt, --box=one game's box score
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
- `generate:pool` is the real pool (OQ-1): real roster facts from nflverse +
  the `src/model/` heuristic ratings. It is deterministic per `--seed`.
  Network I/O lives only in `fetch*Csv` / `loadPerfSignal`; the row->player
  logic (`buildPoolFromRosterRows`, `aggregateSnapCounts`, `buildPlayer`) is
  pure and unit-tested with inline fixtures.
- Never commit `data/*.csv` or `data/*.local.json`. The CSV path is only for a
  user-supplied Madden export (EA's data — local use, not redistribution);
  generated pools are just large and regenerable.

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
