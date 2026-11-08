#!/bin/bash
cd "$(dirname "$0")"
while pgrep -f run_t15.sh >/dev/null; do sleep 10; done
printf '%s\n' "10 20 1" "5 20 1" "-10 20 1" "-5 20 1" "10 20 1.5" "-10 20 1.5" | xargs -P3 -I{} sh -c 'set -- {}; npx tsx qb_budget.ts $1 $2 $3 >> ../data/qb_budget.jsonl'
