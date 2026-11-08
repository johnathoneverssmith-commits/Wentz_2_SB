#!/bin/bash
# Runs every unit-swap arm, 4 in parallel. Output: ../data/unit_swap.jsonl
cd "$(dirname "$0")"; : > ../data/unit_swap.jsonl
arms=()
for T in 1 1.5; do
  arms+=("QB abs:72 $T" "QB abs:95 $T")
  for U in OL WRTE RB FRONT LB SECONDARY K P; do arms+=("$U -10 $T" "$U 10 $T"); done
done
printf '%s\n' "${arms[@]}" | xargs -P4 -I{} sh -c 'set -- {}; npx tsx unit_swap.ts $1 $2 40 $3 >> ../data/unit_swap.jsonl'
