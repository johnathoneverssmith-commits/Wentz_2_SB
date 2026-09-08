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
- `data/players_sample.json` — 8 real players as a proof-of-concept dataset,
  following the schema, with plausible attribute breakdowns
- `test/` — vitest specs covering the schema and the sample data
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
npm start           # load + print the sample pool
```

Relative imports use `.js` extensions (NodeNext) even though sources are `.ts`.

## What's NOT here yet (by design — this is just Phase 0)
- The full player pool (hundreds of current NFL players). Building this out
  fully means either sourcing/licensing a real ratings dataset or generating
  a large set of attribute values yourselves — worth deciding which before
  scaling past a handful of sample players, since wholesale reproduction of
  a commercial ratings database raises different considerations than a small
  illustrative sample like this one.
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
