# Franchise sim

A fantasy-draft-based, GM-managed NFL franchise sim: real current players and
real teams, a play-by-play statistical engine calibrated against real NFL
data, coach and scheme mechanics, age-based development, live free agency, and
trades with a human-vote safeguard.

This file began as the Phase 0 scaffold note and has been kept honest: what
follows is where the build actually is.

## Where it is

| | |
|---|---|
| **Engine** (`src/engine/`) | Play-by-play game sim, full 17-game season, the real division-rotation cycles, NFL tiebreakers, 14-team playoffs, clinch tracking, injuries, a coaching layer. Calibrated against 2018–2025 nflverse data; §22 validation at 16/20 within 10%. Deterministic per seed, no Python at runtime. |
| **Franchise UI** (`ui-source/`) | React + Vite. A complete single-player dynasty: fantasy or real-roster start, draft, free agency, the coaching market, trades, the cap, depth charts, injuries, retirements, a play-by-play gamecast, and a cross-season score tracker. |
| **Engine adapter** (`server/`) | A stateless local HTTP adapter so the UI plays out real engine games. The UI falls back to its own model when it isn't running, so the standalone build works offline. |
| **Online leagues** (`online/`) | A server that owns a league: Postgres, accounts, one team per human GM, asynchronous play over months with real-world phase deadlines and AI takeover for absent GMs. **Written and tested, deliberately not deployed.** See `online/README.md`. |
| **Analysis** (`analysis/`) | The Python modelling pipeline the engine's committed `artifacts/` come from, plus the TypeScript measurement scripts (draft outcomes, win probability). |

Running it: `npm run server` here and `npm run dev` in `ui-source/` gives the
full game at <http://localhost:5173>. The UI alone is playable without the
adapter, on its own model.

## The data layer

- `docs/player_schema.md` — the data shape everything else reads from (prose)
- `src/schema/player.ts` — the same schema as a zod definition (enforced);
  TS types are inferred from it, so there is one source of truth
- `src/data/players.ts` — loader that parses + validates a pool JSON file
- `src/data/generate-pool.ts` — builds a full pool from open NFL roster data
- `src/model/` — position priors (`positions.ts`) + the heuristic ratings
  model (`ratings.ts`) the generator uses
- `src/data/madden.ts` — alternative importer for an existing Madden-style CSV
- `data/players_sample.json` — 8 real players as a proof-of-concept dataset,
  following the schema, with plausible attribute breakdowns
- `test/` — vitest specs for the schema, sample data, generator, and importer
- `docs/decisions.md` — running log of the "figure out later" design questions,
  and of the ones that have since been answered with measurements
- `docs/engine_spec.md` — the engine build contract
- `CLAUDE.md` — how to work in this codebase

## Development setup
Requires Node >= 22 (`.nvmrc` pins 24, the current LTS).

```
npm install
npm test            # vitest
npm run typecheck   # strict tsc, no emit
npm run build       # emit to dist/
npm run validate:data   # validate data/players_sample.json
npm run validate:pool   # validate the active pool (generated pool if present)
npm run generate:pool   # build a full pool from open NFL data (see below)
npm start           # load + print the active pool
```

Relative imports use `.js` extensions (NodeNext) even though sources are `.ts`.

## Player pool

`loadPlayerPool()` uses `data/players.local.json` when it exists, otherwise the
committed `data/players_sample.json`.

### Generating the full pool (the OQ-1 answer)

```
npm run generate:pool -- --season 2025
```

Pulls a season roster and per-game snap counts from
[nflverse](https://github.com/nflverse/nflverse-data) (openly licensed: real
names, teams, positions, ages, experience, snap share — all facts), then runs
each player through the heuristic ratings model in `src/model/` to produce a
full, schema-valid `data/players.local.json` (~1,900 players). No third-party
ratings data is involved, so the pool is ours to commit or share.

How a rating is built: **tier** = snap share (when the player has one) blended
with draft capital and years survived on a roster → **overall** = position
prior + spread·tier + age/role/noise → **attributes** = position body-type
bases for the physical ones, tracked to overall for the skill ones. It is
deterministic (same `--seed` → same pool) and deliberately crude; real
calibration is Phase 1/7 work (OQ-2, OQ-4 in `docs/decisions.md`).

Options: `--season Y`, `--seed S` (reroll), `--practice-squad` (include PS
players), `--no-ir`, `--no-snaps`, `--out PATH`, `--csv` (also write the
editable sheet described below).

`data/players.local.json` is git-ignored so large generated pools don't bloat
the repo; regenerate it any time.

### Editing ratings in a spreadsheet

```
npm run pool:export-csv                       # active pool -> data/players.local.csv
# ...edit ratings in Excel / Sheets / etc...
npm run pool:import-csv -- data/players.local.csv   # -> data/players.local.json
```

One row per player, one column per attribute (blank = attribute not set for
that position), plus `overall`, the age thresholds, `scheme_tags`
(pipe-separated), and trailing `*_json` columns for the structural fields you
can ignore while editing. `id` is preserved so edits map back to the same
players. Import re-validates every row against the schema (it aborts on a bad
row, naming it), clamps ratings into 0–99 with a warning, and re-sorts by
overall. The round-trip is value-lossless.

### Alternative: import an existing Madden-style CSV

```
npm run import:madden -- path/to/madden_export.csv --season 2025
```

For anyone who already has a Madden ratings CSV. Matches column names loosely
(long names or 3-letter codes), maps positions onto the schema, drops
off-position attributes. **Do not commit the CSV or its output** —
`/data/*.csv` and `/data/*.local.json` are git-ignored because that is EA's
ratings data (fine to use locally, not to redistribute).

## What isn't done

- **Deployment.** The online server runs locally against a local Postgres and
  has never been exposed to the internet. That is the remaining step for
  multiplayer, and it is a deliberate hold rather than an oversight.
- **A home-field advantage in the engine.** Measured across 47,616 simulated
  games, the engine gives the home team nothing; the real NFL gives it about
  five points of win rate. Quantified and written up in `docs/decisions.md`
  → OQ-10, not closed, because it moves every number the §22 validation
  checks. The UI no longer claims an advantage the sim doesn't grant.
- **The weightings flagged as "figure out later"** — attribute→overall,
  FA demand, trade value. Tracked in `docs/decisions.md` as OQ-2 … OQ-9; each
  has a working v0 and a note on what would replace it.

## Roadmap

1. **Data foundation** — schema + pool. *Done.*
2. **Core sim engine** — game-sim math, ratings layer, aging, cap. *Done, calibrated.*
3. **Single-player vertical slice** — one human GM, real screens, real engine. *Done.*
4. **Single-player full loop** — retirements, roster, trades, FA, draft. *Done.*
5. **Multi-GM infrastructure** — shared state, readiness gates, sync. *Written, not deployed.*
6. **Live events** — timed FA days, live draft, trade-vote safeguard. *Done; async deadlines online.*
7. **Polish** — the weightings above, and whatever a long soak turns up.
