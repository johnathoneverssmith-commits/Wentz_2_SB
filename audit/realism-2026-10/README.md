# Realism audit tooling (2026-10)

Reproduces every number in `REPORT.md`. Read-only: nothing here changes the engine, data or tests.

```bash
export NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json
bash audit/realism-2026-10/download_real.sh          # nflverse reference data -> audit/realism-2026-10/out/real (git-ignored)
python3 audit/realism-2026-10/real_benchmarks.py && python3 audit/realism-2026-10/real_players.py
mkdir -p audit/realism-2026-10/out
npx tsx audit/realism-2026-10/run_seasons.ts 100 8 1 audit/realism-2026-10/out/t10_0.json    # seed0 nSeasons talent out (NOSTAFF=1 for staff off)
npx tsx audit/realism-2026-10/replay_playoffs.ts 1 audit/realism-2026-10/out/t10_0.json
python3 audit/realism-2026-10/sim_vs_real.py 10       # game / team-season / box-score tables (arg = talent*10, matches t<arg>_<n>.json)
python3 audit/realism-2026-10/player_cmp.py 10        # player-season distributions
python3 audit/realism-2026-10/unit_links.py 10        # team margin vs unit ratings
python3 audit/realism-2026-10/rating_to_production.py 10
python3 audit/realism-2026-10/playoffs_injuries.py 10   # injuries; its playoff section is the non-franchise path
python3 audit/realism-2026-10/playoffs_franchise.py 10 # franchise-path playoffs (needs replay_playoffs.ts output)
npx tsx audit/realism-2026-10/trace_sample.ts 1 800 audit/realism-2026-10/out/trace_t10.json   # then game_script.py (needs `pip install pyarrow`)
npx tsx audit/realism-2026-10/stat_reconciliation.ts
npx tsx audit/realism-2026-10/determinism_check.ts
```

Four processes with different seed bases were used for the report (`100 + i*100000`, 8 seasons each at 1.0; `500 + i*100000`, 6 each at 1.5).
`playoffs_injuries.py` reads the regular-season JSONs; the franchise-path playoffs come from `replay_playoffs.ts` (`*.po.json`).
