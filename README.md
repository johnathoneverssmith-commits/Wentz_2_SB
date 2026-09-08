# Franchise sim — project scaffold

This is the Phase 0 starting point for the full franchise-mode game we
spec'd out: a fantasy-draft-based, GM-managed NFL franchise sim with real
current players, a game-level statistical engine, coach/scheme mechanics,
age-based development, live synchronous free agency, and trade logic with
a human-vote safeguard.

## What's here
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
- `docs/decisions.md` — running log of the "figure out later" design questions
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

## What's NOT here yet (by design — this is just Phase 0)
- Calibrated ratings. `generate:pool` gives a plausible full pool, but the
  model can't yet tell a good starter from a great one — that needs a
  performance signal (EPA / grades) added in Phase 1.
- Any simulation logic (Phase 1)
- Any UI wiring (Phase 2+)
- Multiplayer/state sync (Phase 4+)

## Roadmap recap
1. **Data foundation** (this step) — schema + starter dataset
2. **Core sim engine** — headless game-sim math, EPA/rank calc, aging formulas, cap math
3. **Single-player vertical slice** — one human GM, real screens, real engine, one season
4. **Single-player full loop** — retirements, roster mgmt, trades vs AI, simplified FA, draft
5. **Multi-GM infrastructure** — shared state, readiness gates, sync
6. **Synchronous live events** — timed FA days, live draft, trade-vote safeguard
7. **Polish** — balance the attribute/demand/trade-value weightings flagged as "figure out later"

## Recommended next step
This is a genuinely multi-session software build. The natural place to keep
building it is **Claude Code** (desktop, CLI, or IDE extension) — a proper
local project with version control, rather than continuing inside this chat.
Pull this scaffold in as the starting point for Phase 1.
