#!/usr/bin/env bash
# Real-NFL reference data (nflverse, openly licensed). Writes to $AUDIT_DIR/real (default audit/realism-2026-10/out/real).
set -euo pipefail
OUT="${AUDIT_DIR:-audit/realism-2026-10/out}/real"; mkdir -p "$OUT"; cd "$OUT"
curl -sSL -o games.csv https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
for y in 2023 2024 2025; do
  curl -sSL -o "wk_$y.csv"  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_$y.csv"
  curl -sSL -o "inj_$y.csv" "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_$y.csv"
done
for y in 2023 2024; do
  curl -sSL -o "pbp_$y.parquet" "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_$y.parquet"
done
