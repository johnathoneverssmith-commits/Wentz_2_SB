# Agent 3 — Competitiveness & Strategic Depth (work in progress)

Baseline: master `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b`, pool `ui-source/src/data/pool-2026.json` (`NFL_POOL_PATH`).
Status: harnesses committed; sweeps still running, no findings or TAFIs written yet.

- `harness/unit_swap.ts` — shifts one position group on all 32 rosters, replays identical seeds/venue/opponent (paired).
- `harness/staff_swap.ts` — same for HC/OC/DC rating.
- `harness/run_all.sh`, `run_staff.sh` — sweep drivers; output to `data/*.jsonl` (partial until finished).

Known gap: the 5-season UI playthrough needs a browser and is not possible in this cloud session; `franchise:stress` uses a mock sim backend, so it is not used for competitive claims.
