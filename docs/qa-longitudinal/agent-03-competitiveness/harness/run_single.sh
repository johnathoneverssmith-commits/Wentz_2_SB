#!/bin/bash
cd "$(dirname "$0")"
printf '%s\n' "QB 0" "WR 0" "WR 2" "TE 0" "OT 0" "OG 0" "C 0" "RB 0" "EDGE 0" "EDGE 1" "DT 0" "ILB 0" "CB 0" "CB 2" "S 0" | xargs -P2 -I{} sh -c 'set -- {}; npx tsx unit_single.ts $1 $2 10 20 1 >> ../data/unit_single.jsonl'
