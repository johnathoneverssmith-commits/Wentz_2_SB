# CLAUDE.md

Project guide for the NFL franchise sim. Read `README.md` for the product
vision and the 7-phase roadmap; this file is about working in the codebase.

## Current phase

**Phase 0 → Phase 1 boundary.** The data foundation (schema + validation +
sample pool) exists. No simulation logic, no UI, no multiplayer yet. Do not
add those without the roadmap phase for them being the active task.

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
npm run validate:pool # validate the active pool (local import if present)
npm run import:madden -- <csv> [out] [--season Y]   # bootstrap a full pool
npm start             # loads + prints the active pool
```

## Layout

```
docs/       prose specs (player_schema.md is the human version of the zod schema)
data/       players_sample.json (committed, 8 players);
            players.local.json (git-ignored, from import:madden) is preferred when present
src/schema/ zod schemas + inferred types  ← source of truth for data shapes
src/data/   players.ts (load/validate), madden.ts (CSV bootstrap importer)
src/        engine code grows here in Phase 1
test/       vitest specs, mirror src/ layout
```

## Player pool

- `loadPlayerPool()` / `resolveDefaultPoolPath()` prefer `data/players.local.json`,
  falling back to the committed sample. Tests that assert on the sample pass
  `SAMPLE_POOL_PATH` explicitly so a local import does not break them.
- Never commit `data/*.csv` or `data/*.local.json` — that is EA's Madden data
  (OQ-1). The importer is a stopgap; the real pool is generate-from-public-stats.

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
aging curves, injury severity vocabulary). OQ-1 (pool sourcing) is decided:
generate from public stats, with the Madden CSV import as an interim local
bootstrap. Revisit each before the phase that depends on it.
