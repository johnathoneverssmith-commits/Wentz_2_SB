# Franchise stress test

Run from the repository root:

```sh
npm run franchise:stress -- --mode smoke
npm run franchise:stress -- --mode standard --seed 12345
npm run franchise:stress -- --mode deep --league-mode scripted_human
npm run franchise:stress:typecheck
```

`smoke` runs one league for three completed postseasons and replays the first
league in a fresh process. `standard` defaults to 25 leagues × 10 seasons, and
`deep` to 100 leagues × 20 seasons. Override either count with `--leagues` and
`--seasons`. The runner exits nonzero on a crash, invariant failure, or replay
mismatch. `--output` changes the output directory. Its default is
`artifacts/franchise_validation` at the repository root.
`--difficulty` accepts the store's current values: `easy`, `normal`, `hard`,
and `impossible`.

This runner uses the current franchise store and its mock simulation backend.
It blocks the optional HTTP adapter so an unrelated local server cannot change
the results. It records measured fields only; absent fields are left blank.
The store does not expose AI strategies or Hooded Figure state. The scripted
policy passes on free agency and deadline trades, so its transaction rates
do not validate an active GM policy. The current store can advance those stages
without creating the separate turn-based event objects; when that happens,
the corresponding transaction export has no measured rows. The runner clones the cached input pool
for each league and replays the first league in a fresh process.

Outputs: `team_seasons.csv`, `player_years.csv`, `transactions.csv`,
`draft_picks.csv`, `league_years.csv`, `checkpoints.csv`, `failures.jsonl`,
`run_config.json`, and `summary.md`. A replay run writes its evidence under
`replay/` in the chosen output directory.
