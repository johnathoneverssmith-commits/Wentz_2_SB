#!/bin/bash
# Fills the missing talent-1.5 arms (640 pairs; 20 reps) -> ../data/unit_swap.jsonl (append)
cd "$(dirname "$0")"
arms=(); for U in WRTE RB FRONT LB SECONDARY K P; do for D in -10 10; do grep -q "\"unit\":\"$U\",\"delta\":\"$D\",\"talent\":1.5," ../data/unit_swap.jsonl || arms+=("$U $D 1.5"); done; done
printf '%s\n' "${arms[@]}" | xargs -P3 -I{} sh -c 'set -- {}; npx tsx unit_swap.ts $1 $2 20 $3 >> ../data/unit_swap.jsonl'
