#!/bin/bash
cd "$(dirname "$0")"; : > ../data/staff_swap.jsonl
while pgrep -f run_all.sh >/dev/null; do sleep 5; done
printf '%s\n' "HC,OC,DC 95" "HC,OC,DC 20" "HC 95" "OC 95" "DC 95" "OC 20" "DC 20" "HC 20" | xargs -P4 -I{} sh -c 'set -- {}; npx tsx staff_swap.ts $1 $2 40 1.5 >> ../data/staff_swap.jsonl'
