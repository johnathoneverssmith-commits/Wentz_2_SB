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
npm install          # once (Node is not yet installed on the dev machine)
npm test             # vitest run
npm run typecheck    # tsc --noEmit, strict
npm run validate:data # validate data/players_sample.json against the schema
npm start            # loads + prints the sample pool
```

## Layout

```
docs/       prose specs (player_schema.md is the human version of the zod schema)
data/       player pool JSON (players_sample.json = 8-player proof of concept)
src/schema/ zod schemas + inferred types  ← source of truth for data shapes
src/data/   loaders/validators that turn JSON into typed objects
src/        engine code grows here in Phase 1
test/       vitest specs, mirror src/ layout
```

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
full player-pool sourcing). Revisit before the phase that depends on each.
